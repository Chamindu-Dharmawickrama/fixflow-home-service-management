import { ErrorCode, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signInAs } from "../../test/auth-helpers.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import {
  draftInvoice,
  invoiceFootprint,
  invoiceSnapshot,
  type InvoiceWorld,
  invoiceWorld,
  issued,
  moveClockTo,
  paid,
  payableInvoice,
  saveInvoice,
  voidInvoiceRequest,
  voidPaymentRequest,
} from "../../test/invoice-world.js";
import { asBinary, bytesOf, printedText } from "../../test/pdf-text.js";
import { ALEX, INTERNAL_VOID_REASON, MISSING_ID } from "../../test/quotation-world.js";
import type * as PdfModule from "./pdf/invoice-pdf.js";
import { buildInvoicePdf } from "./pdf/invoice-pdf.js";

// The real builder, wrapped in a spy: the tests below assert when it is, and is not, called.
vi.mock("./pdf/invoice-pdf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfModule>();
  return { ...actual, buildInvoicePdf: vi.fn(actual.buildInvoicePdf) };
});

const builder = vi.mocked(buildInvoicePdf);
const prisma = getTestPrisma();
let w: InvoiceWorld;

const pdfPath = (id: string, query = "") => `/api/v1/invoices/${id}/pdf${query}`;

