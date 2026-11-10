import { InvoiceStatus, PaymentMethod } from "@fixflow/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flat, readPdf } from "../../../test/pdf-text.js";
import { loadBundledLogoSvg } from "./invoice-pdf.assets.js";
import { buildInvoicePdf, INVOICE_PDF_PAGE, plain } from "./invoice-pdf.js";
import type { InvoicePdfSnapshot } from "./invoice-pdf.types.js";

const ZWSP = String.fromCharCode(0x200b);

const address = {
  line1: "100 Harbor Street",
  line2: null,
  city: "Brookhaven",
  region: "NY",
  postalCode: "11719",
};

function snapshot(overrides: Partial<InvoicePdfSnapshot> = {}): InvoicePdfSnapshot {
  return {
    invoiceNumber: "INV-2026-00012",
    status: InvoiceStatus.PARTIALLY_PAID,
    statusLabel: "Partially paid",
    currencyCode: "USD",
    taxRate: "8.00",
    lines: [
      {
        id: "1",
        description: "AC Routine Maintenance",
        quantity: "1.00",
        unitPrice: "129.00",
        lineTotal: "129.00",
        taxable: true,
      },
      {
        id: "2",
        description: "Replacement capacitor",
        quantity: "2.00",
        unitPrice: "34.50",
        lineTotal: "69.00",
        taxable: false,
      },
    ],
    subtotal: "198.00",
    discountAmount: "10.00",
    taxAmount: "10.32",
    totalAmount: "198.32",
    amountPaid: "78.32",
    balanceDue: "120.00",
    issueDate: "2026-11-01",
    dueDate: "2026-11-15",
    daysOverdue: 0,
    customerNote: "Thank you for choosing us.",
    business: {
      name: "CoolBreeze Home Services",
      tagline: "Comfort, delivered.",
      logoKey: "breeze",
      logoUrl: null,
      email: "hello@coolbreeze.example",
      phone: "(555) 010-2030",
      address,
    },
    customer: {
      name: "Alex Morgan",
      email: "alex@example.test",
      address: { ...address, line1: "214 Larkspur Lane" },
    },
    paymentInstructions: "Bank transfer to account 000-111, or cash at the next visit.",
    footer: "CoolBreeze Home Services, a demo business.",
    serviceName: "AC Routine Maintenance",
    jobReference: "JOB-2026-00003",
    requestReference: "FF-2026-00004",
    payments: [
      {
        paymentDate: "2026-11-03",
        method: PaymentMethod.CASH,
        methodLabel: "Cash",
        amount: "78.32",
      },
    ],
    paidOn: null,
    ...overrides,
  };
}

