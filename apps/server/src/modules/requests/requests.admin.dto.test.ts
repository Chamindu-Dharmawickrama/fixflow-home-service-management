import { describe, expect, it } from "vitest";

import {
  type AdminDetailRow,
  type AdminListRow,
  toAdminRequestDto,
  toAdminRequestListItem,
} from "./requests.admin.dto.js";

function listRow(overrides: Partial<AdminListRow> = {}): AdminListRow {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "FF-2026-00012",
    status: "SUBMITTED",
    serviceNameSnapshot: "AC Repair",
    addressCity: "Harbor City",
    preferredDate: new Date("2026-11-10T00:00:00.000Z"),
    preferredWindow: "MORNING",
    submittedAt: new Date("2026-10-30T14:05:00.000Z"),
    updatedAt: new Date("2026-10-30T14:05:00.000Z"),
    customer: { user: { name: "Alex Morgan" } },
    ...overrides,
  };
}

function detailRow(overrides: Partial<AdminDetailRow> = {}): AdminDetailRow {
  return {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "FF-2026-00012",
    status: "UNDER_REVIEW",
    serviceId: "7d8e3a20-8b3c-4d20-9b3f-4f1f5c9e1c33",
    serviceNameSnapshot: "AC Repair",
    description: "The unit stopped cooling and rattles when it starts.",
    addressLine1: "214 Larkspur Lane",
    addressLine2: "Unit 4",
    addressCity: "Harbor City",
    addressRegion: "NY",
    addressPostalCode: "10001",
    accessNotesSnapshot: "Gate code 4821",
    preferredDate: new Date("2026-11-10T00:00:00.000Z"),
    preferredWindow: "MORNING",
    preferredStart: new Date("2026-11-10T13:00:00.000Z"),
    preferredEnd: new Date("2026-11-10T17:00:00.000Z"),
    submittedAt: new Date("2026-10-30T14:05:00.000Z"),
    updatedAt: new Date("2026-10-30T15:00:00.000Z"),
    cancelReason: null,
    cancelCustomerMessage: null,
    cancelledAt: null,
    cancelledBy: null,
    customerId: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
    customer: {
      id: "1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22",
      phone: "(212) 555-0171",
      user: { name: "Alex Morgan", email: "alex.morgan@example.test" },
    },
    notes: [],
    ...overrides,
  };
}

const HISTORY = { previous: [], totalRequests: 1, workOrderCount: 0, invoiceCount: 0 };

describe("toAdminRequestListItem", () => {
  it("has the queue's fields and nothing else", () => {
    expect(toAdminRequestListItem(listRow())).toEqual({
      id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
      reference: "FF-2026-00012",
      status: "SUBMITTED",
      statusLabel: "Submitted",
      isNew: true,
      serviceName: "AC Repair",
      customerName: "Alex Morgan",
      city: "Harbor City",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submittedAt: "2026-10-30T14:05:00.000Z",
      updatedAt: "2026-10-30T14:05:00.000Z",
    });
  });

  it("flags only a SUBMITTED request as new", () => {
    expect(toAdminRequestListItem(listRow({ status: "SUBMITTED" })).isNew).toBe(true);
    for (const status of ["UNDER_REVIEW", "QUOTED", "ACCEPTED", "DECLINED", "CANCELLED"] as const) {
      expect(toAdminRequestListItem(listRow({ status })).isNew, status).toBe(false);
    }
  });

  it("does not put the description, address lines or the customer's contact details in a row", () => {
    const text = JSON.stringify(toAdminRequestListItem(listRow()));

    expect(text).not.toContain("email");
    expect(text).not.toContain("description");
    expect(text).not.toContain("addressLine1");
  });
});

