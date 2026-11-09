import { type AdminInvoiceDto, ErrorCode, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
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
  voidPaymentRequest,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";
import { createAdminInvoicesRouter } from "./invoices.routes.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma, { logLevel: "info" });
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const REASON = "INTERNAL-REASON: typed against the wrong invoice by mistake.";

/** The id of the n-th payment recorded on an invoice, oldest first. */
async function paymentIdOf(invoiceId: string, index = 0): Promise<string> {
  const rows = await prisma.paymentRecord.findMany({
    where: { invoiceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`The invoice has no payment number ${index}.`);
  }
  return row.id;
}

describe("POST /admin/invoices/:id/payments/:paymentId/void (FR-076, BR-16, D-27)", () => {
  describe("G.4: a void needs a reason, keeps the record and recalculates", () => {
    it("falls PAID back to PARTIALLY_PAID when another payment still stands, and keeps the voided one", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", { reference: "REF-ONE" });
      await paid(w, invoice.id, "200.00", { reference: "REF-TWO" });
      const target = await paymentIdOf(invoice.id, 1);

      const response = await voidPaymentRequest(w, invoice.id, target, { reason: REASON });

      expect(response.status).toBe(200);
      const after = dataOf<AdminInvoiceDto>(response);
      expect(after.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(after.amountPaid).toBe("100.00");
      expect(after.balanceDue).toBe("200.00");
      expect(after.availableActions).toEqual(["RECORD_PAYMENT", "VOID_PAYMENT"]);
      // History is permanent: both payments are still listed, the voided one with who, when and why.
      expect(after.payments).toHaveLength(2);
      expect(after.payments[1]).toMatchObject({
        id: target,
        amount: "200.00",
        reference: "REF-TWO",
        voided: { at: "2026-03-02T09:00:00.000Z", by: { name: "Morgan Reyes" }, reason: REASON },
      });
      expect(after.payments[0]?.voided).toBeNull();

      const row = await prisma.paymentRecord.findUniqueOrThrow({ where: { id: target } });
      expect(row.voidedByUserId).toBe(w.admin.id);
      expect(row.voidReason).toBe(REASON);
      expect(row.amount.toFixed(2)).toBe("200.00");
      await expectLedgerInvariant(w, invoice.id);
    });

    it("voiding the only payment returns a not-yet-due invoice to ISSUED, and it can be voided again", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "300.00");
      const target = await paymentIdOf(invoice.id);

      const after = dataOf<AdminInvoiceDto>(
        await voidPaymentRequest(w, invoice.id, target, { reason: REASON }),
      );

      expect(after.status).toBe(InvoiceStatus.ISSUED);
      expect(after.amountPaid).toBe("0.00");
      expect(after.balanceDue).toBe("300.00");
      expect(after.availableActions).toEqual(["RECORD_PAYMENT", "VOID"]);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("a paid invoice past its due date falls back to OVERDUE, not to issued", async () => {
      const { invoice } = await payableInvoice(w);
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");
      await paid(w, invoice.id, "300.00", { paymentDate: "2026-03-19" });
      const target = await paymentIdOf(invoice.id);

      const after = dataOf<AdminInvoiceDto>(
        await voidPaymentRequest(w, invoice.id, target, { reason: REASON }),
      );

      expect(after.status).toBe(InvoiceStatus.OVERDUE);
      expect(after.daysOverdue).toBe(4);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("voiding a part payment on an overdue invoice leaves it OVERDUE with the balance up", async () => {
      const { invoice } = await payableInvoice(w);
      await moveClockTo(w, "2026-03-20T15:00:00.000Z");
      await paid(w, invoice.id, "100.00", { paymentDate: "2026-03-19" });
      await paid(w, invoice.id, "50.00", { paymentDate: "2026-03-19" });
      const after = dataOf<AdminInvoiceDto>(
        await voidPaymentRequest(w, invoice.id, await paymentIdOf(invoice.id, 1), {
          reason: REASON,
        }),
      );
      expect(after.status).toBe(InvoiceStatus.OVERDUE);
      expect(after.amountPaid).toBe("100.00");
      expect(after.balanceDue).toBe("200.00");
      await expectLedgerInvariant(w, invoice.id);
    });

    it("a correction is a void plus a new record: the amount that was voided is owed again", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "300.00", { reference: "wrong one" });
      await voidPaymentRequest(w, invoice.id, await paymentIdOf(invoice.id), { reason: REASON });

      const after = await paid(w, invoice.id, "300.00", { reference: "right one" });

      expect(after.status).toBe(InvoiceStatus.PAID);
      expect(after.payments).toHaveLength(2);
      expect(after.payments.map((payment) => payment.voided !== null)).toEqual([true, false]);
      expect(after.amountPaid).toBe("300.00");
      await expectLedgerInvariant(w, invoice.id);
    });

    it.each([
      ["a missing reason", {}],
      ["an empty reason", { reason: "" }],
      ["a blank reason", { reason: "      " }],
      ["a reason under 5 characters", { reason: "oops" }],
      ["a reason over 500 characters", { reason: "r".repeat(501) }],
      ["a reason that is not text", { reason: 12345 }],
      ["an extra field", { reason: REASON, amount: "1.00" }],
      ["an expected status the endpoint does not take", { reason: REASON, expectedStatus: "PAID" }],
    ])("%s is 422 and changes nothing", async (_name, body) => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const target = await paymentIdOf(invoice.id);
      const before = await paymentFootprint(w, invoice.id);

      expectApiError(await voidPaymentRequest(w, invoice.id, target, body), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("a payment that was already voided is 409 PAYMENT_ALREADY_VOIDED and is not voided twice", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      await paid(w, invoice.id, "50.00");
      const target = await paymentIdOf(invoice.id);
      await voidPaymentRequest(w, invoice.id, target, { reason: REASON });
      const before = await paymentFootprint(w, invoice.id);

      const response = await voidPaymentRequest(w, invoice.id, target, {
        reason: "A second, different reason.",
      });

      expectApiError(response, { status: 409, code: ErrorCode.PAYMENT_ALREADY_VOIDED });
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
      const row = await prisma.paymentRecord.findUniqueOrThrow({ where: { id: target } });
      expect(row.voidReason).toBe(REASON);
      await expectLedgerInvariant(w, invoice.id);
    });

    it("a voided invoice's payments can no longer change", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const target = await paymentIdOf(invoice.id);
      await voidPaymentRequest(w, invoice.id, target, { reason: REASON });
      expect(
        (
          await voidInvoiceRequest(w, invoice.id, {
            reason: "Billed the wrong customer.",
            expectedStatus: "ISSUED",
          })
        ).status,
      ).toBe(200);
      const before = await paymentFootprint(w, invoice.id);

      expectApiError(await voidPaymentRequest(w, invoice.id, target, { reason: REASON }), {
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });

      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });

    it("a payment of another invoice, an unknown payment and an unknown invoice are all 404", async () => {
      const first = await payableInvoice(w);
      const second = await payableInvoice(w, { owner: "priya" });
      await paid(w, first.invoice.id, "100.00");
      await paid(w, second.invoice.id, "100.00");
      const firstPayment = await paymentIdOf(first.invoice.id);
      const before = await paymentFootprint(w, second.invoice.id);

      // The payment exists, but not on that invoice: the pair is wrong, so it is not found.
      expectApiError(
        await voidPaymentRequest(w, second.invoice.id, firstPayment, { reason: REASON }),
        { status: 404, code: ErrorCode.NOT_FOUND },
      );
      expectApiError(
        await voidPaymentRequest(w, first.invoice.id, MISSING_ID, { reason: REASON }),
        {
          status: 404,
          code: ErrorCode.NOT_FOUND,
        },
      );
      expectApiError(await voidPaymentRequest(w, MISSING_ID, firstPayment, { reason: REASON }), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expect(await paymentFootprint(w, second.invoice.id)).toEqual(before);
      const row = await prisma.paymentRecord.findUniqueOrThrow({ where: { id: firstPayment } });
      expect(row.voidedAt).toBeNull();
    });
  });

  describe("G.5: the invoice's void is blocked while a payment stands, and allowed after", () => {
    it("refuses with INVOICE_HAS_PAYMENTS, then allows once every payment is voided", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      await paid(w, invoice.id, "50.00");
      const first = await paymentIdOf(invoice.id, 0);
      const second = await paymentIdOf(invoice.id, 1);
      const voidBody = { reason: "Billed the wrong customer.", expectedStatus: "PARTIALLY_PAID" };

      expectApiError(await voidInvoiceRequest(w, invoice.id, voidBody), {
        status: 409,
        code: ErrorCode.INVOICE_HAS_PAYMENTS,
      });
      await voidPaymentRequest(w, invoice.id, first, { reason: REASON });
      expectApiError(await voidInvoiceRequest(w, invoice.id, voidBody), {
        status: 409,
        code: ErrorCode.INVOICE_HAS_PAYMENTS,
      });
      await voidPaymentRequest(w, invoice.id, second, { reason: REASON });

      const response = await voidInvoiceRequest(w, invoice.id, {
        ...voidBody,
        expectedStatus: "ISSUED",
      });

      expect(response.status).toBe(200);
      const voided = dataOf<AdminInvoiceDto>(response);
      expect(voided.status).toBe(InvoiceStatus.VOID);
      // The payments are still on the voided invoice's history.
      expect(voided.payments).toHaveLength(2);
      expect(voided.payments.every((payment) => payment.voided !== null)).toBe(true);
      expect(await prisma.paymentRecord.count({ where: { invoiceId: invoice.id } })).toBe(2);
      await expectLedgerInvariant(w, invoice.id);
    });
  });

  describe("the history and the customer", () => {
    it("records an event with the amounts but not the reason, and the customer sees a safe sentence", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00", { method: "CASH" });
      const target = await paymentIdOf(invoice.id);

      await voidPaymentRequest(w, invoice.id, target, { reason: REASON });

      const events = await prisma.activityEvent.findMany({
        where: { entityType: "INVOICE", entityId: invoice.id, action: "payment.voided" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatus: "PARTIALLY_PAID",
        toStatus: "ISSUED",
        summary: "Morgan Reyes voided the payment of $100.00 received on Mar 2, 2026.",
        publicSummary:
          "We reversed the payment record of $100.00 dated Mar 2, 2026, so the balance due is now $300.00.",
      });
      expect(events[0]?.metadata).toEqual({
        invoiceReference: invoice.invoiceNumber,
        amount: "100.00",
        currencyCode: "USD",
        paymentMethod: "CASH",
        paymentDate: "2026-03-02",
        amountPaid: "0.00",
        balance: "300.00",
      });
      expect(JSON.stringify(events)).not.toContain("INTERNAL-REASON");
    });

    it("tells the customer in the app that their balance went up, without the reason, and sends no email", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const target = await paymentIdOf(invoice.id);
      const before = await paymentFootprint(w, invoice.id);

      await voidPaymentRequest(w, invoice.id, target, { reason: REASON });

      const after = await paymentFootprint(w, invoice.id);
      expect(after.notifications).toBe(before.notifications + 1);
      expect(after.events).toBe(before.events + 1);
      expect(after.emails).toBe(before.emails);
      const notification = await prisma.notification.findFirstOrThrow({
        where: { title: { contains: "reversed" } },
      });
      expect(notification.recipientUserId).toBe(w.alex.user.id);
      expect(notification.title).toBe(
        `A payment record on invoice ${invoice.invoiceNumber} was reversed`,
      );
      expect(notification.message).toContain("The balance due is now $300.00.");
      expect(notification.linkPath).toBe(`/portal/invoices/${invoice.id}`);
      expect(JSON.stringify(notification)).not.toContain("INTERNAL-REASON");
      expect(w.logs.text()).not.toContain("INTERNAL-REASON");
    });

    it("a refusal leaves no notification, event or email behind", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const before = await paymentFootprint(w, invoice.id);
      await voidPaymentRequest(w, invoice.id, MISSING_ID, { reason: REASON });
      await voidPaymentRequest(w, invoice.id, await paymentIdOf(invoice.id), { reason: "no" });
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });
  });

  describe("authorization", () => {
    it("is 401 without a session, 403 for a customer and 403 from another origin", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const target = await paymentIdOf(invoice.id);
      const url = `${ADMIN_INVOICES}/${invoice.id}/payments/${target}/void`;
      const before = await paymentFootprint(w, invoice.id);

      expectApiError(await w.client.post(url).send({ reason: REASON }), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(
          await voidPaymentRequest(w, invoice.id, target, { reason: REASON }, cookie),
          {
            status: 403,
            code: ErrorCode.FORBIDDEN,
          },
        );
      }
      expectApiError(
        await w.client
          .post(url, { cookie: w.adminCookie, origin: "https://evil.example.com" })
          .send({ reason: REASON }),
        { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH },
      );
      expect(await paymentFootprint(w, invoice.id)).toEqual(before);
    });
  });

  describe("G.4: there is no way to edit or delete a payment", () => {
    it("the invoice routes include no PATCH, PUT or DELETE that reaches a payment", () => {
      const router = createAdminInvoicesRouter(w.deps);
      const routes = router.stack.flatMap((layer) => {
        const route = (
          layer as unknown as {
            route?: { path: string | string[]; methods: Record<string, boolean> };
          }
        ).route;
        if (route === undefined) {
          return [];
        }
        const paths = Array.isArray(route.path) ? route.path : [route.path];
        return paths.flatMap((path) =>
          Object.keys(route.methods)
            .filter((method) => route.methods[method])
            .map((method) => `${method.toUpperCase()} ${path}`),
        );
      });

      const paymentRoutes = routes.filter((route) => route.includes("/payments"));
      expect(new Set(paymentRoutes)).toEqual(
        new Set(["POST /invoices/:id/payments", "POST /invoices/:id/payments/:paymentId/void"]),
      );
      for (const route of routes) {
        if (/^(PATCH|PUT|DELETE) /.test(route)) {
          expect(route).not.toContain("payment");
        }
      }
      // The one PATCH there is edits a draft invoice, and refuses an issued one (T20).
      expect(routes.filter((route) => route.startsWith("DELETE"))).toEqual([]);
    });

    it.each(["patch", "put", "delete"] as const)(
      "a %s of a payment is 404 and the payment is unchanged",
      async (method) => {
        const { invoice } = await payableInvoice(w);
        await paid(w, invoice.id, "100.00");
        const target = await paymentIdOf(invoice.id);
        const before = await paymentFootprint(w, invoice.id);

        const response = await w.client[method](
          `${ADMIN_INVOICES}/${invoice.id}/payments/${target}`,
          {
            cookie: w.adminCookie,
          },
        ).send({ amount: "1.00" });

        expect(response.status).toBe(404);
        expect(await paymentFootprint(w, invoice.id)).toEqual(before);
      },
    );

    it.each(["get", "patch", "put", "delete"] as const)(
      "a %s of the payments collection is 404",
      async (method) => {
        const { invoice } = await payableInvoice(w);
        const response = await w.client[method](`${ADMIN_INVOICES}/${invoice.id}/payments`, {
          cookie: w.adminCookie,
        }).send({});
        expect(response.status).toBe(404);
      },
    );

    it("recording still works after all of that, so the 404s are about the method and not the invoice", async () => {
      const { invoice } = await payableInvoice(w);
      expect((await recordPaymentRequest(w, invoice.id, paymentBody())).status).toBe(201);
    });
  });
});