const textOf = readPdf;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildInvoicePdf (FR-072, D-28)", () => {
  it("returns a PDF", async () => {
    const buffer = await buildInvoicePdf(snapshot());
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it("prints the number, the total and the balance due", async () => {
    const { text } = await textOf(await buildInvoicePdf(snapshot()));
    const printed = flat(text);
    expect(printed).toContain("INV-2026-00012");
    expect(printed).toContain("$198.32");
    expect(printed).toContain("Balance due $120.00");
    expect(printed).toContain("Partially paid");
  });

  it("prints the business, the customer, the service, the dates and the references", async () => {
    const printed = flat((await textOf(await buildInvoicePdf(snapshot()))).text);
    for (const expected of [
      "CoolBreeze Home Services",
      "100 Harbor Street",
      "hello@coolbreeze.example",
      "Alex Morgan",
      "214 Larkspur Lane",
      "alex@example.test",
      "AC Routine Maintenance",
      "JOB-2026-00003",
      "FF-2026-00004",
      "Issued Nov 1, 2026",
      "Due Nov 15, 2026",
    ]) {
      expect(printed, expected).toContain(expected);
    }
  });

  it("prints the lines, the totals, the payments that stand, the instructions, the note and the footer", async () => {
    const printed = flat((await textOf(await buildInvoicePdf(snapshot()))).text);
    for (const expected of [
      "Replacement capacitor",
      "$34.50",
      "$69.00",
      "Subtotal $198.00",
      "Discount -$10.00",
      "Tax (8%) $10.32",
      "Total $198.32",
      "Amount paid -$78.32",
      "Nov 3, 2026 Cash $78.32",
      "Bank transfer to account 000-111",
      "Please quote INV-2026-00012 with your payment.",
      "FixFlow doesn't process payments",
      "Note from CoolBreeze Home Services",
      "Thank you for choosing us.",
      "CoolBreeze Home Services, a demo business.",
      "Page 1 of 1",
    ]) {
      expect(printed, expected).toContain(expected);
    }
  });

  it("leaves the discount row out when there is no discount", async () => {
    const printed = flat(
      (await textOf(await buildInvoicePdf(snapshot({ discountAmount: "0.00" })))).text,
    );
    expect(printed).not.toContain("Discount");
  });

  it("says when there are no payments, and when the invoice was paid in full", async () => {
    const none = flat(
      (
        await textOf(
          await buildInvoicePdf(
            snapshot({
              status: InvoiceStatus.ISSUED,
              statusLabel: "Issued",
              payments: [],
              amountPaid: "0.00",
              balanceDue: "198.32",
            }),
          ),
        )
      ).text,
    );
    expect(none).toContain("No payments have been recorded yet.");

    const full = flat(
      (
        await textOf(
          await buildInvoicePdf(
            snapshot({
              status: InvoiceStatus.PAID,
              statusLabel: "Paid",
              amountPaid: "198.32",
              balanceDue: "0.00",
              paidOn: "2026-11-03",
              payments: [
                {
                  paymentDate: "2026-11-03",
                  method: PaymentMethod.BANK_TRANSFER,
                  methodLabel: "Bank transfer",
                  amount: "198.32",
                },
              ],
            }),
          ),
        )
      ).text,
    );
    expect(full).toContain("Paid in full on Nov 3, 2026");
    expect(full).toContain("Balance due $0.00");
    // The instructions stay on a paid invoice, as on the customer's page: it is the same document.
    expect(full).toContain("How to pay");
  });

  it("says how many days an overdue invoice is late", async () => {
    const printed = flat(
      (
        await textOf(
          await buildInvoicePdf(
            snapshot({ status: InvoiceStatus.OVERDUE, statusLabel: "Overdue", daysOverdue: 5 }),
          ),
        )
      ).text,
    );
    expect(printed).toContain("Overdue by 5 days");
  });

  describe("watermarks", () => {
    it("a VOID invoice carries the VOID watermark", async () => {
      const printed = flat(
        (
          await textOf(
            await buildInvoicePdf(snapshot({ status: InvoiceStatus.VOID, statusLabel: "Void" })),
          )
        ).text,
      );
      expect(printed).toContain("VOID");
      // Nothing to pay on a withdrawn invoice.
      expect(printed).not.toContain("How to pay");
    });

    it("a DRAFT preview carries the DRAFT watermark and has no number yet", async () => {
      const printed = flat(
        (
          await textOf(
            await buildInvoicePdf(
              snapshot({
                status: InvoiceStatus.DRAFT,
                statusLabel: "Draft",
                invoiceNumber: null,
                issueDate: null,
                payments: [],
                amountPaid: "0.00",
                balanceDue: "198.32",
              }),
            ),
          )
        ).text,
      );
      expect(printed).toContain("DRAFT");
      expect(printed).toContain("Not numbered yet");
      expect(printed).toContain("Draft invoice");
    });

    it("an issued invoice carries neither watermark", async () => {
      const printed = flat((await textOf(await buildInvoicePdf(snapshot()))).text);
      expect(printed).not.toContain("VOID");
      expect(printed).not.toContain("DRAFT");
    });
  });

  describe("untrusted text (F, SEC-FILE-02)", () => {
    it("prints markup, entities and a formula exactly as written", async () => {
      const hostile =
        "<b>bold</b> <script>alert(1)</script> &amp; =SUM(A1) {{x}} [link](http://x.test)";
      const printed = flat(
        (
          await textOf(
            await buildInvoicePdf(
              snapshot({
                customer: {
                  name: hostile,
                  email: "alex@example.test",
                  address: { ...address, line1: hostile },
                },
                lines: [
                  {
                    id: "1",
                    description: hostile,
                    quantity: "1.00",
                    unitPrice: "10.00",
                    lineTotal: "10.00",
                    taxable: false,
                  },
                ],
                customerNote: hostile,
              }),
            ),
          )
        ).text,
      );
      expect(printed).toContain("<b>bold</b>");
      expect(printed).toContain("<script>alert(1)</script>");
      expect(printed).toContain("&amp;");
      expect(printed).toContain("=SUM(A1)");
      expect(printed).toContain("[link](http://x.test)");
    });

    it("builds a document with characters the font lacks, without failing", async () => {
      const buffer = await buildInvoicePdf(
        snapshot({ customer: { name: "山田 太郎 😀", email: "a@b.test", address } }),
      );
      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("never embeds a link, an action or a script", async () => {
      const buffer = await buildInvoicePdf(
        snapshot({ customerNote: "Visit https://evil.example/pay now", footer: "http://x.test" }),
      );
      // Without compression the object syntax is plain; with it, the dictionary keys still are.
      const raw = buffer.toString("latin1");
      for (const key of [
        "/URI",
        "/JavaScript",
        "/JS ",
        "/Launch",
        "/OpenAction",
        "/EmbeddedFile",
      ]) {
        expect(raw, key).not.toContain(key);
      }
    });

    it("lets a very long unbroken word wrap inside the page, not run past the margin", async () => {
      const long = "W".repeat(300);
      const { text } = await readPdf(
        await buildInvoicePdf(
          snapshot({
            customer: { name: long, email: "a@b.test", address },
            lines: [
              {
                id: "1",
                description: long,
                quantity: "1.00",
                unitPrice: "10.00",
                lineTotal: "10.00",
                taxable: false,
              },
            ],
          }),
        ),
      );
      const longest = Math.max(...text.split("\n").map((line) => line.replaceAll(ZWSP, "").length));
      // 300 characters on one line would run far past the margin; a broken word is a fraction of it.
      expect(longest).toBeLessThan(120);
      // Nothing was lost by breaking it.
      expect(text.replaceAll(ZWSP, "").replace(/\s+/g, "")).toContain(long);
    });
  });

  describe("no outside requests (D-28)", () => {
    it("ignores a logo web address: nothing is fetched while the document is built", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const buffer = await buildInvoicePdf(
        snapshot({
          business: {
            ...snapshot().business,
            logoKey: null,
            logoUrl: "https://attacker.example/logo.png",
          },
        }),
      );
      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(buffer.toString("latin1")).not.toContain("attacker.example");
    });

    it("draws only a bundled logo, and only for a key the shared allowlist knows", () => {
      expect(loadBundledLogoSvg("breeze")).toContain("<svg");
      expect(loadBundledLogoSvg(null)).toBeNull();
      expect(loadBundledLogoSvg("../../../etc/passwd")).toBeNull();
      expect(loadBundledLogoSvg("https://x.test/logo.png")).toBeNull();
    });
  });

  describe("the page", () => {
    it("is as wide as A4 and as tall as Letter, so either paper holds it", () => {
      expect(INVOICE_PDF_PAGE.width).toBeLessThanOrEqual(595.28);
      expect(INVOICE_PDF_PAGE.height).toBeLessThanOrEqual(792);
    });

    it("keeps an ordinary invoice to one page", async () => {
      expect((await textOf(await buildInvoicePdf(snapshot()))).pages).toBe(1);
    });

    it("continues a long invoice onto more pages, each numbered", async () => {
      const lines = Array.from({ length: 60 }, (_, index) => ({
        id: String(index),
        description: `Line item number ${index + 1}`,
        quantity: "1.00",
        unitPrice: "10.00",
        lineTotal: "10.00",
        taxable: false,
      }));
      const { text, pages } = await textOf(await buildInvoicePdf(snapshot({ lines })));
      expect(pages).toBeGreaterThan(1);
      const printed = flat(text);
      expect(printed).toContain(`Page 1 of ${pages}`);
      expect(printed).toContain(`Page ${pages} of ${pages}`);
      // The totals are not cut off by the page break.
      expect(printed).toContain("Balance due $120.00");
    });
  });
});

describe("plain", () => {
  it("removes control characters but keeps line breaks", () => {
    expect(plain("a\u0000b\u0007c\nd")).toBe("abc\nd");
  });

  it("lets a long run break and leaves ordinary text alone", () => {
    expect(plain("two ordinary words")).toBe("two ordinary words");
    const broken = plain("x".repeat(60));
    expect(broken.replaceAll(ZWSP, "")).toBe("x".repeat(60));
    expect(broken).toContain(ZWSP);
  });
});