describe("toAdminRequestDto", () => {
  it("has the customer's fields plus the business's, and the keys are an allowlist", () => {
    const dto = toAdminRequestDto({
      row: detailRow(),
      timeline: [],
      history: HISTORY,
      quotations: [],
    });

    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "reference",
        "status",
        "statusLabel",
        "nextStep",
        "serviceId",
        "serviceName",
        "preferredDate",
        "preferredWindow",
        "preferredStart",
        "preferredEnd",
        "submittedAt",
        "updatedAt",
        "description",
        "address",
        "customer",
        "notes",
        "timeline",
        "cancellation",
        "quotations",
        "availableActions",
      ].sort(),
    );
  });

  it("lists the quotations it is given, and offers Create quotation unless one is already a draft", () => {
    const summary = (id: string, status: "DRAFT" | "VOID") => ({
      id,
      reference: `QT-2026-0000${id}`,
      status,
      statusLabel: status === "DRAFT" ? "Draft" : "Void",
      totalAmount: "100.00",
      currencyCode: "USD",
      validUntil: "2026-12-01",
      sentAt: null,
      createdAt: "2026-11-01T10:00:00.000Z",
      replacesReference: null,
    });
    const underReview = detailRow({ status: "UNDER_REVIEW" });

    const none = toAdminRequestDto({
      row: underReview,
      timeline: [],
      history: HISTORY,
      quotations: [summary("1", "VOID")],
    });
    expect(none.quotations).toHaveLength(1);
    expect(none.availableActions).toEqual(["CREATE_QUOTATION", "CANCEL"]);

    const withDraft = toAdminRequestDto({
      row: underReview,
      timeline: [],
      history: HISTORY,
      quotations: [summary("2", "DRAFT"), summary("1", "VOID")],
    });
    expect(withDraft.quotations.map((quotation) => quotation.id)).toEqual(["2", "1"]);
    expect(withDraft.availableActions).toEqual(["CANCEL"]);
  });

  it("carries the customer's contact details and the access notes", () => {
    const dto = toAdminRequestDto({
      row: detailRow(),
      timeline: [],
      history: HISTORY,
      quotations: [],
    });

    expect(dto.customer).toMatchObject({
      name: "Alex Morgan",
      email: "alex.morgan@example.test",
      phone: "(212) 555-0171",
    });
    expect(dto.address.accessNotes).toBe("Gate code 4821");
  });

  it("lists every note, both visibilities, with the staff member who wrote it", () => {
    const dto = toAdminRequestDto({
      row: detailRow({
        notes: [
          {
            id: "n2",
            body: "Customer asked for a call back.",
            visibility: "INTERNAL",
            createdAt: new Date("2026-10-31T10:00:00.000Z"),
            author: { name: "Morgan Reyes" },
          },
          {
            id: "n1",
            body: "We will bring a spare part.",
            visibility: "CUSTOMER_VISIBLE",
            createdAt: new Date("2026-10-30T16:00:00.000Z"),
            author: { name: "Morgan Reyes" },
          },
        ],
      }),
      timeline: [],
      quotations: [],
      history: HISTORY,
    });

    expect(dto.notes).toEqual([
      {
        id: "n2",
        body: "Customer asked for a call back.",
        visibility: "INTERNAL",
        author: { name: "Morgan Reyes" },
        createdAt: "2026-10-31T10:00:00.000Z",
      },
      {
        id: "n1",
        body: "We will bring a spare part.",
        visibility: "CUSTOMER_VISIBLE",
        author: { name: "Morgan Reyes" },
        createdAt: "2026-10-30T16:00:00.000Z",
      },
    ]);
  });

  it("offers the actions D-21 allows for the status, with the likely next step first", () => {
    const actionsFor = (status: AdminDetailRow["status"]) =>
      toAdminRequestDto({
        row: detailRow({ status }),
        timeline: [],
        history: HISTORY,
        quotations: [],
      }).availableActions;

    expect(actionsFor("SUBMITTED")).toEqual(["START_REVIEW", "CANCEL"]);
    expect(actionsFor("DECLINED")).toEqual(["REOPEN", "CANCEL"]);
    expect(actionsFor("CANCELLED")).toEqual([]);
  });

  it("has no cancellation for a request that is not cancelled", () => {
    expect(
      toAdminRequestDto({
        row: detailRow({ cancelReason: "left over" }),
        timeline: [],
        quotations: [],
        history: HISTORY,
      }).cancellation,
    ).toBeNull();
  });

  it("gives a cancelled request's internal reason, who cancelled it, when, and what the customer was told", () => {
    const dto = toAdminRequestDto({
      row: detailRow({
        status: "CANCELLED",
        cancelReason: "Outside our service area.",
        cancelCustomerMessage: "Sorry, we do not cover your street.",
        cancelledAt: new Date("2026-10-31T09:00:00.000Z"),
        cancelledBy: { name: "Morgan Reyes" },
      }),
      timeline: [],
      quotations: [],
      history: HISTORY,
    });

    expect(dto.cancellation).toEqual({
      cancelledAt: "2026-10-31T09:00:00.000Z",
      cancelledBy: { name: "Morgan Reyes" },
      reason: "Outside our service area.",
      customerMessage: "Sorry, we do not cover your street.",
    });
  });

  it("describes the customer's history: earlier requests, and how many jobs and invoices they have had", () => {
    const dto = toAdminRequestDto({
      row: detailRow(),
      timeline: [],
      quotations: [],
      history: {
        previous: [
          {
            id: "p1",
            reference: "FF-2026-00003",
            serviceNameSnapshot: "Home Deep Cleaning",
            status: "CONVERTED_TO_JOB",
            submittedAt: new Date("2026-08-01T10:00:00.000Z"),
          },
        ],
        totalRequests: 2,
        workOrderCount: 1,
        invoiceCount: 1,
      },
    });

    expect(dto.customer.previousRequests).toEqual([
      {
        id: "p1",
        reference: "FF-2026-00003",
        serviceName: "Home Deep Cleaning",
        status: "CONVERTED_TO_JOB",
        statusLabel: "Converted to job",
        submittedAt: "2026-08-01T10:00:00.000Z",
      },
    ]);
    expect(dto.customer).toMatchObject({ totalRequests: 2, workOrderCount: 1, invoiceCount: 1 });
  });

  it("does not expose a password hash, a session or the customer's user id", () => {
    const text = JSON.stringify(
      toAdminRequestDto({ row: detailRow(), timeline: [], history: HISTORY, quotations: [] }),
    );

    expect(text).not.toMatch(/passwordHash|googleSubject|sessionId/);
  });
});
