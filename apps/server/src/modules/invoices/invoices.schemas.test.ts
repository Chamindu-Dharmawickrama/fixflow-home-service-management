import { describe, expect, it } from "vitest";

import {
  adminInvoicesQuerySchema,
  createInvoiceBodySchema,
  issueInvoiceBodySchema,
  updateInvoiceBodySchema,
  voidInvoiceBodySchema,
} from "./invoices.schemas.js";

const LINE = { description: "Capacitor", quantity: "1", unitPrice: "45.50", taxable: true };
const UPDATE = {
  lines: [LINE],
  discountAmount: "0.00",
  taxRate: "8.00",
  issueDate: null,
  dueDate: "2026-03-16",
  customerNote: null,
  expectedUpdatedAt: "2026-03-02T09:00:00.000Z",
};

describe("updateInvoiceBodySchema", () => {
  it("accepts a complete body, with or without an issue date", () => {
    expect(updateInvoiceBodySchema.safeParse(UPDATE).success).toBe(true);
    expect(updateInvoiceBodySchema.safeParse({ ...UPDATE, issueDate: "2026-03-02" }).success).toBe(
      true,
    );
  });

  it.each([
    "subtotal",
    "taxableBase",
    "taxAmount",
    "totalAmount",
    "amountPaid",
    "balanceDue",
    "status",
  ])("refuses a body that names %s: a total cannot even be named", (field) => {
    expect(updateInvoiceBodySchema.safeParse({ ...UPDATE, [field]: "1.00" }).success).toBe(false);
  });

  it("refuses a line that names its own total", () => {
    expect(
      updateInvoiceBodySchema.safeParse({ ...UPDATE, lines: [{ ...LINE, lineTotal: "1.00" }] })
        .success,
    ).toBe(false);
  });

  it("needs every field, because a save replaces the draft", () => {
    for (const key of Object.keys(UPDATE)) {
      const { [key as keyof typeof UPDATE]: _omitted, ...rest } = UPDATE;
      expect(updateInvoiceBodySchema.safeParse(rest).success).toBe(false);
    }
  });

  it("puts the due-date problem on dueDate", () => {
    const result = updateInvoiceBodySchema.safeParse({
      ...UPDATE,
      issueDate: "2026-03-10",
      dueDate: "2026-03-09",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["dueDate"]);
  });

  it("limits the lines to 1..50", () => {
    expect(updateInvoiceBodySchema.safeParse({ ...UPDATE, lines: [] }).success).toBe(false);
    expect(
      updateInvoiceBodySchema.safeParse({
        ...UPDATE,
        lines: Array.from({ length: 50 }, () => LINE),
      }).success,
    ).toBe(true);
    expect(
      updateInvoiceBodySchema.safeParse({
        ...UPDATE,
        lines: Array.from({ length: 51 }, () => LINE),
      }).success,
    ).toBe(false);
  });

  it("treats a blank note as no note", () => {
    const parsed = updateInvoiceBodySchema.parse({ ...UPDATE, customerNote: "   " });
    expect(parsed.customerNote).toBeNull();
  });
});

describe("issue, void and create bodies", () => {
  it("issue takes exactly expectedStatus DRAFT", () => {
    expect(issueInvoiceBodySchema.safeParse({ expectedStatus: "DRAFT" }).success).toBe(true);
    expect(issueInvoiceBodySchema.safeParse({ expectedStatus: "ISSUED" }).success).toBe(false);
    expect(issueInvoiceBodySchema.safeParse({}).success).toBe(false);
    expect(
      issueInvoiceBodySchema.safeParse({ expectedStatus: "DRAFT", invoiceNumber: "INV-1" }).success,
    ).toBe(false);
  });

  it("void needs a reason of 5 to 500 characters and a known status", () => {
    const ok = { reason: "Raised in error.", expectedStatus: "ISSUED" };
    expect(voidInvoiceBodySchema.safeParse(ok).success).toBe(true);
    expect(voidInvoiceBodySchema.safeParse({ ...ok, reason: "abcd" }).success).toBe(false);
    expect(voidInvoiceBodySchema.safeParse({ ...ok, reason: "x".repeat(501) }).success).toBe(false);
    expect(voidInvoiceBodySchema.safeParse({ ...ok, expectedStatus: "NOPE" }).success).toBe(false);
    expect(voidInvoiceBodySchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("create takes nothing", () => {
    expect(createInvoiceBodySchema.safeParse({}).success).toBe(true);
    expect(createInvoiceBodySchema.safeParse({ dueDate: "2026-03-16" }).success).toBe(false);
  });
});

describe("adminInvoicesQuerySchema", () => {
  it("defaults to the newest first, 20 to a page", () => {
    expect(adminInvoicesQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("reads one or several statuses, repeated or comma-separated", () => {
    expect(adminInvoicesQuerySchema.parse({ status: "OVERDUE" }).status).toEqual(["OVERDUE"]);
    expect(adminInvoicesQuerySchema.parse({ status: ["DRAFT", "PAID"] }).status).toEqual([
      "DRAFT",
      "PAID",
    ]);
    expect(adminInvoicesQuerySchema.parse({ status: "DRAFT,VOID" }).status).toEqual([
      "DRAFT",
      "VOID",
    ]);
    expect(adminInvoicesQuerySchema.safeParse({ status: "LATE" }).success).toBe(false);
  });

  it("allowlists the sort fields", () => {
    for (const sort of ["createdAt", "issueDate", "dueDate", "totalAmount", "status"]) {
      expect(adminInvoicesQuerySchema.safeParse({ sort }).success).toBe(true);
    }
    expect(adminInvoicesQuerySchema.safeParse({ sort: "customerId" }).success).toBe(false);
  });

  it("checks that each range runs forwards", () => {
    expect(
      adminInvoicesQuerySchema.safeParse({ dueFrom: "2026-03-02", dueTo: "2026-03-02" }).success,
    ).toBe(true);
    expect(
      adminInvoicesQuerySchema.safeParse({ dueFrom: "2026-03-03", dueTo: "2026-03-02" }).success,
    ).toBe(false);
    expect(
      adminInvoicesQuerySchema.safeParse({ issuedFrom: "2026-03-03", issuedTo: "2026-03-02" })
        .success,
    ).toBe(false);
  });

  it("treats a blank search as none", () => {
    expect(adminInvoicesQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(adminInvoicesQuerySchema.parse({ q: " INV-1 " }).q).toBe("INV-1");
  });
});
