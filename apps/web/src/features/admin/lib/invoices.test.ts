import { describe, expect, it } from "vitest";

import { adminInvoice } from "../test-fixtures";
import {
  adminInvoicePath,
  DUE_BEFORE_ISSUE,
  hasActiveInvoiceFilters,
  INVOICE_STATUS_ORDER,
  invoiceFieldLabels,
  invoiceFormProblems,
  type InvoiceFormValues,
  invoicesFormCarryOver,
  invoicesSortHref,
  invoicesStatusHref,
  invoiceTitle,
  invoiceToFormValues,
  overdueSentence,
  parseInvoicesQuery,
  singleStatus,
  splitInvoiceApiProblems,
  toInvoicesApiQueryString,
  toInvoiceUpdateBody,
} from "./invoices";

describe("addresses and words", () => {
  it("keys an invoice by its id, never by its number", () => {
    expect(adminInvoicePath("abc 123")).toBe("/app/invoices/abc%20123");
  });

  it("names an invoice by its number, or says it is a draft", () => {
    expect(invoiceTitle({ invoiceNumber: "INV-2026-00004" })).toBe("INV-2026-00004");
    expect(invoiceTitle({ invoiceNumber: null })).toBe("Draft invoice");
  });

  it("says how late an invoice is, in the singular and the plural", () => {
    expect(overdueSentence(1)).toBe("Overdue by 1 day");
    expect(overdueSentence(4)).toBe("Overdue by 4 days");
  });

  it("orders the chips from a draft to a settled invoice, void last", () => {
    expect(INVOICE_STATUS_ORDER).toEqual([
      "DRAFT",
      "ISSUED",
      "PARTIALLY_PAID",
      "OVERDUE",
      "PAID",
      "VOID",
    ]);
  });
});

describe("parseInvoicesQuery", () => {
  it("defaults to every status, newest first, page 1", () => {
    expect(parseInvoicesQuery({})).toEqual({
      status: [],
      q: undefined,
      dueFrom: undefined,
      dueTo: undefined,
      sort: "createdAt",
      order: "desc",
      page: 1,
    });
  });

  it("reads a status, a search, a due range, a sort and a page", () => {
    expect(
      parseInvoicesQuery({
        status: "OVERDUE",
        q: "  Okafor ",
        dueFrom: "2026-03-01",
        dueTo: "2026-03-31",
        sort: "dueDate",
        order: "asc",
        page: "3",
      }),
    ).toEqual({
      status: ["OVERDUE"],
      q: "Okafor",
      dueFrom: "2026-03-01",
      dueTo: "2026-03-31",
      sort: "dueDate",
      order: "asc",
      page: 3,
    });
  });

  it("ignores what it cannot use instead of failing the page", () => {
    const query = parseInvoicesQuery({
      status: "SHIPPED",
      sort: "customerId",
      order: "sideways",
      page: "-4",
      dueFrom: "12/03/2026",
      q: "   ",
    });
    expect(query).toMatchObject({
      status: [],
      sort: "createdAt",
      order: "desc",
      page: 1,
      dueFrom: undefined,
      q: undefined,
    });
  });

  it("puts a range given backwards the right way round", () => {
    const query = parseInvoicesQuery({ dueFrom: "2026-03-31", dueTo: "2026-03-01" });
    expect(query.dueFrom).toBe("2026-03-01");
    expect(query.dueTo).toBe("2026-03-31");
  });

  it("starts a chosen column ascending, and keeps the default column's own order", () => {
    expect(parseInvoicesQuery({ sort: "totalAmount" }).order).toBe("asc");
    expect(parseInvoicesQuery({ sort: "createdAt" }).order).toBe("desc");
  });

  it("reads several statuses, comma-separated or repeated, in the order of an invoice's life", () => {
    // The dashboard's "unpaid balance" link names three at once.
    expect(parseInvoicesQuery({ status: "OVERDUE,ISSUED,PARTIALLY_PAID" }).status).toEqual([
      "ISSUED",
      "PARTIALLY_PAID",
      "OVERDUE",
    ]);
    expect(parseInvoicesQuery({ status: ["VOID", "PAID"] }).status).toEqual(["PAID", "VOID"]);
    expect(parseInvoicesQuery({ status: "PAID,SHIPPED,PAID" }).status).toEqual(["PAID"]);
  });

  it("knows the one status a chip chose", () => {
    expect(singleStatus(parseInvoicesQuery({ status: "PAID" }))).toBe("PAID");
    expect(singleStatus(parseInvoicesQuery({ status: "PAID,VOID" }))).toBeUndefined();
    expect(singleStatus(parseInvoicesQuery({}))).toBeUndefined();
  });
});