beforeEach(async () => {
  builder.mockClear();
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma, { logLevel: "info" });
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const download = (id: string, cookie: string = w.alexCookie, query = "") =>
  asBinary(w.client.get(pdfPath(id, query), { cookie }));

/** A visitor with no session at all (a default argument would turn `undefined` into the owner). */
const downloadAsVisitor = (id: string) => asBinary(w.client.get(pdfPath(id)));

describe("GET /invoices/:id/pdf (FR-072, SEC-FILE-01, SEC-FILE-02, SEC-AUTH-04)", () => {
  describe("the owner's download", () => {
    it("sends the PDF with the right headers and the invoice number as the file name", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await download(invoice.id);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-disposition"]).toBe(
        `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      );
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      const bytes = bytesOf(response);
      expect(response.headers["content-length"]).toBe(String(bytes.length));
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(builder).toHaveBeenCalledTimes(1);
    });

    it("names the file INV-YYYY-NNNNN.pdf", async () => {
      const { invoice } = await payableInvoice(w);
      expect(invoice.invoiceNumber).toMatch(/^INV-2026-\d{5}$/);
      const response = await download(invoice.id);
      expect(response.headers["content-disposition"]).toMatch(
        /^attachment; filename="INV-2026-\d{5}\.pdf"$/,
      );
    });

    it("shows it in the browser instead with ?inline=1", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await download(invoice.id, w.alexCookie, "?inline=1");
      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toBe(
        `inline; filename="${invoice.invoiceNumber}.pdf"`,
      );
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["cache-control"]).toBe("private, no-store");
    });

    it("refuses an inline value it does not understand, before any work is done", async () => {
      const { invoice } = await payableInvoice(w);
      expectApiError(await download(invoice.id, w.alexCookie, "?inline=maybe"), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(builder).not.toHaveBeenCalled();
    });

    it("contains the invoice's details, its totals, the balance and the payments that stand", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", { paymentDate: "2026-03-02", method: "CHEQUE" });

      const text = await printedText(bytesOf(await download(invoice.id)));
      for (const expected of [
        invoice.invoiceNumber ?? "",
        "Partially paid",
        "Total $300.00",
        "Amount paid -$100.00",
        "Balance due $200.00",
        "Mar 2, 2026 Cheque $100.00",
        "Due Mar 16, 2026",
        invoice.business.name,
        invoice.customer.name,
        invoice.job.reference,
        "Service call",
        invoice.paymentInstructions ?? "",
      ]) {
        expect(text, expected).toContain(expected);
      }
    });

    it("leaves out a payment that was voided: only payments that stand are listed", async () => {
      const { invoice } = await payableInvoice(w);
      const first = await paid(w, invoice.id, "111.11");
      await paid(w, invoice.id, "50.00");
      await voidPaymentRequest(w, invoice.id, first.payments[0]?.id ?? "", {
        reason: "Entered twice by mistake, ignore the first one",
      });

      const text = await printedText(bytesOf(await download(invoice.id)));
      expect(text).toContain("$50.00");
      expect(text).toContain("Balance due $250.00");
      expect(text).not.toContain("111.11");
      expect(text).not.toContain("Entered twice");
    });

    it("says it was paid in full, and on which day", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "300.00", { paymentDate: "2026-03-01" });
      const text = await printedText(bytesOf(await download(invoice.id)));
      expect(text).toContain("Paid in full on Mar 1, 2026");
      expect(text).toContain("Balance due $0.00");
    });

    it("saves an overdue invoice before it is built, so the document says Overdue", async () => {
      const { invoice } = await payableInvoice(w);
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");
      w.alexCookie = await signInAs(w.app, ALEX);

      const text = await printedText(bytesOf(await download(invoice.id)));
      expect(text).toContain("Overdue by 4 days");
      const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(stored.status).toBe(InvoiceStatus.OVERDUE);
    });
  });

  describe("authorization comes first (SEC-AUTH-04)", () => {
    it("is 401 for a visitor with no session, and builds nothing", async () => {
      const { invoice } = await payableInvoice(w);
      expectApiError(await downloadAsVisitor(invoice.id), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
      expect(builder).not.toHaveBeenCalled();
    });

    it("gives another customer 404, as for an id that does not exist, and builds nothing", async () => {
      const { invoice } = await payableInvoice(w, { owner: "alex" });
      const foreign = await download(invoice.id, w.priyaCookie);
      const missing = await download(MISSING_ID, w.priyaCookie);
      expectApiError(foreign, { status: 404, code: ErrorCode.NOT_FOUND });
      expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
      const message = (response: typeof foreign) =>
        bodyOf<{ error: { message: string } }>(response).error.message;
      expect(message(foreign)).toBe(message(missing));
      expect(builder).not.toHaveBeenCalled();
    });

    it("gives the owner of a draft 404: a draft is never a customer's, and nothing is built", async () => {
      const { invoice } = await draftInvoice(w);
      expectApiError(await download(invoice.id), { status: 404, code: ErrorCode.NOT_FOUND });
      expect(builder).not.toHaveBeenCalled();
    });

    it("gives the owner 404 for a draft that was voided before it was ever issued", async () => {
      const { invoice } = await draftInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "DRAFT",
      });
      expectApiError(await download(invoice.id), { status: 404, code: ErrorCode.NOT_FOUND });
      expect(builder).not.toHaveBeenCalled();
    });

    it("is 422 for something that is not an id, and builds nothing", async () => {
      expectApiError(await download("not-an-id"), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(builder).not.toHaveBeenCalled();
    });

    it("does no work for a refused caller: an overdue invoice is not even saved", async () => {
      const { invoice } = await payableInvoice(w, { owner: "alex" });
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");
      w.priyaCookie = await signInAs(w.app, "priya.shah@example.test");
      w.alexCookie = await signInAs(w.app, ALEX);

      expectApiError(await download(invoice.id, w.priyaCookie), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      // The refusal came before the overdue sync, so the stored status is still ISSUED ...
      const refused = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(refused.status).toBe(InvoiceStatus.ISSUED);
      expect(builder).not.toHaveBeenCalled();

      // ... and the owner's request is the one that saves it and builds the document.
      expect((await download(invoice.id)).status).toBe(200);
      const done = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(done.status).toBe(InvoiceStatus.OVERDUE);
      expect(builder).toHaveBeenCalledTimes(1);
    });

    it("changes nothing when it refuses", async () => {
      const { invoice } = await payableInvoice(w);
      const before = await invoiceSnapshot(prisma, invoice.id);
      const footprint = await invoiceFootprint(w);
      await download(invoice.id, w.priyaCookie);
      await downloadAsVisitor(invoice.id);
      await download(MISSING_ID);
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
      expect(await invoiceFootprint(w)).toEqual(footprint);
    });
  });

  describe("the business's admin", () => {
    it("downloads any issued invoice, whoever it belongs to", async () => {
      const alexs = await payableInvoice(w, { owner: "alex" });
      const priyas = await payableInvoice(w, { owner: "priya" });
      for (const { invoice } of [alexs, priyas]) {
        const response = await download(invoice.id, w.adminCookie);
        expect(response.status).toBe(200);
        expect(response.headers["content-disposition"]).toBe(
          `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        );
      }
    });

    it("downloads a draft, watermarked, under a name that says it has no number yet", async () => {
      const { invoice } = await draftInvoice(w);
      const response = await download(invoice.id, w.adminCookie);

      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="invoice-draft.pdf"',
      );
      const text = await printedText(bytesOf(response));
      expect(text).toContain("DRAFT");
      expect(text).toContain("Not numbered yet");
    });

    it("downloads a void invoice with the VOID watermark", async () => {
      const { invoice } = await payableInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "ISSUED",
      });
      const text = await printedText(bytesOf(await download(invoice.id, w.adminCookie)));
      expect(text).toContain("VOID");
      expect(text).toContain(invoice.invoiceNumber ?? "");
      // The reason is internal: it is on no page of any PDF.
      expect(text).not.toContain(INTERNAL_VOID_REASON);
    });

    it("downloads a draft that was voided before it was issued, watermarked VOID", async () => {
      const { invoice } = await draftInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "DRAFT",
      });
      const text = await printedText(bytesOf(await download(invoice.id, w.adminCookie)));
      expect(text).toContain("VOID");
      expect(text).not.toContain("DRAFT");
    });

    it("gets 404 for an invoice that does not exist", async () => {
      expectApiError(await download(MISSING_ID, w.adminCookie), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe("a customer is told of a void invoice too, without the internal reason", () => {
    it("lets the owner download an invoice the business voided, watermarked", async () => {
      const { invoice } = await payableInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "ISSUED",
      });
      const response = await download(invoice.id);
      expect(response.status).toBe(200);
      const text = await printedText(bytesOf(response));
      expect(text).toContain("VOID");
      expect(text).not.toContain(INTERNAL_VOID_REASON);
    });
  });

  describe("the document comes only from what was persisted (DM-04)", () => {
    it("is not changed by later changes to the business settings", async () => {
      const { invoice } = await payableInvoice(w);
      const before = await printedText(bytesOf(await download(invoice.id)));

      await prisma.businessSettings.updateMany({
        data: {
          businessName: "A Different Company Ltd",
          tagline: "A new slogan",
          phone: "(999) 000-1111",
          contactEmail: "new@different.example",
          addressLine1: "1 Somewhere Else Road",
          city: "Elsewhere",
          paymentInstructions: "Send everything to a new account instead.",
          invoiceFooter: "A brand new footer.",
          currencyCode: "EUR",
          defaultTaxRate: "20.00",
        },
      });
      const after = await printedText(bytesOf(await download(invoice.id)));

      expect(after).toBe(before);
      expect(after).toContain(invoice.business.name);
      expect(after).not.toContain("A Different Company");
      expect(after).not.toContain("new account instead");
      expect(after).toContain("$300.00");
      expect(after).not.toContain("€");
    });

    it("is not changed by later changes to the customer's name or the job's service", async () => {
      const { invoice, job } = await payableInvoice(w);
      const before = await printedText(bytesOf(await download(invoice.id)));

      await prisma.user.update({ where: { id: w.alex.user.id }, data: { name: "Someone Else" } });
      await prisma.workOrder.update({
        where: { id: job.id },
        data: { addressLine1: "9 Moved Away Street" },
      });
      const after = await printedText(bytesOf(await download(invoice.id)));
      expect(after).toBe(before);
      expect(after).toContain("Alex Morgan");
      expect(after).not.toContain("Someone Else");
      expect(after).not.toContain("Moved Away");
    });

    it("prints a customer's note and a line description as plain text, never as markup", async () => {
      const made = await draftInvoice(w);
      const hostile = '<img src=x onerror=alert(1)> <b>bold</b> =HYPERLINK("http://x.test")';
      const saved = await saveInvoice(w, made.invoice, {
        lines: [{ description: hostile, quantity: "1", unitPrice: "40.00", taxable: false }],
        discountAmount: "0.00",
        taxRate: "0.00",
        customerNote: hostile,
      });
      const invoice = await issued(w, saved.id);

      const text = await printedText(bytesOf(await download(invoice.id)));
      expect(text).toContain("<img src=x onerror=alert(1)>");
      expect(text).toContain("<b>bold</b>");
      expect(text).toContain('=HYPERLINK("http://x.test")');
    });
  });

  describe("when the builder fails (SEC, F)", () => {
    it("is a safe 500 with no PDF headers, no leaked cause, and every record unchanged", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const before = await invoiceSnapshot(prisma, invoice.id);
      const payments = JSON.stringify(
        await prisma.paymentRecord.findMany({ orderBy: { id: "asc" } }),
      );
      const footprint = await invoiceFootprint(w);

      builder.mockRejectedValueOnce(new Error("pdfkit exploded at C:/secret/path/font.ttf"));
      const response = await download(invoice.id);

      const error = expectApiError(response, { status: 500, code: ErrorCode.INTERNAL_ERROR });
      expect(error.message).not.toContain("pdfkit");
      expect(JSON.stringify(response.body)).not.toContain("secret/path");
      expect(response.headers["content-disposition"]).toBeUndefined();
      expect(response.headers["content-type"]).not.toMatch(/pdf/);

      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
      expect(JSON.stringify(await prisma.paymentRecord.findMany({ orderBy: { id: "asc" } }))).toBe(
        payments,
      );
      expect(await invoiceFootprint(w)).toEqual(footprint);

      // The next request works: nothing was left half-done.
      const again = await download(invoice.id);
      expect(again.status).toBe(200);
    });

    it("logs the cause on the server only", async () => {
      const { invoice } = await payableInvoice(w);
      builder.mockRejectedValueOnce(new Error("pdfkit exploded at C:/secret/path/font.ttf"));
      await download(invoice.id);
      expect(w.logs.text()).toContain("pdfkit exploded");
    });
  });

  describe("what gets logged", () => {
    it("records neither the customer's name, address nor the invoice's contents", async () => {
      const { invoice } = await payableInvoice(w);
      await download(invoice.id);
      const logged = w.logs.text();
      expect(logged).not.toContain("Alex Morgan");
      expect(logged).not.toContain("Service call");
      expect(logged).not.toContain(invoice.paymentInstructions ?? "never");
    });
  });
});

describe("GET /invoices/:id/pdf is rate-limited per user (abuse of an expensive read)", () => {
  it("answers 429 once a user has asked too often, and another user is not affected", async () => {
    w = await (async () => {
      await resetDatabase(prisma);
      return invoiceWorld(prisma, {
        logLevel: "info",
        rateLimits: { invoicePdf: { limit: 2, windowSeconds: 3600 } },
      });
    })();
    const { invoice } = await payableInvoice(w);

    expect((await download(invoice.id)).status).toBe(200);
    expect((await download(invoice.id)).status).toBe(200);
    const limited = await download(invoice.id);
    expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(limited.headers["retry-after"]).toBeDefined();

    // The admin is a different user with their own allowance.
    expect((await download(invoice.id, w.adminCookie)).status).toBe(200);
  });
});
