import { type AdminInvoiceDto, ErrorCode, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  expectLedgerInvariant,
  type InvoiceWorld,
  invoiceWorld,
  paid,
  payableInvoice,
  paymentBody,
  recordPaymentRequest,
  voidInvoiceRequest,
  voidPaymentRequest,
} from "../../test/invoice-world.js";
import { dataOf } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const REASON = "Entered against the wrong invoice.";

function codeOf(response: { body: unknown }): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function standingPayments(invoiceId: string) {
  return prisma.paymentRecord.count({ where: { invoiceId, voidedAt: null } });
}

describe("payments under concurrency (G.3, SEC-TXN-03, SEC-TXN-04, TS-INT-05)", () => {
  it("an invoice of 300.00 with two parallel payments of 200.00 takes exactly one; the other is 422", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });
    const before = {
      events: await prisma.activityEvent.count({ where: { action: "payment.recorded" } }),
      notifications: await prisma.notification.count({ where: { type: "PAYMENT_RECORDED" } }),
    };

    const responses = await Promise.all([
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "200.00" })),
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "200.00" })),
    ]);
    await w.deps.emailDispatcher.idle();

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 422]);
    const loser = responses.find((response) => response.status === 422);
    expect(codeOf(loser ?? { body: {} })).toBe(ErrorCode.PAYMENT_EXCEEDS_BALANCE);
    expect((loser?.body as { error: { message: string } }).error.message).toBe(
      "This payment exceeds the remaining balance of $100.00",
    );

    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.toFixed(2)).toBe("200.00");
    expect(row.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(await prisma.paymentRecord.count({ where: { invoiceId: invoice.id } })).toBe(1);
    // One payment means one event, one notification and one email: the loser left nothing behind.
    expect(await prisma.activityEvent.count({ where: { action: "payment.recorded" } })).toBe(
      before.events + 1,
    );
    expect(await prisma.notification.count({ where: { type: "PAYMENT_RECORDED" } })).toBe(
      before.notifications + 1,
    );
    expect(
      w.emails.sent.filter((mail) => mail.subject.startsWith("Payment recorded")),
    ).toHaveLength(1);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("repeats reliably: twenty rounds of two 200.00 payments never overpay", async () => {
    for (let round = 0; round < 20; round += 1) {
      await resetDatabase(prisma);
      w = await invoiceWorld(prisma);
      const { invoice } = await payableInvoice(w, { total: "300.00" });
      const responses = await Promise.all([
        recordPaymentRequest(w, invoice.id, paymentBody({ amount: "200.00" })),
        recordPaymentRequest(w, invoice.id, paymentBody({ amount: "200.00" })),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(row.amountPaid.toFixed(2)).toBe("200.00");
      await expectLedgerInvariant(w, invoice.id);
    }
  }, 120_000);

  it("six parallel payments of 100.00 on 300.00 take exactly three and leave the invoice PAID", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        recordPaymentRequest(w, invoice.id, paymentBody({ amount: "100.00" })),
      ),
    );

    const ok = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status !== 201);
    expect(ok).toHaveLength(3);
    // Late arrivals find the invoice already paid (409) or short of balance (422): never a success.
    for (const response of refused) {
      expect([409, 422]).toContain(response.status);
      expect([ErrorCode.INVOICE_NOT_PAYABLE, ErrorCode.PAYMENT_EXCEEDS_BALANCE]).toContain(
        codeOf(response),
      );
    }
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.toFixed(2)).toBe("300.00");
    expect(row.status).toBe(InvoiceStatus.PAID);
    expect(await standingPayments(invoice.id)).toBe(3);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("two parallel payments that together fit both succeed, and the total is exact", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });

    const responses = await Promise.all([
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "100.10" })),
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "199.90" })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.toFixed(2)).toBe("300.00");
    expect(row.status).toBe(InvoiceStatus.PAID);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("two parallel payments of the whole balance: one succeeds, the other finds it paid (409)", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });

    const responses = await Promise.all([
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.00" })),
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.00" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(codeOf(responses.find((response) => response.status === 409) ?? { body: {} })).toBe(
      ErrorCode.INVOICE_NOT_PAYABLE,
    );
    expect(await standingPayments(invoice.id)).toBe(1);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("payments to two different invoices at once do not wait on or disturb each other", async () => {
    const first = await payableInvoice(w, { total: "300.00" });
    const second = await payableInvoice(w, { total: "150.00", owner: "priya" });

    const responses = await Promise.all([
      recordPaymentRequest(w, first.invoice.id, paymentBody({ amount: "300.00" })),
      recordPaymentRequest(w, second.invoice.id, paymentBody({ amount: "150.00" })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    await expectLedgerInvariant(w, first.invoice.id);
    await expectLedgerInvariant(w, second.invoice.id);
  });

  it("two parallel voids of the same payment: one succeeds, the other is 409, and the balance rises once", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });
    await paid(w, invoice.id, "100.00");
    await paid(w, invoice.id, "100.00");
    const target = (
      await prisma.paymentRecord.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    ).id;

    const responses = await Promise.all([
      voidPaymentRequest(w, invoice.id, target, { reason: REASON }),
      voidPaymentRequest(w, invoice.id, target, {
        reason: "Another reason, typed at the same time.",
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(codeOf(responses.find((response) => response.status === 409) ?? { body: {} })).toBe(
      ErrorCode.PAYMENT_ALREADY_VOIDED,
    );
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.toFixed(2)).toBe("100.00");
    expect(await prisma.activityEvent.count({ where: { action: "payment.voided" } })).toBe(1);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("a payment recorded while another is voided: both land and the invariant holds", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });
    await paid(w, invoice.id, "200.00");
    const target = (
      await prisma.paymentRecord.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    ).id;

    const responses = await Promise.all([
      voidPaymentRequest(w, invoice.id, target, { reason: REASON }),
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "100.00" })),
    ]);

    // Either order is fine: the 100.00 fits the balance both before and after the void.
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.toFixed(2)).toBe("100.00");
    expect(row.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    await expectLedgerInvariant(w, invoice.id);
  });

  it("a payment racing a void of the same payment cannot overpay, whichever goes first", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });
    await paid(w, invoice.id, "300.00");
    const target = (
      await prisma.paymentRecord.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    ).id;

    // Voiding the 300.00 frees the whole balance; a new 300.00 only fits if the void ran first.
    const responses = await Promise.all([
      voidPaymentRequest(w, invoice.id, target, { reason: REASON }),
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.00" })),
    ]);

    const [voided, recorded] = responses;
    expect(voided?.status).toBe(200);
    // Void first: the record fits (201). Record first: the invoice was paid, so it is refused (409).
    expect([201, 409]).toContain(recorded?.status);
    await expectLedgerInvariant(w, invoice.id);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountPaid.lte(row.totalAmount)).toBe(true);
  });

  it("a payment racing the void of the invoice: exactly one wins, and a void invoice never holds a payment", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });

    const responses = await Promise.all([
      recordPaymentRequest(w, invoice.id, paymentBody({ amount: "100.00" })),
      voidInvoiceRequest(w, invoice.id, {
        reason: "Billed the wrong customer.",
        expectedStatus: "ISSUED",
      }),
    ]);

    const [recorded, voided] = responses;
    // Record first: the void is refused (INVOICE_HAS_PAYMENTS, or STALE_STATE as the status moved on).
    // Void first: the payment is refused because the invoice is void (INVOICE_NOT_PAYABLE).
    expect(
      [recorded?.status, voided?.status].filter((status) => status === 200 || status === 201),
    ).toHaveLength(1);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    if (row.status === InvoiceStatus.VOID) {
      expect(recorded?.status).toBe(409);
      expect(await standingPayments(invoice.id)).toBe(0);
    } else {
      expect(recorded?.status).toBe(201);
      expect(voided?.status).toBe(409);
      expect(await standingPayments(invoice.id)).toBe(1);
    }
    await expectLedgerInvariant(w, invoice.id);
  });

  it("the database refuses an overpayment that bypasses the service (defence in depth)", async () => {
    const { invoice } = await payableInvoice(w, { total: "300.00" });
    await expect(
      prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "300.01" } }),
    ).rejects.toThrow();
    const response = await recordPaymentRequest(w, invoice.id, paymentBody({ amount: "300.00" }));
    expect(dataOf<AdminInvoiceDto>(response).status).toBe(InvoiceStatus.PAID);
  });
});