describe("the list's links and API query", () => {
  it("builds the API query from the parsed address", () => {
    const query = parseInvoicesQuery({ status: "DRAFT", q: "x", dueFrom: "2026-03-01" });
    const params = new URLSearchParams(toInvoicesApiQueryString(query));
    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
      sort: "createdAt",
      order: "desc",
      status: "DRAFT",
      q: "x",
      dueFrom: "2026-03-01",
    });
  });

  it("sends only what is set", () => {
    const params = new URLSearchParams(toInvoicesApiQueryString(parseInvoicesQuery({})));
    expect([...params.keys()].sort()).toEqual(["order", "page", "pageSize", "sort"]);
  });

  it("knows when a search or a due date narrows the list, and when only a status does", () => {
    expect(hasActiveInvoiceFilters(parseInvoicesQuery({}))).toBe(false);
    expect(hasActiveInvoiceFilters(parseInvoicesQuery({ status: "PAID" }))).toBe(false);
    expect(hasActiveInvoiceFilters(parseInvoicesQuery({ q: "x" }))).toBe(true);
    expect(hasActiveInvoiceFilters(parseInvoicesQuery({ dueTo: "2026-03-01" }))).toBe(true);
  });

  it("carries the status and a non-default sort through the filter form", () => {
    expect(invoicesFormCarryOver(parseInvoicesQuery({}))).toEqual({});
    expect(invoicesFormCarryOver(parseInvoicesQuery({ status: "ISSUED,OVERDUE" }))).toEqual({
      status: "ISSUED,OVERDUE",
    });
    expect(
      invoicesFormCarryOver(parseInvoicesQuery({ status: "OVERDUE", sort: "dueDate" })),
    ).toEqual({ status: "OVERDUE", sort: "dueDate", order: "asc" });
  });

  it("builds a chip's link: that status, page 1, search and dates kept", () => {
    expect(invoicesStatusHref({ q: "x", page: "4", status: "PAID" }, "OVERDUE")).toBe(
      "/app/invoices?q=x&status=OVERDUE",
    );
    expect(invoicesStatusHref({ status: "PAID", dueFrom: "2026-03-01" }, undefined)).toBe(
      "/app/invoices?dueFrom=2026-03-01",
    );
    expect(invoicesStatusHref({}, ["ISSUED", "OVERDUE"])).toBe(
      "/app/invoices?status=ISSUED%2COVERDUE",
    );
  });

  it("flips a sorted column's order, and starts another ascending", () => {
    const query = parseInvoicesQuery({ sort: "dueDate", order: "asc" });
    expect(invoicesSortHref({ sort: "dueDate", order: "asc" }, query, "dueDate")).toBe(
      "/app/invoices?sort=dueDate&order=desc",
    );
    expect(invoicesSortHref({ sort: "dueDate", order: "asc" }, query, "totalAmount")).toBe(
      "/app/invoices?sort=totalAmount&order=asc",
    );
  });
});

