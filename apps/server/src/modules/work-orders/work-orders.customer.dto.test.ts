import { WorkOrderStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.js";
import {
  CUSTOMER_DETAIL_SELECT,
  CUSTOMER_LIST_SELECT,
  type CustomerDetailRow,
  technicianDisplayName,
  toCustomerWorkOrderDto,
  toCustomerWorkOrderListItem,
} from "./work-orders.customer.dto.js";

const S = WorkOrderStatus;
const SECRET_NOTE = "INTERNAL: the unit is a lemon, quote a replacement.";
const SECRET_REASON = "INTERNAL: the customer's cheque bounced.";

/** A row as the database would return it for the customer's select, plus columns it must never read. */
function row(overrides: Partial<CustomerDetailRow> = {}): CustomerDetailRow {
  const base: CustomerDetailRow = {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "JOB-2026-00042",
    status: S.SCHEDULED,
    serviceNameSnapshot: "AC Repair",
    scheduledStart: new Date("2026-03-03T15:00:00.000Z"),
    scheduledEnd: new Date("2026-03-03T17:00:00.000Z"),
    completedAt: null,
    technician: { name: "Jordan Lee" },
    customerId: "customer-1",
    scopeDescription: "The unit will not cool.",
    addressLine1: "214 Larkspur Lane",
    addressLine2: null,
    addressCity: "Brooklyn",
    addressRegion: "NY",
    addressPostalCode: "11201",
    accessNotesSnapshot: "Side gate code is 4471.",
    startedAt: null,
    cancelledAt: null,
    completionNote: null,
    request: { id: "request-1", reference: "FF-2026-00001" },
    quotation: { id: "quotation-1", reference: "QT-2026-00001" },
    invoices: [],
  };
  return { ...base, ...overrides };
}

/** The same row, carrying the columns a careless serializer would leak. */
function rowWithSecrets(overrides: Partial<CustomerDetailRow> = {}): CustomerDetailRow {
  return {
    ...row(overrides),
    internalCompletionNote: SECRET_NOTE,
    cancelReason: SECRET_REASON,
    createdByUserId: "staff-1",
    technicianId: "technician-1",
    technician: {
      name: overrides.technician?.name ?? "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
    },
  } as CustomerDetailRow;
}

const timeline = [
  {
    id: "event-1",
    publicSummary: "We created job JOB-2026-00042 for your request.",
    toStatus: "PENDING_SCHEDULING",
    actor: "CoolBreeze Home Services",
    createdAt: "2026-03-02T10:00:00.000Z",
  },
];

function dto(overrides: Partial<CustomerDetailRow> = {}) {
  return toCustomerWorkOrderDto({
    row: rowWithSecrets(overrides),
    timeline,
    timeZone: "America/New_York",
    now: new Date("2026-03-04T12:00:00.000Z"),
  });
}

describe("what the customer's queries read", () => {
  it("selects no internal note, no reason, no staff and no technician contact detail", () => {
    const columns = [...Object.keys(CUSTOMER_LIST_SELECT), ...Object.keys(CUSTOMER_DETAIL_SELECT)];
    for (const forbidden of [
      "internalCompletionNote",
      "cancelReason",
      "createdByUserId",
      "createdBy",
      "technicianId",
      "customer",
    ]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
    expect(CUSTOMER_LIST_SELECT.technician).toEqual({ select: { name: true } });
  });

  it("reads the invoice only as the customer-safe link: issued, not void, a handful of columns (T22)", () => {
    // T18 forbade any invoice column here; T22 deliberately lets the job link to the invoice the
    // customer may see, through an allowlisted select and nothing else.
    expect(CUSTOMER_DETAIL_SELECT.invoices.where).toEqual({
      issuedAt: { not: null },
      voidedAt: null,
      status: { not: "VOID" },
    });
    expect(CUSTOMER_DETAIL_SELECT.invoices.take).toBe(1);
    expect(Object.keys(CUSTOMER_DETAIL_SELECT.invoices.select).sort()).toEqual([
      "amountPaid",
      "dueDate",
      "id",
      "invoiceNumber",
      "issuedAt",
      "totalAmount",
      "voidedAt",
    ]);
  });
});

describe("technicianDisplayName", () => {
  it("is the first name only", () => {
    expect(technicianDisplayName("Jordan Lee")).toBe("Jordan");
    expect(technicianDisplayName("  Sam   Ortiz-Reyes  ")).toBe("Sam");
    expect(technicianDisplayName("Prince")).toBe("Prince");
  });

  it("falls back to a plain phrase for a blank name", () => {
    expect(technicianDisplayName("   ")).toBe("Your technician");
  });
});

describe("toCustomerWorkOrderListItem", () => {
  it("has exactly the card's fields", () => {
    expect(Object.keys(toCustomerWorkOrderListItem(rowWithSecrets())).sort()).toEqual(
      [
        "completedAt",
        "id",
        "reference",
        "scheduledEnd",
        "scheduledStart",
        "serviceName",
        "status",
        "statusLabel",
        "technician",
      ].sort(),
    );
  });

  it("shows the visit and the technician's first name for a scheduled job", () => {
    expect(toCustomerWorkOrderListItem(rowWithSecrets())).toEqual({
      id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      reference: "JOB-2026-00042",
      status: S.SCHEDULED,
      statusLabel: "Scheduled",
      serviceName: "AC Repair",
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technician: { displayName: "Jordan" },
      completedAt: null,
    });
  });

  it.each([S.PENDING_SCHEDULING, S.NEEDS_RESCHEDULING, S.CANCELLED])(
    "shows no visit and no technician for a %s job, even if the row keeps its old appointment",
    (status) => {
      const item = toCustomerWorkOrderListItem(rowWithSecrets({ status }));
      expect(item.scheduledStart).toBeNull();
      expect(item.scheduledEnd).toBeNull();
      expect(item.technician).toBeNull();
    },
  );

  it.each([S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED])(
    "shows the visit and the technician for a %s job",
    (status) => {
      const item = toCustomerWorkOrderListItem(rowWithSecrets({ status }));
      expect(item.scheduledStart).toBe("2026-03-03T15:00:00.000Z");
      expect(item.technician).toEqual({ displayName: "Jordan" });
    },
  );

  it("shows no technician when the job has none", () => {
    expect(toCustomerWorkOrderListItem(row({ technician: null })).technician).toBeNull();
  });

  it("never carries a technician's phone, email or id", () => {
    const json = JSON.stringify(toCustomerWorkOrderListItem(rowWithSecrets()));
    for (const leak of ["555-0151", "coolbreeze.test", "technician-1", "Lee"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("toCustomerWorkOrderDto", () => {
  it("has exactly the detail's fields and no more", () => {
    expect(Object.keys(dto()).sort()).toEqual(
      [
        "address",
        "cancelledAt",
        "completedAt",
        "completionNote",
        "id",
        "invoice",
        "previouslyScheduled",
        "quotation",
        "reference",
        "request",
        "scheduledEnd",
        "scheduledStart",
        "scopeDescription",
        "serviceName",
        "startedAt",
        "status",
        "statusExplanation",
        "statusLabel",
        "technician",
        "timeZone",
        "timeline",
      ].sort(),
    );
  });

  it("never carries the internal note, the cancellation reason or any staff identity", () => {
    for (const status of Object.values(S)) {
      const json = JSON.stringify(
        dto({ status, completionNote: "All done.", cancelledAt: new Date() }),
      );
      for (const leak of [
        SECRET_NOTE,
        SECRET_REASON,
        "lemon",
        "cheque",
        "staff-1",
        "technician-1",
        "555-0151",
        "jordan.lee@",
        "internalCompletionNote",
        "cancelReason",
      ]) {
        expect(json, `${status}: ${leak}`).not.toContain(leak);
      }
    }
  });

  it("explains the status in plain words and carries the business time zone", () => {
    const inProgress = dto({ status: S.IN_PROGRESS });
    expect(inProgress.statusExplanation).toBe("Your technician has started work.");
    expect(inProgress.timeZone).toBe("America/New_York");
  });

  it("gives the completion note only to a completed job", () => {
    const note = "Replaced the run capacitor; the unit now cools to 68 degrees.";
    expect(dto({ status: S.COMPLETED, completionNote: note }).completionNote).toBe(note);
    for (const status of [S.SCHEDULED, S.IN_PROGRESS, S.CANCELLED, S.NEEDS_RESCHEDULING]) {
      expect(dto({ status, completionNote: note }).completionNote).toBeNull();
    }
  });

  it("keeps the appointment of a job that needs a new time or was cancelled as history only", () => {
    for (const status of [S.NEEDS_RESCHEDULING, S.CANCELLED]) {
      const item = dto({ status });
      expect(item.scheduledStart).toBeNull();
      expect(item.previouslyScheduled).toEqual({
        start: "2026-03-03T15:00:00.000Z",
        end: "2026-03-03T17:00:00.000Z",
      });
    }
    for (const status of [S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED, S.PENDING_SCHEDULING]) {
      expect(dto({ status }).previouslyScheduled).toBeNull();
    }
  });

  it("has no previous appointment for a cancelled job that was never scheduled", () => {
    const item = dto({ status: S.CANCELLED, scheduledStart: null, scheduledEnd: null });
    expect(item.previouslyScheduled).toBeNull();
  });

  it("links the request and the quotation, and has no invoice link until one is issued", () => {
    const item = dto();
    expect(item.request).toEqual({ id: "request-1", reference: "FF-2026-00001" });
    expect(item.quotation).toEqual({ id: "quotation-1", reference: "QT-2026-00001" });
    expect(item.invoice).toBeNull();
  });

  it("links the issued invoice with its number and what it is now (T22)", () => {
    const invoice = {
      id: "invoice-1",
      invoiceNumber: "INV-2026-00012",
      issuedAt: new Date("2026-03-01T15:00:00.000Z"),
      voidedAt: null,
      totalAmount: new Prisma.Decimal("120.00"),
      amountPaid: new Prisma.Decimal("0.00"),
      dueDate: new Date("2026-03-03T00:00:00.000Z"),
    };
    // Past the due date in New York, so the link says it is overdue.
    expect(dto({ status: S.COMPLETED, invoices: [invoice] }).invoice).toEqual({
      id: "invoice-1",
      invoiceNumber: "INV-2026-00012",
      status: "OVERDUE",
      statusLabel: "Overdue",
    });
  });

  it("shows the address the customer gave, with their own access notes", () => {
    expect(dto().address).toEqual({
      line1: "214 Larkspur Lane",
      line2: null,
      city: "Brooklyn",
      region: "NY",
      postalCode: "11201",
      accessNotes: "Side gate code is 4471.",
    });
  });

  it("passes the customer's timeline through as it is", () => {
    expect(dto().timeline).toEqual(timeline);
  });
});
