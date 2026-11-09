import { type AdminInvoiceDto, ErrorCode, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  draftInvoice,
  expectLedgerInvariant,
  type InvoiceWorld,
  invoiceWorld,
  moveClockTo,
  paid,
  payableInvoice,
  paymentBody,
  paymentFootprint,
  recordPaymentRequest,
  voidInvoiceRequest,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma, { logLevel: "info" });
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("POST /admin/invoices/:id/payments (FR-073, FR-074, FR-075, D-27)", () => {
  describe("G.1: a valid payment reduces the balance and moves the status", () => {
    it("a part payment gives PARTIALLY_PAID with the balance and the amount paid", async () => {
      const { invoice } = await payableInvoice(w);
      expect(invoice.status).toBe(InvoiceStatus.ISSUED);
      expect(invoice.availableActions).toEqual(["RECORD_PAYMENT", "VOID"]);

      const response = await recordPaymentRequest(
        w,
        invoice.id,
        paymentBody({
          amount: "100",
          method: "CHEQUE",
          reference: "Cheque 004512",
          notes: "Left with the neighbour",
        }),
      );

      expect(response.status).toBe(201);
      const after = dataOf<AdminInvoiceDto>(response);
      expect(after.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(after.statusLabel).toBe("Partially paid");
      expect(after.totalAmount).toBe("300.00");
      expect(after.amountPaid).toBe("100.00");
      expect(after.balanceDue).toBe("200.00");
      expect(after.availableActions).toEqual(["RECORD_PAYMENT", "VOID_PAYMENT"]);
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0]).toMatchObject({
        amount: "100.00",
        paymentDate: "2026-03-02",
        method: "CHEQUE",
        methodLabel: "Cheque",
        reference: "Cheque 004512",
        notes: "Left with the neighbour",
        recordedBy: { name: "Morgan Reyes" },
        voided: null,
      });
      await expectLedgerInvariant(w, invoice.id);
    });

    it("paying exactly what is left gives PAID, and a paid invoice offers only the voiding of a payment", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const after = await paid(w, invoice.id, "200.00");

      expect(after.status).toBe(InvoiceStatus.PAID);
      expect(after.balanceDue).toBe("0.00");
      expect(after.amountPaid).toBe("300.00");
      expect(after.availableActions).toEqual(["VOID_PAYMENT"]);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("pays the whole invoice in one payment", async () => {
      const { invoice } = await payableInvoice(w);
      const after = await paid(w, invoice.id, "300.00");
      expect(after.status).toBe(InvoiceStatus.PAID);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("works to the cent where floats do not", async () => {
      const { invoice } = await payableInvoice(w, { total: "0.30" });
      await paid(w, invoice.id, "0.10");
      const after = await paid(w, invoice.id, "0.20");
      expect(after.status).toBe(InvoiceStatus.PAID);
      expect(after.amountPaid).toBe("0.30");
      await expectLedgerInvariant(w, invoice.id);
    });

    it("a part payment after the due date leaves it OVERDUE, and the rest pays it", async () => {
      const { invoice } = await payableInvoice(w);
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");

      const partial = await paid(w, invoice.id, "100.00", { paymentDate: "2026-03-20" });
      expect(partial.status).toBe(InvoiceStatus.OVERDUE);
      expect(partial.amountPaid).toBe("100.00");
      expect(partial.balanceDue).toBe("200.00");
      expect(partial.availableActions).toEqual(["RECORD_PAYMENT", "VOID_PAYMENT"]);
      await expectLedgerInvariant(w, invoice.id);

      const settled = await paid(w, invoice.id, "200.00", { paymentDate: "2026-03-20" });
      expect(settled.status).toBe(InvoiceStatus.PAID);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("an overdue invoice with nothing paid takes a payment of the whole", async () => {
      const { invoice } = await payableInvoice(w);
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");
      const after = await paid(w, invoice.id, "300.00", { paymentDate: "2026-03-19" });
      expect(after.status).toBe(InvoiceStatus.PAID);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("the payment date may be today in the business zone and any day before", async () => {
      const { invoice } = await payableInvoice(w);
      // The clock is 04:00 on 2 March in New York, which is already 09:00 UTC the same day.
      await paid(w, invoice.id, "10.00", { paymentDate: "2026-03-02" });
      await paid(w, invoice.id, "10.00", { paymentDate: "2026-02-01" });
      await paid(w, invoice.id, "10.00", { paymentDate: "2025-01-01" });
      await expectLedgerInvariant(w, invoice.id);
    });

    it.each(["CASH", "BANK_TRANSFER", "CARD_TERMINAL", "CHEQUE", "OTHER"])(
      "accepts the method %s",
      async (method) => {
        const { invoice } = await payableInvoice(w);
        const after = await paid(w, invoice.id, "10.00", { method });
        expect(after.payments[0]?.method).toBe(method);
      },
    );

    it("lists payments oldest first and keeps the amount paid in step", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "50.00", { paymentDate: "2026-03-01" });
      await paid(w, invoice.id, "25.50", { paymentDate: "2026-02-20" });
      const after = await paid(w, invoice.id, "10.25", { paymentDate: "2026-03-02" });
      expect(after.payments.map((payment) => payment.paymentDate)).toEqual([
        "2026-02-20",
        "2026-03-01",
        "2026-03-02",
      ]);
      expect(after.amountPaid).toBe("85.75");
      await expectLedgerInvariant(w, invoice.id);
    });

    it("the invoice list shows the balance and the status", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "120.00");
      const list = await w.client.get(`${ADMIN_INVOICES}?status=PARTIALLY_PAID`, {
        cookie: w.adminCookie,
      });
      const rows = (list.body as { data: { id: string; balanceDue: string; amountPaid: string }[] })
        .data;
      expect(rows.find((row) => row.id === invoice.id)).toMatchObject({
        amountPaid: "120.00",
        balanceDue: "180.00",
      });
    });
  });

  describe("G.2: what is refused, and the record left alone", () => {
    it.each([
      ["zero", "0"],
      ["zero with places", "0.00"],
      ["negative", "-5.00"],
      ["not a number", "abc"],
      ["empty", ""],
      ["more than two places", "10.005"],
      ["an exponent", "1e2"],
      ["a thousands separator", "1,000"],
      ["too large to store", "10000000000.00"],
    ])("an amount that is %s is 422 on the amount and changes nothing", async (_name, amount) => {
      const { invoice } = await payableInvoice(w);
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount }));

      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(
        (response.body as { error: { fieldErrors: object } }).error.fieldErrors,
      ).toHaveProperty("amount");
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("an amount that is a JSON number and not text is 422", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: 100 }));
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    });

    it("a date in the future on the business's calendar is 422 on paymentDate", async () => {
      const { invoice } = await payableInvoice(w);
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(
        w,
        invoice.id,
        paymentBody({ paymentDate: "2026-03-03" }),
      );

      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(
        (response.body as { error: { fieldErrors: Record<string, string> } }).error.fieldErrors
          .paymentDate,
      ).toBe("The payment date can't be in the future.");
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("judges the date by the business's calendar, not UTC: 22:00 in New York is already tomorrow in UTC", async () => {
      const { invoice } = await payableInvoice(w);
      // 03:00 UTC on 3 March is 22:00 on 2 March in New York.
      await moveClockTo(w, "2026-03-03T03:00:00.000Z");
      expectApiError(
        await recordPaymentRequest(w, invoice.id, paymentBody({ paymentDate: "2026-03-03" })),
        { status: 422, code: ErrorCode.VALIDATION_ERROR },
      );
      const ok = await recordPaymentRequest(
        w,
        invoice.id,
        paymentBody({ paymentDate: "2026-03-02" }),
      );
      expect(ok.status).toBe(201);
    });

    it.each([
      ["a date that does not exist", { paymentDate: "2026-02-30" }],
      ["a date in the wrong shape", { paymentDate: "02/03/2026" }],
      ["a missing date", { paymentDate: undefined }],
      ["an unknown method", { method: "CREDIT_CARD" }],
      ["a lower-case method", { method: "cash" }],
      ["a missing method", { method: undefined }],
      ["a reference over 100 characters", { reference: "r".repeat(101) }],
      ["notes over 500 characters", { notes: "n".repeat(501) }],
      ["a field the server decides", { amountPaid: "300.00" }],
      ["a status", { status: "PAID" }],
    ])("%s is 422", async (_name, overrides) => {
      const { invoice } = await payableInvoice(w);
      const before = await paymentFootprint(w, invoice.id);
      const response = await recordPaymentRequest(w, invoice.id, paymentBody(overrides));
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("an amount above the balance is 422 PAYMENT_EXCEEDS_BALANCE with the remaining amount in the message", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "200.01" }));

      expectApiError(response, { status: 422, code: ErrorCode.PAYMENT_EXCEEDS_BALANCE });
      const error = (
        response.body as {
          error: { message: string; fieldErrors: Record<string, string>; details: object };
        }
      ).error;
      expect(error.message).toBe("This payment exceeds the remaining balance of $200.00");
      expect(error.fieldErrors).toEqual({ amount: error.message });
      expect(error.details).toEqual({ remainingBalance: "200.00", currencyCode: "USD" });
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("one cent over the whole invoice is refused and the exact amount is accepted", async () => {
      const { invoice } = await payableInvoice(w);
      expectApiError(await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.01" })), {
        status: 422,
        code: ErrorCode.PAYMENT_EXCEEDS_BALANCE,
      });
      const ok = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.00" }));
      expect(ok.status).toBe(201);
    });

    it("a draft invoice is 409 INVOICE_NOT_PAYABLE, saying it is still a draft", async () => {
      const { invoice } = await draftInvoice(w);
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(w, invoice.id, paymentBody());

      expectApiError(response, { status: 409, code: ErrorCode.INVOICE_NOT_PAYABLE });
      expect((response.body as { error: { message: string } }).error.message).toContain(
        "still a draft",
      );
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("a void invoice is 409 INVOICE_NOT_PAYABLE, saying it was voided", async () => {
      const { invoice } = await payableInvoice(w);
      expect(
        (
          await voidInvoiceRequest(w, invoice.id, {
            reason: "Wrong customer was billed.",
            expectedStatus: "ISSUED",
          })
        ).status,
      ).toBe(200);
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(w, invoice.id, paymentBody());

      expectApiError(response, { status: 409, code: ErrorCode.INVOICE_NOT_PAYABLE });
      expect((response.body as { error: { message: string } }).error.message).toContain("voided");
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("a paid invoice is 409 INVOICE_NOT_PAYABLE, saying it is paid in full, even for a valid amount", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "300.00");
      const before = await paymentFootprint(w, invoice.id);

      const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "0.01" }));

      expectApiError(response, { status: 409, code: ErrorCode.INVOICE_NOT_PAYABLE });
      expect((response.body as { error: { message: string } }).error.message).toContain(
        "paid in full",
      );
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("the status is checked before the amount: an overpayment on a paid invoice is 409, not 422", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "300.00");
      expectApiError(await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "999.00" })), {
        status: 409,
        code: ErrorCode.INVOICE_NOT_PAYABLE,
      });
    });

    it("an unknown invoice is 404", async () => {
      expectApiError(await recordPaymentRequest(w, MISSING_ID, paymentBody()), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("a malformed invoice id is 422", async () => {
      expectApiError(await recordPaymentRequest(w, "not-an-id", paymentBody()), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe("authorization", () => {
    it("is 401 without a session", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await w.client
        .post(`${ADMIN_INVOICES}/${invoice.id}/payments`)
        .send(paymentBody());
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    });

    it("is 403 for a customer, even the invoice's own", async () => {
      const { invoice } = await payableInvoice(w);
      const before = await paymentFootprint(w, invoice.id);
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(await recordPaymentRequest(w, invoice.id, paymentBody(), cookie), {
          status: 403,
          code: ErrorCode.FORBIDDEN,
        });
      }
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("is 403 CSRF_ORIGIN_MISMATCH from another origin", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await w.client
        .post(`${ADMIN_INVOICES}/${invoice.id}/payments`, {
          cookie: w.adminCookie,
          origin: "https://evil.example.com",
        })
        .send(paymentBody());
      expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    });

    it("takes the recorder from the session and ignores any recorder named in the body", async () => {
      const { invoice } = await payableInvoice(w);
      const response = await recordPaymentRequest(
        w,
        invoice.id,
        paymentBody({ recordedByUserId: w.alex.user.id }),
      );
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      const after = await paid(w, invoice.id, "10.00");
      expect(after.payments[0]?.recordedBy).toEqual({ name: "Morgan Reyes" });
      const row = await prisma.paymentRecord.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(row.recordedByUserId).toBe(w.admin.id);
    });
  });

  describe("G.6: the history, the customer's notification and the email", () => {
    it("records one event with the amount and method but no reference or notes, and tells the customer", async () => {
      const { invoice, job } = await payableInvoice(w);
      const before = await paymentFootprint(w, invoice.id);

      await paid(w, invoice.id, "100.00", {
        method: "CHEQUE",
        reference: "SECRET-REF-48213",
        notes: "INTERNAL-NOTE the customer was rude",
      });

      const events = await prisma.activityEvent.findMany({
        where: { entityType: "INVOICE", entityId: invoice.id, action: "payment.recorded" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatus: "ISSUED",
        toStatus: "PARTIALLY_PAID",
        customerId: job.customerId,
        summary: "Morgan Reyes recorded a payment of $100.00 received on Mar 2, 2026 (Cheque).",
        publicSummary: "We recorded your payment of $100.00 received on Mar 2, 2026.",
      });
      expect(events[0]?.metadata).toEqual({
        invoiceReference: invoice.invoiceNumber,
        amount: "100.00",
        currencyCode: "USD",
        paymentMethod: "CHEQUE",
        paymentDate: "2026-03-02",
        amountPaid: "100.00",
        balance: "200.00",
      });
      const everything = JSON.stringify(
        await prisma.activityEvent.findMany({ where: { entityId: invoice.id } }),
      );
      expect(everything).not.toContain("SECRET-REF");
      expect(everything).not.toContain("INTERNAL-NOTE");

      const after = await paymentFootprint(w, invoice.id);
      expect(after.events).toBe(before.events + 1);
      expect(after.notifications).toBe(before.notifications + 1);
      expect(after.emails).toBe(before.emails + 1);
    });

    it("notifies the owning customer, and only them, with customer-safe words", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", {
        reference: "SECRET-REF-48213",
        notes: "INTERNAL-NOTE",
      });

      const notifications = await prisma.notification.findMany({
        where: { type: "PAYMENT_RECORDED" },
      });
      expect(notifications).toHaveLength(1);
      const [notification] = notifications;
      expect(notification?.recipientUserId).toBe(w.alex.user.id);
      expect(notification?.title).toBe(`Payment recorded for invoice ${invoice.invoiceNumber}`);
      expect(notification?.message).toBe(
        "We recorded a payment of $100.00 received on Mar 2, 2026 for AC Repair. The balance due is $200.00.",
      );
      expect(notification?.linkPath).toBe(`/portal/invoices/${invoice.id}`);
      expect(JSON.stringify(notification)).not.toMatch(/SECRET-REF|INTERNAL-NOTE/);
    });

    it("emails the customer a receipt-style notice: recorded, not processed, with no reference or notes", async () => {
      const { invoice } = await payableInvoice(w);
      const sentBefore = w.emails.sent.length;

      await paid(w, invoice.id, "100.00", {
        method: "BANK_TRANSFER",
        reference: "SECRET-REF-48213",
        notes: "INTERNAL-NOTE",
      });

      const sent = w.emails.sent.slice(sentBefore);
      expect(sent).toHaveLength(1);
      const email = sent[0];
      expect(email?.to).toBe(w.alex.user.email);
      expect(email?.subject).toBe(`Payment recorded for invoice ${invoice.invoiceNumber}`);
      const text = email?.text ?? "";
      expect(text).toContain("We have recorded your payment");
      expect(text).toContain("Payment: $100.00");
      expect(text).toContain("Payment date: Mar 2, 2026");
      expect(text).toContain("Method: Bank transfer");
      expect(text).toContain("Balance: $200.00");
      expect(text).toContain(`/portal/invoices/${invoice.id}`);
      const everything = `${email?.subject}${text}${email?.html}`;
      expect(everything).not.toMatch(/SECRET-REF|INTERNAL-NOTE/);
      expect(everything).not.toMatch(/processed|charged/i);
    });

    it("says the invoice is paid in full when the last payment settles it", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      await paid(w, invoice.id, "200.00");
      const last = await prisma.notification.findFirstOrThrow({
        where: { type: "PAYMENT_RECORDED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      expect(last.message).toContain("The invoice is now paid in full.");
      expect(w.emails.sent.at(-1)?.text).toContain("paid in full");
    });

    it("shows the customer's timeline the payment sentence but never the staff one", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", { method: "CHEQUE", reference: "SECRET-REF-48213" });
      const adminView = await prisma.activityEvent.findMany({
        where: { entityId: invoice.id, action: "payment.recorded" },
        select: { publicSummary: true, summary: true },
      });
      expect(adminView[0]?.publicSummary).not.toContain("Cheque");
      expect(adminView[0]?.publicSummary).not.toContain("Morgan");
    });

    it("a failing mail server does not undo the recorded payment", async () => {
      const { invoice } = await payableInvoice(w);
      w.emails.failWith = new Error("SMTP is down");
      const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "100.00" }));
      expect(response.status).toBe(201);
      await w.deps.emailDispatcher.idle();
      expect(await prisma.emailDeliveryLog.count({ where: { status: "FAILED" } })).toBe(1);
      expect(await prisma.notification.count({ where: { type: "PAYMENT_RECORDED" } })).toBe(1);
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(row.amountPaid.toFixed(2)).toBe("100.00");
      await expectLedgerInvariant(w, invoice.id);
    });

    it("keeps the reference and notes out of the application logs", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", {
        reference: "SECRET-REF-48213",
        notes: "INTERNAL-NOTE the customer was rude",
      });
      const logs = w.logs.text();
      expect(logs).not.toContain("SECRET-REF");
      expect(logs).not.toContain("INTERNAL-NOTE");
    });
  });

  describe("the invoice's own void (G.5)", () => {
    it("is refused while a payment stands and says so", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const response = await voidInvoiceRequest(w, invoice.id, {
        reason: "Billed the wrong amount.",
        expectedStatus: "PARTIALLY_PAID",
      });
      expectApiError(response, { status: 409, code: ErrorCode.INVOICE_HAS_PAYMENTS });
    });
  });
});
