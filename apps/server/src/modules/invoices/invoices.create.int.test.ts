import {
  type AdminInvoiceDto,
  type AdminWorkOrderDto,
  ErrorCode,
  InvoiceAction,
  InvoiceStatus,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  ADMIN_JOBS,
  completedJob,
  createInvoiceRequest,
  type InvoiceWorld,
  invoiceWorld,
  jobWithQuote,
  voidInvoiceRequest,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";
import { at, insertJob, newJob, schedule } from "../../test/work-order-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const S = WorkOrderStatus;

describe("POST /admin/work-orders/:id/invoice (FR-070, D-26)", () => {
  it("creates a draft pre-filled from the accepted quotation, with no number", async () => {
    const { job, totals } = await completedJob(w);

    const response = await createInvoiceRequest(w, job.id);

    expect(response.status).toBe(201);
    const invoice = dataOf<AdminInvoiceDto>(response);
    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.statusLabel).toBe("Draft");
    expect(invoice.invoiceNumber).toBeNull();
    expect(invoice.issueDate).toBeNull();
    expect(invoice.issuedAt).toBeNull();
    expect(invoice.isSnapshot).toBe(false);
    expect(invoice.currencyCode).toBe("USD");
    expect(invoice.taxRate).toBe("8.00");
    expect(invoice.lines.map((line) => line.description)).toEqual([
      "Diagnostic visit",
      "Run capacitor",
      "Labour",
    ]);
    expect(invoice.lines.map((line) => line.quantity)).toEqual(["1.00", "1.00", "1.50"]);
    expect(invoice.lines.map((line) => line.taxable)).toEqual([false, true, false]);
    // The totals are the shared calculation of the accepted quotation's lines, discount and rate.
    expect(invoice.subtotal).toBe(totals.subtotal);
    expect(invoice.discountAmount).toBe(totals.discountAmount);
    expect(invoice.taxableBase).toBe(totals.taxableBase);
    expect(invoice.taxAmount).toBe(totals.taxAmount);
    expect(invoice.totalAmount).toBe(totals.totalAmount);
    expect(invoice.amountPaid).toBe("0.00");
    expect(invoice.balanceDue).toBe(totals.totalAmount);
    expect(invoice.payments).toEqual([]);
    expect(invoice.availableActions).toEqual([
      InvoiceAction.EDIT,
      InvoiceAction.ISSUE,
      InvoiceAction.VOID,
    ]);
    expect(invoice.job.id).toBe(job.id);
    expect(invoice.job.reference).toBe(job.reference);
    expect(invoice.createdBy.name).toBe("Morgan Reyes");
  });

  it("defaults the due date to today plus invoiceDueDays on the business's calendar", async () => {
    // The clock reads 04:00 on 2 March in New York (09:00 UTC); 14 days later is 16 March.
    const { job } = await completedJob(w);
    expect(dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id)).dueDate).toBe(
      "2026-03-16",
    );
  });

  it("uses the business's calendar, not UTC, for the default due date", async () => {
    // 02:00 UTC on 3 March is still the evening of 2 March in New York.
    w.clock.set("2026-03-03T02:00:00.000Z");
    await prisma.businessSettings.updateMany({ data: { invoiceDueDays: 30 } });
    const { job } = await completedJob(w);
    expect(dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id)).dueDate).toBe(
      "2026-04-01",
    );
  });

  it("copies the quotation's currency, which an invoice keeps even if the settings change", async () => {
    const { job } = await completedJob(w);
    await prisma.businessSettings.updateMany({ data: { currencyCode: "EUR" } });
    expect(dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id)).currencyCode).toBe("USD");
  });

  it("records the creation for staff only", async () => {
    const { job } = await completedJob(w);
    const invoice = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "INVOICE", entityId: invoice.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "invoice.created",
      toStatus: "DRAFT",
      publicSummary: null,
      actorUserId: w.admin.id,
      customerId: job.customerId,
      requestId: job.requestId,
    });
    expect(events[0]?.summary).toContain(job.reference);
    expect(invoice.timeline).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(0);
    await w.deps.emailDispatcher.idle();
    expect(w.emails.sent).toHaveLength(0);
  });

  it("is listed as CREATE_INVOICE on a completed job until an invoice exists, then links to it", async () => {
    const { job } = await completedJob(w);
    const read = async () =>
      dataOf<AdminWorkOrderDto>(
        await w.client.get(`${ADMIN_JOBS}/${job.id}`, { cookie: w.adminCookie }),
      );

    const before = await read();
    expect(before.availableActions).toEqual([WorkOrderAction.CREATE_INVOICE]);
    expect(before.invoice).toBeNull();

    const invoice = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));
    const after = await read();
    expect(after.availableActions).toEqual([]);
    expect(after.invoice).toEqual({
      id: invoice.id,
      invoiceNumber: null,
      status: InvoiceStatus.DRAFT,
      statusLabel: "Draft",
    });

    // A voided invoice is not live: the job may be invoiced again and links to no invoice.
    const voided = await voidInvoiceRequest(w, invoice.id, {
      reason: "Wrong customer note on the draft.",
      expectedStatus: "DRAFT",
    });
    expect(voided.status).toBe(200);
    const reopened = await read();
    expect(reopened.availableActions).toEqual([WorkOrderAction.CREATE_INVOICE]);
    expect(reopened.invoice).toBeNull();
  });

  it("does not list CREATE_INVOICE for a job that is not completed", async () => {
    for (const status of [
      S.PENDING_SCHEDULING,
      S.SCHEDULED,
      S.IN_PROGRESS,
      S.NEEDS_RESCHEDULING,
      S.CANCELLED,
    ]) {
      const { job } = await jobWithQuote(w, { status });
      const detail = dataOf<AdminWorkOrderDto>(
        await w.client.get(`${ADMIN_JOBS}/${job.id}`, { cookie: w.adminCookie }),
      );
      expect(detail.availableActions).not.toContain(WorkOrderAction.CREATE_INVOICE);
    }
  });

  describe("only a completed job can be invoiced", () => {
    it.each([S.PENDING_SCHEDULING, S.SCHEDULED, S.IN_PROGRESS, S.NEEDS_RESCHEDULING, S.CANCELLED])(
      "refuses a %s job with 409 and creates nothing",
      async (status) => {
        const { job } = await jobWithQuote(w, { status });

        const response = await createInvoiceRequest(w, job.id);

        const error = expectApiError(response, {
          status: 409,
          code: ErrorCode.INVALID_STATE_TRANSITION,
        });
        expect(error.message).toContain("completed job");
        expect(await prisma.invoice.count()).toBe(0);
        expect(await prisma.activityEvent.count()).toBe(0);
      },
    );
  });

  describe("one invoice per job (D-26)", () => {
    it("refuses a second while the first is a draft, naming it", async () => {
      const { job } = await completedJob(w);
      const first = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));

      const response = await createInvoiceRequest(w, job.id);

      const error = expectApiError(response, { status: 409, code: ErrorCode.INVOICE_EXISTS });
      expect(error.details).toEqual({ invoiceId: first.id, currentStatus: "DRAFT" });
      expect(await prisma.invoice.count()).toBe(1);
    });

    it("refuses a second while the first is issued", async () => {
      const { job } = await completedJob(w);
      const first = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));
      const issue = await w.client
        .post(`${ADMIN_INVOICES}/${first.id}/issue`, { cookie: w.adminCookie })
        .send({ expectedStatus: "DRAFT" });
      expect(issue.status).toBe(200);

      const error = expectApiError(await createInvoiceRequest(w, job.id), {
        status: 409,
        code: ErrorCode.INVOICE_EXISTS,
      });
      expect(error.message).toContain("INV-2026-00001");
      expect(await prisma.invoice.count()).toBe(1);
    });

    it("allows a new draft once the first was voided, and keeps the voided one", async () => {
      const { job } = await completedJob(w);
      const first = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));
      await voidInvoiceRequest(w, first.id, {
        reason: "Created for the wrong job in error.",
        expectedStatus: "DRAFT",
      });

      const second = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));

      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe(InvoiceStatus.DRAFT);
      const rows = await prisma.invoice.findMany({
        where: { workOrderId: job.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((row) => row.status)).toEqual(["VOID", "DRAFT"]);
    });

    it("two creates at the same moment produce exactly one invoice", async () => {
      const { job } = await completedJob(w);

      const responses = await Promise.all([
        createInvoiceRequest(w, job.id),
        createInvoiceRequest(w, job.id),
        createInvoiceRequest(w, job.id),
      ]);

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      for (const response of responses.filter((candidate) => candidate.status === 409)) {
        expectApiError(response, { status: 409, code: ErrorCode.INVOICE_EXISTS });
      }
      expect(await prisma.invoice.count({ where: { workOrderId: job.id } })).toBe(1);
      expect(await prisma.activityEvent.count({ where: { action: "invoice.created" } })).toBe(1);
    });

    it("the database refuses a second live invoice even when the service is bypassed", async () => {
      const { job } = await completedJob(w);
      await createInvoiceRequest(w, job.id);
      await expect(
        prisma.invoice.create({
          data: {
            workOrderId: job.id,
            customerId: job.customerId,
            createdByUserId: w.admin.id,
            currencyCode: "USD",
            taxRate: "8.00",
            subtotal: "1.00",
            taxableBase: "1.00",
            taxAmount: "0.08",
            totalAmount: "1.08",
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("access", () => {
    it("is 401 without a session and 403 for a customer, creating nothing", async () => {
      const { job } = await completedJob(w);
      const visitor = await w.client.post(`${ADMIN_JOBS}/${job.id}/invoice`).send({});
      expectApiError(visitor, { status: 401, code: ErrorCode.UNAUTHENTICATED });
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(await createInvoiceRequest(w, job.id, cookie), {
          status: 403,
          code: ErrorCode.FORBIDDEN,
        });
      }
      expect(await prisma.invoice.count()).toBe(0);
    });

    it("is 404 for a job that does not exist and 422 for a malformed id", async () => {
      expectApiError(await createInvoiceRequest(w, MISSING_ID), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expectApiError(await createInvoiceRequest(w, "not-an-id"), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it("refuses a body that names anything: the server fills the draft in", async () => {
      const { job } = await completedJob(w);
      const response = await w.client
        .post(`${ADMIN_JOBS}/${job.id}/invoice`, { cookie: w.adminCookie })
        .send({ totalAmount: "1.00" });
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(await prisma.invoice.count()).toBe(0);
    });

    it("an inserted job whose quotation has no lines cannot be invoiced from nothing", async () => {
      const bare = await insertJob(w, { status: S.COMPLETED });
      const response = await createInvoiceRequest(w, bare.id);
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(await prisma.invoice.count()).toBe(0);
    });
  });
});

describe("no delete route exists (BR-16)", () => {
  it("DELETE /admin/invoices/:id is 404 and the invoice stays", async () => {
    const { job } = await completedJob(w);
    const invoice = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));
    const response = await w.client.delete(`${ADMIN_INVOICES}/${invoice.id}`, {
      cookie: w.adminCookie,
    });
    expect(response.status).toBe(404);
    expect(await prisma.invoice.count()).toBe(1);
  });
});

describe("the whole journey, through the real endpoints", () => {
  it("a request becomes a quotation, a job, a completed job, an invoice and an issued invoice", async () => {
    // The real chain: sent and accepted quotation, converted job, scheduled, started, completed.
    const job = await newJob(w);
    const booked = await schedule(
      w,
      job,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "12:00"),
    );
    const post = (body: object) =>
      w.client.post(`${ADMIN_JOBS}/${job.id}/transitions`, { cookie: w.adminCookie }).send(body);
    expect((await post({ action: "START", expectedStatus: booked.status })).status).toBe(200);
    const done = await post({
      action: "COMPLETE",
      expectedStatus: "IN_PROGRESS",
      completionNote: "Replaced the capacitor and tested the unit end to end.",
    });
    expect(done.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(done).availableActions).toEqual([
      WorkOrderAction.CREATE_INVOICE,
    ]);

    // The ready-to-invoice tab lists it, then stops listing it once there is an invoice.
    const readyIds = async () =>
      (
        (await w.client.get(`${ADMIN_JOBS}?view=ready-to-invoice`, { cookie: w.adminCookie }))
          .body as {
          data: { id: string }[];
        }
      ).data.map((item) => item.id);
    expect(await readyIds()).toEqual([job.id]);

    const invoice = dataOf<AdminInvoiceDto>(await createInvoiceRequest(w, job.id));
    expect(invoice.lines.map((line) => line.description)).toEqual([
      "Diagnostic visit",
      "Run capacitor",
      "Labour",
    ]);
    expect(invoice.quotation?.id).toBe(job.quotation.id);
    expect(await readyIds()).toEqual([]);

    const issuedResponse = await w.client
      .post(`${ADMIN_INVOICES}/${invoice.id}/issue`, { cookie: w.adminCookie })
      .send({ expectedStatus: "DRAFT" });
    expect(issuedResponse.status).toBe(200);
    expect(dataOf<AdminInvoiceDto>(issuedResponse).invoiceNumber).toBe("INV-2026-00001");

    // Voiding it puts the job back on the tab.
    const voided = await voidInvoiceRequest(w, invoice.id, {
      reason: "Customer asked for the parts on a separate invoice.",
      expectedStatus: "ISSUED",
    });
    expect(voided.status).toBe(200);
    expect(await readyIds()).toEqual([job.id]);
  });
});
