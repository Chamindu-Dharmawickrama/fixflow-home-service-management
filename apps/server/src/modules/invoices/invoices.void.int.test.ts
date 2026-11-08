import { type AdminInvoiceDto, ErrorCode, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signInAs } from "../../test/auth-helpers.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  completedJob,
  createInvoiceRequest,
  draftInvoice,
  getInvoiceRequest,
  insertPayment,
  invoiceFootprint,
  invoiceSnapshot,
  type InvoiceWorld,
  invoiceWorld,
  issued,
  issuedInvoice,
  issueRequest,
  voidInvoiceRequest,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const REASON = "INTERNAL: the labour hours were entered twice, customer disputes it.";

describe("POST /admin/invoices/:id/void (FR-076, BR-16, D-26)", () => {
  describe("a draft", () => {
    it("is voided with the actor, time and reason, and nobody is told", async () => {
      const { invoice: draft, job } = await draftInvoice(w);
      const before = await invoiceFootprint(w);

      const response = await voidInvoiceRequest(w, draft.id, {
        reason: REASON,
        expectedStatus: "DRAFT",
      });
      const after = await invoiceFootprint(w);

      expect(response.status).toBe(200);
      const invoice = dataOf<AdminInvoiceDto>(response);
      expect(invoice.status).toBe(InvoiceStatus.VOID);
      expect(invoice.statusLabel).toBe("Void");
      expect(invoice.voided).toEqual({
        at: "2026-03-02T09:00:00.000Z",
        by: { name: "Morgan Reyes" },
        reason: REASON,
      });
      expect(invoice.availableActions).toEqual([]);
      expect(invoice.invoiceNumber).toBeNull();

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.voidedByUserId).toBe(w.admin.id);
      expect(row.voidReason).toBe(REASON);

      const events = await prisma.activityEvent.findMany({
        where: { entityType: "INVOICE", entityId: draft.id, action: "invoice.voided" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatus: "DRAFT",
        toStatus: "VOID",
        publicSummary: null,
        customerId: job.customerId,
      });
      // The reason is an input of the invoice, not of its history: no event repeats it.
      expect(JSON.stringify(events)).not.toContain("labour hours");

      expect(after.notifications).toBe(before.notifications);
      expect(after.emails).toBe(before.emails);
    });
  });

  describe("an issued invoice", () => {
    it("is voided, the customer is told safely, and the job may be invoiced again", async () => {
      const { invoice: issuedOne, job } = await issuedInvoice(w);
      const before = await invoiceFootprint(w);

      const response = await voidInvoiceRequest(w, issuedOne.id, {
        reason: REASON,
        expectedStatus: "ISSUED",
      });
      const after = await invoiceFootprint(w);

      expect(response.status).toBe(200);
      const invoice = dataOf<AdminInvoiceDto>(response);
      expect(invoice.status).toBe(InvoiceStatus.VOID);
      // The number stays: a voided invoice is history, and its number is not reused.
      expect(invoice.invoiceNumber).toBe("INV-2026-00001");
      expect(invoice.voided?.reason).toBe(REASON);
      expect(invoice.isSnapshot).toBe(true);

      const events = await prisma.activityEvent.findMany({
        where: { entityType: "INVOICE", entityId: issuedOne.id, action: "invoice.voided" },
      });
      expect(events[0]).toMatchObject({
        fromStatus: "ISSUED",
        toStatus: "VOID",
        publicSummary: "We voided invoice INV-2026-00001.",
      });

      expect(after.notifications - before.notifications).toBe(1);
      const notification = await prisma.notification.findFirstOrThrow({
        where: { type: "INVOICE_VOIDED" },
      });
      expect(notification).toMatchObject({
        recipientUserId: w.alex.user.id,
        linkPath: `/portal/invoices/${issuedOne.id}`,
      });
      expect(notification.title).toBe("Invoice INV-2026-00001 was voided");

      // Customer-safe: the internal reason reaches neither the notification, the email nor the timeline.
      expect(after.emails - before.emails).toBe(1);
      const mail = w.emails.last;
      expect(mail?.to).toBe("alex.morgan@example.test");
      expect(mail?.subject).toContain("INV-2026-00001");
      for (const text of [
        notification.title,
        notification.message,
        mail?.subject,
        mail?.text,
        mail?.html,
      ]) {
        expect(text ?? "").not.toContain("labour hours");
        expect(text ?? "").not.toContain("INTERNAL");
      }

      // The job has no live invoice, so a new draft is allowed (G.1).
      const second = await createInvoiceRequest(w, job.id);
      expect(second.status).toBe(201);
      expect(dataOf<AdminInvoiceDto>(second).id).not.toBe(issuedOne.id);
      expect(await prisma.invoice.count({ where: { workOrderId: job.id } })).toBe(2);
    });

    it("an overdue invoice can be voided", async () => {
      const { invoice } = await issuedInvoice(w);
      // Two weeks and a day later the due date (16 March) has passed.
      w.clock.set("2026-03-17T16:00:00.000Z");
      w.adminCookie = await signInAs(w.app, w.admin.email);
      const overdue = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
      expect(overdue.status).toBe(InvoiceStatus.OVERDUE);

      const response = await voidInvoiceRequest(w, invoice.id, {
        reason: REASON,
        expectedStatus: "OVERDUE",
      });

      expect(response.status).toBe(200);
      const voided = dataOf<AdminInvoiceDto>(response);
      expect(voided.status).toBe(InvoiceStatus.VOID);
      const event = await prisma.activityEvent.findFirstOrThrow({
        where: { entityId: invoice.id, action: "invoice.voided" },
      });
      expect(event.fromStatus).toBe("OVERDUE");
    });
  });

  describe("active payments block a void (INVOICE_HAS_PAYMENTS)", () => {
    it("refuses an issued invoice with a payment on it and changes nothing", async () => {
      const { invoice } = await issuedInvoice(w);
      await insertPayment(prisma, { invoiceId: invoice.id, recordedByUserId: w.admin.id });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "50.00" } });
      const before = await invoiceSnapshot(prisma, invoice.id);
      const footprint = await invoiceFootprint(w);

      const error = expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "ISSUED" }),
        { status: 409, code: ErrorCode.INVOICE_HAS_PAYMENTS },
      );

      expect(error.message).toContain("Void the payments first");
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
      expect(await invoiceFootprint(w)).toEqual(footprint);
    });

    it("refuses an overdue invoice with a payment on it", async () => {
      const { invoice } = await issuedInvoice(w);
      await insertPayment(prisma, { invoiceId: invoice.id, recordedByUserId: w.admin.id });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "50.00" } });
      w.clock.set("2026-03-17T16:00:00.000Z");
      w.adminCookie = await signInAs(w.app, w.admin.email);

      expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "OVERDUE" }),
        { status: 409, code: ErrorCode.INVOICE_HAS_PAYMENTS },
      );
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        "OVERDUE",
      );
    });

    it("refuses a paid invoice with HAS_PAYMENTS, not a bare invalid-transition", async () => {
      const { invoice } = await issuedInvoice(w);
      await insertPayment(prisma, {
        invoiceId: invoice.id,
        recordedByUserId: w.admin.id,
        amount: invoice.totalAmount,
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid: invoice.totalAmount, status: "PAID" },
      });
      expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "PAID" }),
        { status: 409, code: ErrorCode.INVOICE_HAS_PAYMENTS },
      );
    });

    it("allows the void once every payment has itself been voided", async () => {
      const { invoice } = await issuedInvoice(w);
      await insertPayment(prisma, {
        invoiceId: invoice.id,
        recordedByUserId: w.admin.id,
        voided: true,
      });

      const response = await voidInvoiceRequest(w, invoice.id, {
        reason: REASON,
        expectedStatus: "ISSUED",
      });

      expect(response.status).toBe(200);
      // The voided payment stays on the record.
      expect(dataOf<AdminInvoiceDto>(response).payments).toHaveLength(1);
      expect(dataOf<AdminInvoiceDto>(response).payments[0]?.voided?.reason).toBe(
        "Recorded against the wrong invoice.",
      );
    });

    it("offers no void action while a payment is active", async () => {
      const { invoice } = await issuedInvoice(w);
      await insertPayment(prisma, { invoiceId: invoice.id, recordedByUserId: w.admin.id });
      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
      expect(read.availableActions).toEqual([]);
      expect(read.payments).toHaveLength(1);
    });
  });

  describe("what is refused", () => {
    it("an invoice that is already void is 409 and nothing changes", async () => {
      const { invoice } = await draftInvoice(w);
      await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "DRAFT" });
      const before = await invoiceFootprint(w);

      // The screen still showed the draft: the second admin's click is stale.
      expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "DRAFT" }),
        { status: 409, code: ErrorCode.STALE_STATE },
      );
      // A caller who knows it is void is told it cannot be voided again.
      expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "VOID" }),
        { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION },
      );
      expect(await invoiceFootprint(w)).toEqual(before);
    });

    it("a stale expectedStatus is 409 STALE_STATE and the invoice is unchanged", async () => {
      const { invoice } = await draftInvoice(w);
      await issued(w, invoice.id);
      const before = await invoiceSnapshot(prisma, invoice.id);

      const error = expectApiError(
        await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "DRAFT" }),
        { status: 409, code: ErrorCode.STALE_STATE },
      );

      expect(error.details).toEqual({ currentStatus: "ISSUED" });
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
    });

    it("requires a reason of 5 to 500 characters", async () => {
      const { invoice } = await draftInvoice(w);
      const before = await invoiceSnapshot(prisma, invoice.id);
      for (const reason of [undefined, "", "    ", "no", "x".repeat(501)]) {
        const response = await voidInvoiceRequest(w, invoice.id, {
          ...(reason !== undefined && { reason }),
          expectedStatus: "DRAFT",
        });
        const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
        expect(error.fieldErrors).toHaveProperty("reason");
      }
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);

      expect(
        (
          await voidInvoiceRequest(w, invoice.id, {
            reason: "x".repeat(500),
            expectedStatus: "DRAFT",
          })
        ).status,
      ).toBe(200);
    });

    it("rejects a missing or unknown expectedStatus and unknown fields", async () => {
      const { invoice } = await draftInvoice(w);
      for (const body of [
        { reason: REASON },
        { reason: REASON, expectedStatus: "SOMETHING" },
        { reason: REASON, expectedStatus: "DRAFT", customerMessage: "hello" },
      ]) {
        expectApiError(await voidInvoiceRequest(w, invoice.id, body), {
          status: 422,
          code: ErrorCode.VALIDATION_ERROR,
        });
      }
    });
  });

  describe("history (BR-16): voided records are never deleted", () => {
    it("there is no way to delete an invoice, and a voided one stays readable", async () => {
      const { invoice } = await issuedInvoice(w);
      await voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "ISSUED" });

      const removal = await w.client.delete(`${ADMIN_INVOICES}/${invoice.id}`, {
        cookie: w.adminCookie,
      });
      expect(removal.status).toBe(404);

      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
      expect(read.status).toBe(InvoiceStatus.VOID);
      expect(read.invoiceNumber).toBe("INV-2026-00001");
      expect(read.timeline.map((event) => event.action)).toEqual([
        "invoice.created",
        "invoice.issued",
        "invoice.voided",
      ]);
    });

    it("the database refuses a void without who, when and why", async () => {
      const { invoice } = await draftInvoice(w);
      await expect(
        prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } }),
      ).rejects.toThrow();
    });
  });

  describe("concurrency", () => {
    it("a void racing an issue: exactly one wins, and the other is refused", async () => {
      const { invoice } = await draftInvoice(w);

      const [issue, voided] = await Promise.all([
        issueRequest(w, invoice.id),
        voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "DRAFT" }),
      ]);

      // Whichever took the lock first decides; the other finds the status changed.
      expect([issue.status, voided.status].sort()).toEqual([200, 409]);
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      if (issue.status === 200) {
        expect(row.status).toBe("ISSUED");
        expect(row.voidedAt).toBeNull();
      } else {
        expect(row.status).toBe("VOID");
        expect(row.invoiceNumber).toBeNull();
        expect(await prisma.referenceCounter.count({ where: { type: "INVOICE" } })).toBe(0);
      }
    });

    it("two voids at the same moment: one succeeds, one is 409, one notification is sent", async () => {
      const { invoice } = await issuedInvoice(w);
      const before = await invoiceFootprint(w);

      const responses = await Promise.all([
        voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "ISSUED" }),
        voidInvoiceRequest(w, invoice.id, { reason: REASON, expectedStatus: "ISSUED" }),
      ]);
      const after = await invoiceFootprint(w);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(after.notifications - before.notifications).toBe(1);
      expect(after.emails - before.emails).toBe(1);
      expect(await prisma.activityEvent.count({ where: { action: "invoice.voided" } })).toBe(1);
    });

    it("a create racing a void of the job's only invoice never leaves two live invoices", async () => {
      const { job } = await completedJob(w);
      const first = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));

      await Promise.all([
        voidInvoiceRequest(w, first.id, { reason: REASON, expectedStatus: "DRAFT" }),
        createInvoiceRequest(w, job.id),
      ]);

      const live = await prisma.invoice.count({
        where: { workOrderId: job.id, status: { not: "VOID" } },
      });
      expect(live).toBeLessThanOrEqual(1);
    });
  });

  describe("access", () => {
    it("is 401 without a session, 403 for a customer and 404 for an unknown invoice", async () => {
      const { invoice } = await draftInvoice(w);
      const before = await invoiceSnapshot(prisma, invoice.id);
      const body = { reason: REASON, expectedStatus: "DRAFT" };

      expectApiError(await w.client.post(`${ADMIN_INVOICES}/${invoice.id}/void`).send(body), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(await voidInvoiceRequest(w, invoice.id, body, cookie), {
          status: 403,
          code: ErrorCode.FORBIDDEN,
        });
      }
      expectApiError(await voidInvoiceRequest(w, MISSING_ID, body), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expect(await invoiceSnapshot(prisma, invoice.id)).toBe(before);
    });
  });
});
