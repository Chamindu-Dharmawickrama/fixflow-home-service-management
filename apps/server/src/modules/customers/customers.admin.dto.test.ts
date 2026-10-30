import { describe, expect, it } from "vitest";

import { Prisma } from "../../generated/prisma/client.js";
import {
  type AdminCustomerDetailRow,
  type AdminCustomerListRow,
  type CustomerNoteRow,
  type HistoryInvoiceRow,
  type HistoryJobRow,
  type HistoryQuotationRow,
  type HistoryRequestRow,
  toAdminCustomerDto,
  toAdminCustomerListItem,
  toAdminCustomerNote,
  toAdminCustomerRecent,
  toHistoryInvoice,
  toHistoryJob,
  toHistoryQuotation,
  toHistoryRequest,
} from "./customers.admin.dto.js";

const CUSTOMER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const REQUEST = { id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11", reference: "FF-2026-00012" };
const AT = new Date("2026-10-30T14:05:00.000Z");
const keysOf = (value: object) => Object.keys(value).sort();

function listRow(overrides: Partial<AdminCustomerListRow> = {}): AdminCustomerListRow {
  return {
    id: CUSTOMER_ID,
    phone: "(212) 555-0142",
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    user: { name: "Alex Morgan", email: "alex.morgan@example.com" },
    addresses: [{ city: "Harbor City" }],
    ...overrides,
  };
}

const LIST_INPUT = {
  lastActivityAt: AT,
  requestCount: 3,
  openJobCount: 1,
  outstandingBalance: "175.50",
  currencyCode: "USD",
};

describe("toAdminCustomerListItem", () => {
  it("has exactly the fields of a row of the list", () => {
    const item = toAdminCustomerListItem({ row: listRow(), ...LIST_INPUT });
    expect(keysOf(item)).toEqual(
      [
        "city",
        "createdAt",
        "currencyCode",
        "email",
        "id",
        "lastActivityAt",
        "name",
        "openJobCount",
        "outstandingBalance",
        "phone",
        "requestCount",
      ].sort(),
    );
    expect(item).toMatchObject({
      id: CUSTOMER_ID,
      name: "Alex Morgan",
      email: "alex.morgan@example.com",
      phone: "(212) 555-0142",
      city: "Harbor City",
      requestCount: 3,
      openJobCount: 1,
      outstandingBalance: "175.50",
      currencyCode: "USD",
      lastActivityAt: "2026-10-30T14:05:00.000Z",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
  });

  it("has no city when the customer has no address, and no phone when none was given", () => {
    const item = toAdminCustomerListItem({
      row: listRow({ addresses: [], phone: null }),
      ...LIST_INPUT,
    });
    expect(item.city).toBeNull();
    expect(item.phone).toBeNull();
  });

  it("copies fields by name, so a column added to the row reaches no one", () => {
    const row = {
      ...listRow(),
      userId: "user-id",
      passwordHash: "$argon2id$secret",
      googleSubject: "123",
    } as AdminCustomerListRow;
    const json = JSON.stringify(toAdminCustomerListItem({ row, ...LIST_INPUT }));
    expect(json).not.toContain("user-id");
    expect(json).not.toContain("argon2id");
    expect(json).not.toContain("123");
  });
});

describe("history rows", () => {
  it("writes a request", () => {
    const row: HistoryRequestRow = {
      id: REQUEST.id,
      reference: REQUEST.reference,
      serviceNameSnapshot: "AC Repair",
      status: "UNDER_REVIEW",
      preferredDate: new Date("2026-11-10"),
      preferredWindow: "MORNING",
      submittedAt: AT,
    };
    expect(toHistoryRequest(row)).toEqual({
      id: REQUEST.id,
      reference: "FF-2026-00012",
      serviceName: "AC Repair",
      status: "UNDER_REVIEW",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submittedAt: "2026-10-30T14:05:00.000Z",
    });
  });

  it("writes a quotation with its money as a decimal string and a link to its request", () => {
    const row: HistoryQuotationRow = {
      id: "q-1",
      reference: "QT-2026-00004",
      status: "SENT",
      totalAmount: new Prisma.Decimal("108"),
      currencyCode: "USD",
      validUntil: new Date("2026-12-01"),
      sentAt: AT,
      createdAt: AT,
      request: REQUEST,
    };
    expect(toHistoryQuotation(row)).toEqual({
      id: "q-1",
      reference: "QT-2026-00004",
      status: "SENT",
      totalAmount: "108.00",
      currencyCode: "USD",
      validUntil: "2026-12-01",
      sentAt: "2026-10-30T14:05:00.000Z",
      createdAt: "2026-10-30T14:05:00.000Z",
      request: REQUEST,
    });
    expect(toHistoryQuotation({ ...row, sentAt: null }).sentAt).toBeNull();
  });

  it("writes a job, scheduled or not", () => {
    const row: HistoryJobRow = {
      id: "j-1",
      reference: "JOB-2026-00002",
      serviceNameSnapshot: "AC Repair",
      status: "PENDING_SCHEDULING",
      scheduledStart: null,
      completedAt: null,
      createdAt: AT,
      request: REQUEST,
    };
    expect(toHistoryJob(row)).toEqual({
      id: "j-1",
      reference: "JOB-2026-00002",
      serviceName: "AC Repair",
      status: "PENDING_SCHEDULING",
      scheduledStart: null,
      completedAt: null,
      createdAt: "2026-10-30T14:05:00.000Z",
      request: REQUEST,
    });
    expect(
      toHistoryJob({ ...row, scheduledStart: AT, completedAt: AT, status: "COMPLETED" }),
    ).toMatchObject({
      scheduledStart: "2026-10-30T14:05:00.000Z",
      completedAt: "2026-10-30T14:05:00.000Z",
    });
  });

  describe("an invoice", () => {
    const row: HistoryInvoiceRow = {
      id: "i-1",
      invoiceNumber: "INV-2026-00007",
      status: "PARTIALLY_PAID",
      totalAmount: new Prisma.Decimal("108.00"),
      amountPaid: new Prisma.Decimal("40.5"),
      currencyCode: "USD",
      dueDate: new Date("2026-11-14"),
      issuedAt: AT,
      createdAt: AT,
      workOrder: { request: REQUEST },
    };

    it("shows what is paid and what is still owed", () => {
      expect(toHistoryInvoice(row)).toEqual({
        id: "i-1",
        invoiceNumber: "INV-2026-00007",
        status: "PARTIALLY_PAID",
        totalAmount: "108.00",
        amountPaid: "40.50",
        balanceDue: "67.50",
        currencyCode: "USD",
        dueDate: "2026-11-14",
        issuedAt: "2026-10-30T14:05:00.000Z",
        createdAt: "2026-10-30T14:05:00.000Z",
        request: REQUEST,
      });
    });

    it("owes nothing when it is paid or void, and not yet when it is a draft", () => {
      for (const status of ["PAID", "VOID", "DRAFT"] as const) {
        expect(toHistoryInvoice({ ...row, status }).balanceDue, status).toBe("0.00");
      }
    });

    it("has no number, date or issue time while it is a draft", () => {
      const draft = toHistoryInvoice({
        ...row,
        status: "DRAFT",
        invoiceNumber: null,
        dueDate: null,
        issuedAt: null,
      });
      expect(draft).toMatchObject({ invoiceNumber: null, dueDate: null, issuedAt: null });
    });
  });
});

describe("toAdminCustomerNote", () => {
  it("names the author and nothing more about them", () => {
    const row = {
      id: "n-1",
      body: "Prefers calls after 5pm.",
      createdAt: AT,
      author: { name: "Morgan Reyes" },
    } satisfies CustomerNoteRow;
    const note = toAdminCustomerNote({
      ...row,
      authorUserId: "admin-id",
      customerId: CUSTOMER_ID,
    } as CustomerNoteRow);
    expect(note).toEqual({
      id: "n-1",
      body: "Prefers calls after 5pm.",
      author: { name: "Morgan Reyes" },
      createdAt: "2026-10-30T14:05:00.000Z",
    });
  });
});

describe("toAdminCustomerDto", () => {
  const detail: AdminCustomerDetailRow = {
    id: CUSTOMER_ID,
    phone: null,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    user: { name: "Alex Morgan", email: "alex.morgan@example.com" },
    addresses: [
      {
        id: "a-1",
        customerId: CUSTOMER_ID,
        label: "Home",
        line1: "214 Larkspur Lane",
        line2: null,
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
        accessNotes: "Gate code 4821",
        isDefault: true,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    _count: { notes: 60 },
  };

  const dto = toAdminCustomerDto({
    row: detail,
    lastActivityAt: AT,
    summary: {
      requestCount: 1,
      quotationCount: 0,
      jobCount: 0,
      openJobCount: 0,
      invoiceCount: 0,
      outstandingBalance: "0.00",
      currencyCode: "USD",
    },
    recent: toAdminCustomerRecent({ requests: [], quotations: [], jobs: [], invoices: [] }),
    notes: [{ id: "n-1", body: "A note.", createdAt: AT, author: { name: "Morgan Reyes" } }],
  });

  it("has exactly the fields of the customer's page", () => {
    expect(keysOf(dto)).toEqual(
      [
        "addresses",
        "customerSince",
        "email",
        "id",
        "lastActivityAt",
        "name",
        "noteCount",
        "notes",
        "phone",
        "recent",
        "summary",
      ].sort(),
    );
    expect(keysOf(dto.recent)).toEqual(["invoices", "jobs", "quotations", "requests"]);
  });

  it("carries the addresses with their access notes, which the business needs on site", () => {
    expect(dto.addresses).toHaveLength(1);
    expect(dto.addresses[0]).toMatchObject({
      id: "a-1",
      label: "Home",
      accessNotes: "Gate code 4821",
      isDefault: true,
    });
  });

  it("does not carry the owner's id on an address", () => {
    expect(JSON.stringify(dto.addresses)).not.toContain("customerId");
  });

  it("says how many notes exist beside the ones it carries", () => {
    expect(dto.notes).toHaveLength(1);
    expect(dto.noteCount).toBe(60);
  });

  it("has no phone when the customer gave none", () => {
    expect(dto.phone).toBeNull();
  });
});
