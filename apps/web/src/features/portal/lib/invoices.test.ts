import { describe, expect, it } from "vitest";

import { customerInvoiceListItem } from "../test-fixtures";
import {
  balanceHeadline,
  fallbackPdfName,
  invoicePdfPath,
  invoicesApiQuery,
  invoicesFilterHref,
  isOutstandingStatus,
  OUTSTANDING_INVOICES_COUNT,
  outstandingApiQuery,
  overdueByText,
  paidDirectlyNote,
  parseInvoicesQuery,
  PORTAL_INVOICES_PAGE_SIZE,
  portalInvoicePath,
} from "./invoices";

const ZONE = "America/New_York";

describe("addresses", () => {
  it("keys an invoice by its id, encoded", () => {
    expect(portalInvoicePath("7d3c9b1a-2e4f")).toBe("/portal/invoices/7d3c9b1a-2e4f");
    expect(portalInvoicePath("a/b c")).toBe("/portal/invoices/a%2Fb%20c");
  });

  it("points the PDF at the same-origin API, and can ask for it inline", () => {
    expect(invoicePdfPath("abc")).toBe("/api/v1/invoices/abc/pdf");
    expect(invoicePdfPath("abc", { inline: true })).toBe("/api/v1/invoices/abc/pdf?inline=1");
  });

  it("gives each filter its own address, All being the list itself", () => {
    expect(invoicesFilterHref("all")).toBe("/portal/invoices");
    expect(invoicesFilterHref("outstanding")).toBe("/portal/invoices?filter=outstanding");
    expect(invoicesFilterHref("paid")).toBe("/portal/invoices?filter=paid");
  });
});

describe("parseInvoicesQuery", () => {
  it("defaults to every invoice, first page", () => {
    expect(parseInvoicesQuery({})).toEqual({ filter: "all", page: 1 });
  });

  it("reads a filter and a page", () => {
    expect(parseInvoicesQuery({ filter: "paid", page: "3" })).toEqual({ filter: "paid", page: 3 });
    expect(parseInvoicesQuery({ filter: ["outstanding", "paid"] })).toMatchObject({
      filter: "outstanding",
    });
  });

  it.each([
    [{ filter: "DRAFT" }, "all", 1],
    [{ filter: "" }, "all", 1],
    [{ page: "0" }, "all", 1],
    [{ page: "-2" }, "all", 1],
    [{ page: "abc" }, "all", 1],
    [{ page: "1.5" }, "all", 1],
  ])("falls back to the default for the hand-edited address %j", (params, filter, page) => {
    expect(parseInvoicesQuery(params)).toEqual({ filter, page });
  });

  it("caps a page number at the API's limit", () => {
    expect(parseInvoicesQuery({ page: "99999999" }).page).toBeLessThan(99_999_999);
  });
});

describe("the API's query", () => {
  it("asks for no status at all for every invoice", () => {
    const params = new URLSearchParams(invoicesApiQuery({ filter: "all", page: 2 }));
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe(String(PORTAL_INVOICES_PAGE_SIZE));
    expect(params.has("status")).toBe(false);
  });

  it("asks for the statuses that still owe money for Outstanding", () => {
    const params = new URLSearchParams(invoicesApiQuery({ filter: "outstanding", page: 1 }));
    expect(params.get("status")).toBe("ISSUED,PARTIALLY_PAID,OVERDUE");
  });

  it("asks for Paid only for Paid", () => {
    expect(new URLSearchParams(invoicesApiQuery({ filter: "paid", page: 1 })).get("status")).toBe(
      "PAID",
    );
  });

  it("asks for the soonest due first, a few of them, for the portal home", () => {
    const params = new URLSearchParams(outstandingApiQuery());
    expect(params.get("status")).toBe("ISSUED,PARTIALLY_PAID,OVERDUE");
    expect(params.get("sort")).toBe("dueDate");
    expect(params.get("order")).toBe("asc");
    expect(params.get("pageSize")).toBe(String(OUTSTANDING_INVOICES_COUNT));
  });
});

describe("isOutstandingStatus", () => {
  it.each([
    ["ISSUED", true],
    ["PARTIALLY_PAID", true],
    ["OVERDUE", true],
    ["PAID", false],
    ["VOID", false],
    ["DRAFT", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(isOutstandingStatus(status)).toBe(expected);
  });
});

describe("balanceHeadline", () => {
  it("says what is owed and by when for an issued invoice", () => {
    expect(balanceHeadline(customerInvoiceListItem({ balanceDue: "120.00" }), ZONE)).toBe(
      "Balance due $120.00 by Mar 16, 2026",
    );
  });

  it("says what is left of a part-paid invoice", () => {
    expect(
      balanceHeadline(
        customerInvoiceListItem({ status: "PARTIALLY_PAID", balanceDue: "155.64" }),
        ZONE,
      ),
    ).toBe("Balance due $155.64 by Mar 16, 2026");
  });

  it("says when it was paid in full, when the day is known", () => {
    const paid = customerInvoiceListItem({ status: "PAID", balanceDue: "0.00" });
    expect(balanceHeadline(paid, ZONE, "2026-03-03")).toBe("Paid in full on Mar 3, 2026");
    expect(balanceHeadline(paid, ZONE)).toBe("Paid in full");
    expect(balanceHeadline(paid, ZONE, null)).toBe("Paid in full");
  });

  it("says Overdue with what was due and when", () => {
    expect(
      balanceHeadline(
        customerInvoiceListItem({ status: "OVERDUE", balanceDue: "120.00", daysOverdue: 3 }),
        ZONE,
      ),
    ).toBe("Overdue: $120.00 was due Mar 16, 2026");
  });

  it("says nothing is owed on a withdrawn invoice", () => {
    expect(balanceHeadline(customerInvoiceListItem({ status: "VOID" }), ZONE)).toBe(
      "Withdrawn: nothing is owed",
    );
  });

  it("uses the invoice's own currency, not the browser's", () => {
    expect(
      balanceHeadline(customerInvoiceListItem({ currencyCode: "EUR", balanceDue: "10.50" }), ZONE),
    ).toContain("€10.50");
  });
});

describe("wording", () => {
  it("counts days overdue", () => {
    expect(overdueByText(1)).toBe("Overdue by 1 day");
    expect(overdueByText(12)).toBe("Overdue by 12 days");
  });

  it("says payments go to the business, not through FixFlow", () => {
    expect(paidDirectlyNote("CoolBreeze Home Services")).toBe(
      "Payments are made directly to CoolBreeze Home Services; FixFlow doesn't process payments.",
    );
  });

  it("names a file after the invoice, safely", () => {
    expect(fallbackPdfName("INV-2026-00012")).toBe("INV-2026-00012.pdf");
    expect(fallbackPdfName("../etc/passwd")).toBe(".._etc_passwd.pdf");
  });
});