const VALID: InvoiceFormValues = {
  lines: [{ description: "Capacitor", quantity: "1", unitPrice: "45.50", taxable: true }],
  discountAmount: "0.00",
  taxRate: "8.00",
  issueDate: "",
  dueDate: "2026-03-16",
  customerNote: "",
};

describe("the editor's form", () => {
  it("shows a saved draft as typed text: quantities as a person writes them, an empty issue date as empty", () => {
    const values = invoiceToFormValues(adminInvoice());
    expect(values.lines[2]).toEqual({
      description: "Labour",
      quantity: "1.5",
      unitPrice: "85.00",
      taxable: false,
    });
    expect(values.lines[0]?.quantity).toBe("1");
    expect(values.issueDate).toBe("");
    expect(values.dueDate).toBe("2026-03-16");
    expect(values.customerNote).toBe("");
  });

  it("sends the lines and details with the saved version, trimmed, a blank note and issue date as null, and no total", () => {
    const body = toInvoiceUpdateBody(
      {
        ...VALID,
        lines: [
          { description: " Capacitor ", quantity: " 2 ", unitPrice: "45.50 ", taxable: true },
        ],
        customerNote: "   ",
      },
      "2026-03-02T14:05:00.000Z",
    );
    expect(body).toEqual({
      lines: [{ description: "Capacitor", quantity: "2", unitPrice: "45.50", taxable: true }],
      discountAmount: "0.00",
      taxRate: "8.00",
      issueDate: null,
      dueDate: "2026-03-16",
      customerNote: null,
      expectedUpdatedAt: "2026-03-02T14:05:00.000Z",
    });
    for (const total of ["subtotal", "taxAmount", "totalAmount", "amountPaid", "balanceDue"]) {
      expect(body).not.toHaveProperty(total);
    }
  });

  it("finds no problem with a good form", () => {
    expect(invoiceFormProblems(VALID)).toEqual({});
    expect(invoiceFormProblems({ ...VALID, issueDate: "2026-03-16" })).toEqual({});
  });

  it("names the field of each problem", () => {
    const problems = invoiceFormProblems({
      lines: [
        { description: "", quantity: "0", unitPrice: "1", taxable: true },
        { description: "ok", quantity: "1", unitPrice: "-5", taxable: true },
      ],
      discountAmount: "0.00",
      taxRate: "150",
      issueDate: "later",
      dueDate: "",
      customerNote: "x".repeat(2001),
    });
    expect(Object.keys(problems).sort()).toEqual(
      [
        "customerNote",
        "dueDate",
        "issueDate",
        "lines.0.description",
        "lines.0.quantity",
        "lines.1.unitPrice",
        "taxRate",
      ].sort(),
    );
  });

  it("requires a due date on or after a chosen issue date", () => {
    expect(
      invoiceFormProblems({ ...VALID, issueDate: "2026-03-10", dueDate: "2026-03-09" }).dueDate,
    ).toBe(DUE_BEFORE_ISSUE);
    expect(
      invoiceFormProblems({ ...VALID, issueDate: "2026-03-10", dueDate: "2026-03-10" }),
    ).toEqual({});
  });

  it("labels each line's fields by the line", () => {
    expect(invoiceFieldLabels(2)).toMatchObject({
      dueDate: "Due date",
      "lines.1.quantity": "Line 2 quantity",
    });
  });

  it("puts field problems beside their field and the rest above the form", () => {
    expect(
      splitInvoiceApiProblems({
        "lines.1.quantity": "Bad quantity",
        dueDate: "Bad due date",
        totalAmount: "The total must be more than zero before the invoice can be issued.",
        lines: "Add at least one line before issuing.",
      }),
    ).toEqual({
      fields: {
        "lines.1.quantity": "Bad quantity",
        dueDate: "Bad due date",
        lines: "Add at least one line before issuing.",
      },
      banner: "The total must be more than zero before the invoice can be issued.",
    });
    expect(splitInvoiceApiProblems(undefined)).toEqual({ fields: {}, banner: null });
  });
});
