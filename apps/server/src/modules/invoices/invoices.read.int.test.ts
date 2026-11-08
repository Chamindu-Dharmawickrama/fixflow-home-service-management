import {
  type AdminInvoiceDto,
  type AdminInvoiceListResponse,
  ErrorCode,
  InvoiceStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  completedJob,
  draftInvoice,
  getInvoiceRequest,
  insertPayment,
  type InvoiceWorld,
  invoiceWorld,
  issued,
  issuedInvoice,
  moveClockTo,
  saveInvoice,
  startInvoice,
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

const list = async (query = "") => {
  const response = await w.client.get(`${ADMIN_INVOICES}${query}`, { cookie: w.adminCookie });
  expect(response.status).toBe(200);
  return response.body as AdminInvoiceListResponse;
};
/** An invoice issued with the given dates (the draft is saved with them first). */
async function issuedWith(
  owner: "alex" | "priya",
  dates: { issueDate: string; dueDate: string },
): Promise<AdminInvoiceDto> {
  const { invoice } = await draftInvoice(w, owner);
  const saved = await saveInvoice(w, invoice, dates);
  return issued(w, saved.id);
}

describe("GET /admin/invoices/:id (FR-074)", () => {
  it("returns the whole invoice for the business: lines, totals, snapshots, links, history, actions", async () => {
    const { invoice: draft, job } = await draftInvoice(w);
    const invoice = await issued(w, draft.id);

    const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));

    expect(Object.keys(read).sort()).toEqual(
      [
        "amountPaid",
        "availableActions",
        "balanceDue",
        "business",
        "createdAt",
        "createdBy",
        "currencyCode",
        "customer",
        "customerId",
        "customerNote",
        "daysOverdue",
        "discountAmount",
        "dueDate",
        "footer",
        "id",
        "invoiceNumber",
        "isSnapshot",
        "issueDate",
        "issuedAt",
        "issuedBy",
        "job",
        "lines",
        "paymentInstructions",
        "payments",
        "quotation",
        "request",
        "serviceName",
        "status",
        "statusLabel",
        "subtotal",
        "taxAmount",
        "taxRate",
        "taxableBase",
        "timeZone",
        "timeline",
        "totalAmount",
        "updatedAt",
        "voided",
      ].sort(),
    );
    expect(read).toMatchObject({
      invoiceNumber: "INV-2026-00001",
      status: "ISSUED",
      serviceName: "AC Repair",
      customerId: job.customerId,
      timeZone: "America/New_York",
      payments: [],
      voided: null,
      daysOverdue: 0,
    });
    expect(read.job).toEqual({ id: job.id, reference: job.reference });
    expect(read.request.id).toBe(job.requestId);
    expect(read.quotation?.id).toBe(job.quotationId);
    expect(read.lines).toHaveLength(3);
    expect(read.timeline.map((event) => event.action)).toEqual([
      "invoice.created",
      "invoice.issued",
    ]);
    // Money is a decimal string next to an explicit currency.
    expect(read.totalAmount).toMatch(/^\d+\.\d{2}$/);
    expect(read.currencyCode).toBe("USD");
  });

  it("is 404 for an invoice that does not exist and 422 for a malformed id", async () => {
    expectApiError(await getInvoiceRequest(w, MISSING_ID), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await getInvoiceRequest(w, "nope"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("is 401 without a session and 403 for either customer, including the invoice's own", async () => {
    const { invoice } = await issuedInvoice(w, "alex");
    expectApiError(await w.client.get(`${ADMIN_INVOICES}/${invoice.id}`), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    for (const cookie of [w.alexCookie, w.priyaCookie]) {
      expectApiError(await getInvoiceRequest(w, invoice.id, cookie), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }
  });

  it("reads the payments that exist, voided ones included, and works out the balance", async () => {
    const { invoice } = await issuedInvoice(w);
    await insertPayment(prisma, {
      invoiceId: invoice.id,
      recordedByUserId: w.admin.id,
      amount: "40.00",
    });
    await insertPayment(prisma, {
      invoiceId: invoice.id,
      recordedByUserId: w.admin.id,
      amount: "10.00",
      voided: true,
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: "40.00" } });

    const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));

    expect(read.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(read.amountPaid).toBe("40.00");
    expect(read.balanceDue).toBe((Number(invoice.totalAmount) - 40).toFixed(2));
    expect(read.payments.map((payment) => [payment.amount, payment.voided === null])).toEqual([
      ["40.00", true],
      ["10.00", false],
    ]);
  });
});

describe("the overdue boundary and sync (D-23, D-26, AC-IP)", () => {
  // The invoice is due on 16 March 2026. New York is on summer time then (UTC-4), so the last
  // second of that day is 03:59:59 UTC on the 17th.
  const LAST_SECOND = "2026-03-17T03:59:59.000Z";
  const FIRST_OVERDUE_SECOND = "2026-03-17T04:00:00.000Z";

  it("is still ISSUED at 23:59:59 on the due date, and nothing is saved", async () => {
    const { invoice } = await issuedInvoice(w);
    expect(invoice.dueDate).toBe("2026-03-16");
    await moveClockTo(w, LAST_SECOND);

    const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
    const page = await list();

    expect(read.status).toBe(InvoiceStatus.ISSUED);
    expect(read.daysOverdue).toBe(0);
    expect(page.data[0]?.status).toBe(InvoiceStatus.ISSUED);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      "ISSUED",
    );
    expect(await prisma.activityEvent.count({ where: { action: "invoice.overdue" } })).toBe(0);
  });

  it("becomes OVERDUE one second later, saved once, with its history", async () => {
    const { invoice, job } = await issuedInvoice(w);
    await moveClockTo(w, FIRST_OVERDUE_SECOND);

    const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));

    expect(read.status).toBe(InvoiceStatus.OVERDUE);
    expect(read.statusLabel).toBe("Overdue");
    expect(read.daysOverdue).toBe(1);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.status).toBe("OVERDUE");
    const events = await prisma.activityEvent.findMany({ where: { action: "invoice.overdue" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityId: invoice.id,
      actorUserId: null,
      fromStatus: "ISSUED",
      toStatus: "OVERDUE",
      customerId: job.customerId,
      summary: "The system marked invoice INV-2026-00001 as overdue because its due date passed.",
    });
  });

  it("is idempotent: reading again, or many at once, records one event", async () => {
    const { invoice } = await issuedInvoice(w);
    await moveClockTo(w, "2026-03-20T16:00:00.000Z");

    await Promise.all([
      getInvoiceRequest(w, invoice.id),
      getInvoiceRequest(w, invoice.id),
      w.client.get(ADMIN_INVOICES, { cookie: w.adminCookie }),
      w.client.get(ADMIN_INVOICES, { cookie: w.adminCookie }),
    ]);
    await getInvoiceRequest(w, invoice.id);

    expect(await prisma.activityEvent.count({ where: { action: "invoice.overdue" } })).toBe(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
      "OVERDUE",
    );
    expect(dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id)).daysOverdue).toBe(4);
  });

  it("counts days on the business calendar", async () => {
    const { invoice } = await issuedInvoice(w);
    const daysAt = async (time: string) => {
      await moveClockTo(w, time);
      return dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id)).daysOverdue;
    };
    expect(await daysAt("2026-03-20T03:59:59.000Z")).toBe(3); // still the 19th in New York
    expect(await daysAt("2026-03-20T04:00:00.000Z")).toBe(4);
  });

  it("marks a partly paid invoice overdue, keeping what was paid", async () => {
    const { invoice } = await issuedInvoice(w);
    await insertPayment(prisma, {
      invoiceId: invoice.id,
      recordedByUserId: w.admin.id,
      amount: "40.00",
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: "40.00", status: "PARTIALLY_PAID" },
    });
    await moveClockTo(w, FIRST_OVERDUE_SECOND);

    const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));

    expect(read.status).toBe(InvoiceStatus.OVERDUE);
    expect(read.amountPaid).toBe("40.00");
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "invoice.overdue" },
    });
    expect(event.fromStatus).toBe("PARTIALLY_PAID");
  });

  it("leaves drafts, paid and void invoices alone however late it is", async () => {
    const draft = await draftInvoice(w, "alex");
    const paid = await issuedInvoice(w, "priya");
    await insertPayment(prisma, {
      invoiceId: paid.invoice.id,
      recordedByUserId: w.admin.id,
      amount: paid.invoice.totalAmount,
    });
    await prisma.invoice.update({
      where: { id: paid.invoice.id },
      data: { amountPaid: paid.invoice.totalAmount, status: "PAID" },
    });
    const toVoid = await issuedInvoice(w, "alex");
    await voidInvoiceRequest(w, toVoid.invoice.id, {
      reason: "Raised in error for this test.",
      expectedStatus: "ISSUED",
    });
    await moveClockTo(w, "2027-01-01T12:00:00.000Z");

    const page = await list();

    const statusOf = (id: string) => page.data.find((item) => item.id === id)?.status;
    expect(statusOf(draft.invoice.id)).toBe("DRAFT");
    expect(statusOf(paid.invoice.id)).toBe("PAID");
    expect(statusOf(toVoid.invoice.id)).toBe("VOID");
    expect(await prisma.activityEvent.count({ where: { action: "invoice.overdue" } })).toBe(0);
  });

  it("follows the business's time zone: the same instant is not yet overdue in Los Angeles", async () => {
    const { invoice } = await issuedInvoice(w);
    await prisma.businessSettings.updateMany({ data: { timeZone: "America/Los_Angeles" } });
    // 04:00 UTC on the 17th is 21:00 on the 16th in Los Angeles (UTC-7): still the due date.
    await moveClockTo(w, FIRST_OVERDUE_SECOND);
    expect(dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id)).status).toBe("ISSUED");
    await moveClockTo(w, "2026-03-17T07:00:00.000Z");
    expect(dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id)).status).toBe("OVERDUE");
  });

  it("the job page's invoice link reads overdue too", async () => {
    const { invoice, job } = await issuedInvoice(w);
    await moveClockTo(w, FIRST_OVERDUE_SECOND);
    const detail = await w.client.get(`/api/v1/admin/work-orders/${job.id}`, {
      cookie: w.adminCookie,
    });
    expect(
      (detail.body as { data: { invoice: { status: string; id: string } } }).data.invoice,
    ).toMatchObject({
      id: invoice.id,
      status: "OVERDUE",
    });
  });
});

describe("GET /admin/invoices (FR-074)", () => {
  async function seed() {
    const alexOne = await issuedWith("alex", { issueDate: "2026-02-10", dueDate: "2026-02-24" });
    const priyaOne = await issuedWith("priya", { issueDate: "2026-02-20", dueDate: "2026-03-06" });
    const alexTwo = await issuedWith("alex", { issueDate: "2026-03-01", dueDate: "2026-03-30" });
    const draft = (await draftInvoice(w, "priya")).invoice;
    const voided = await issuedInvoice(w, "alex");
    await voidInvoiceRequest(w, voided.invoice.id, {
      reason: "Raised for the wrong visit.",
      expectedStatus: "ISSUED",
    });
    return { alexOne, priyaOne, alexTwo, draft, voided: voided.invoice };
  }

  it("lists newest first by default, with the balance and days overdue on each row", async () => {
    const rows = await seed();

    const page = await list();

    expect(page.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 5, totalPages: 1 });
    expect(page.data[0]?.id).toBe(rows.voided.id);
    expect(Object.keys(page.data[0] ?? {}).sort()).toEqual(
      [
        "balanceDue",
        "createdAt",
        "currencyCode",
        "customerId",
        "customerName",
        "daysOverdue",
        "dueDate",
        "id",
        "invoiceNumber",
        "issueDate",
        "jobReference",
        "status",
        "statusLabel",
        "totalAmount",
        "amountPaid",
        "workOrderId",
      ].sort(),
    );
    const first = page.data.find((item) => item.id === rows.alexOne.id);
    expect(first).toMatchObject({
      invoiceNumber: "INV-2026-00001",
      customerName: "Alex Morgan",
      issueDate: "2026-02-10",
      dueDate: "2026-02-24",
      amountPaid: "0.00",
    });
    expect(first?.balanceDue).toBe(first?.totalAmount);
  });

  it("reports how many invoices each status chip would show", async () => {
    await seed();
    const page = await list();
    expect(page.meta.counts).toEqual({
      all: 5,
      DRAFT: 1,
      ISSUED: 2,
      PARTIALLY_PAID: 0,
      PAID: 0,
      OVERDUE: 1,
      VOID: 1,
    });
  });

  it("counts by the other filters, not by the chosen status", async () => {
    const rows = await seed();
    const page = await list(`?status=VOID&customerId=${rows.alexOne.customerId}`);
    expect(page.data).toHaveLength(1);
    // Alex has one issued, one overdue and one void: the chips show Alex's whole picture.
    expect(page.meta.counts.ISSUED).toBe(1);
    expect(page.meta.counts.OVERDUE).toBe(1);
    expect(page.meta.counts.VOID).toBe(1);
    expect(page.meta.counts.all).toBe(3);
  });

  describe("filters", () => {
    it("by status, one or several", async () => {
      const rows = await seed();
      expect((await list("?status=DRAFT")).data.map((item) => item.id)).toEqual([rows.draft.id]);
      expect((await list("?status=VOID")).data.map((item) => item.id)).toEqual([rows.voided.id]);
      const both = await list("?status=DRAFT&status=VOID");
      expect(both.data.map((item) => item.id).sort()).toEqual(
        [rows.draft.id, rows.voided.id].sort(),
      );
      const commas = await list("?status=DRAFT,VOID");
      expect(commas.data).toHaveLength(2);
    });

    it("by the effective status, overdue included", async () => {
      const rows = await seed();
      await moveClockTo(w, "2026-03-10T16:00:00.000Z"); // alexOne (24 Feb) and priyaOne (6 Mar) are past due

      const overdue = await list("?status=OVERDUE");
      const issuedOnly = await list("?status=ISSUED");

      expect(overdue.data.map((item) => item.id).sort()).toEqual(
        [rows.alexOne.id, rows.priyaOne.id].sort(),
      );
      expect(overdue.data.every((item) => item.daysOverdue > 0)).toBe(true);
      expect(overdue.data.find((item) => item.id === rows.alexOne.id)?.daysOverdue).toBe(14);
      expect(issuedOnly.data.map((item) => item.id)).toEqual([rows.alexTwo.id]);
      expect(overdue.meta.counts.OVERDUE).toBe(2);
    });

    it("by customer", async () => {
      const rows = await seed();
      const alex = await list(`?customerId=${rows.alexOne.customerId}`);
      expect(alex.data).toHaveLength(3);
      expect(alex.data.every((item) => item.customerName === "Alex Morgan")).toBe(true);
      const nobody = await list(`?customerId=${MISSING_ID}`);
      expect(nobody.data).toEqual([]);
      expect(nobody.pagination.totalItems).toBe(0);
    });

    it("by due date, both ends inclusive", async () => {
      const rows = await seed();
      const ids = async (query: string) => (await list(query)).data.map((item) => item.id).sort();
      expect(await ids("?dueFrom=2026-02-24&dueTo=2026-03-06")).toEqual(
        [rows.alexOne.id, rows.priyaOne.id].sort(),
      );
      expect(await ids("?dueFrom=2026-02-25&dueTo=2026-03-05")).toEqual([]);
      expect(await ids("?dueFrom=2026-03-30")).toEqual(
        [rows.alexTwo.id, rows.draft.id, rows.voided.id].filter((id) => id === rows.alexTwo.id),
      );
      expect(await ids("?dueTo=2026-02-24")).toEqual([rows.alexOne.id]);
    });

    it("by issue date, both ends inclusive, and drafts (no issue date) are never in a range", async () => {
      const rows = await seed();
      const ids = async (query: string) => (await list(query)).data.map((item) => item.id).sort();
      expect(await ids("?issuedFrom=2026-02-20&issuedTo=2026-03-01")).toEqual(
        [rows.priyaOne.id, rows.alexTwo.id].sort(),
      );
      expect(await ids("?issuedFrom=2000-01-01")).not.toContain(rows.draft.id);
    });

    it("by search: invoice number, customer name or job reference, case-insensitively", async () => {
      const rows = await seed();
      expect((await list("?q=INV-2026-00002")).data.map((item) => item.id)).toEqual([
        rows.priyaOne.id,
      ]);
      expect((await list("?q=inv-2026-00002")).data).toHaveLength(1);
      expect(await list("?q=priya").then((page) => page.data)).toHaveLength(2); // priyaOne and the draft
      expect((await list("?q=ALEX%20MORGAN")).data).toHaveLength(3);
      const byJob = await list(`?q=${encodeURIComponent(rows.alexTwo.job.reference)}`);
      expect(byJob.data.map((item) => item.id)).toEqual([rows.alexTwo.id]);
      expect((await list("?q=zzz-nothing")).data).toEqual([]);
    });

    it("treats % and _ in a search as plain characters, not wildcards", async () => {
      await seed();
      expect((await list("?q=%25")).data).toEqual([]);
      expect((await list("?q=INV-2026-0000_")).data).toEqual([]);
    });

    it("combines filters", async () => {
      const rows = await seed();
      const page = await list(
        `?status=ISSUED&customerId=${rows.alexOne.customerId}&dueFrom=2026-03-01`,
      );
      expect(page.data.map((item) => item.id)).toEqual([rows.alexTwo.id]);
    });
  });

  describe("sort and pages", () => {
    it("sorts by due date, with a draft that has none last in either direction", async () => {
      const rows = await seed();
      await prisma.invoice.update({ where: { id: rows.draft.id }, data: { dueDate: null } });
      const asc = await list("?sort=dueDate&order=asc");
      const desc = await list("?sort=dueDate&order=desc");
      expect(asc.data[0]?.id).toBe(rows.alexOne.id);
      expect(asc.data.at(-1)?.id).toBe(rows.draft.id);
      expect(desc.data.at(-1)?.id).toBe(rows.draft.id);
      expect(desc.data[0]?.dueDate).toBe("2026-03-30");
    });

    it("sorts by issue date and by total", async () => {
      const rows = await seed();
      expect((await list("?sort=issueDate&order=asc")).data[0]?.id).toBe(rows.alexOne.id);
      await prisma.invoice.update({
        where: { id: rows.priyaOne.id },
        data: {
          totalAmount: "999.00",
          subtotal: "999.00",
          taxableBase: "999.00",
          taxAmount: "0.00",
          discountAmount: "0.00",
        },
      });
      expect((await list("?sort=totalAmount&order=desc")).data[0]?.id).toBe(rows.priyaOne.id);
    });

    it("sorts by status", async () => {
      await seed();
      const statuses = (await list("?sort=status&order=asc")).data.map((item) => item.status);
      expect(statuses).toEqual(["DRAFT", "ISSUED", "ISSUED", "OVERDUE", "VOID"]);
    });

    it("pages with a stable order and the right totals", async () => {
      await seed();
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const result = await list(`?pageSize=2&page=${page}&sort=dueDate&order=asc`);
        expect(result.pagination).toEqual({ page, pageSize: 2, totalItems: 5, totalPages: 3 });
        seen.push(...result.data.map((item) => item.id));
      }
      expect(new Set(seen).size).toBe(5);
      expect((await list("?pageSize=2&page=4")).data).toEqual([]);
    });

    it("keeps page boundaries stable when many rows tie", async () => {
      await seed();
      const ids = async (page: number) =>
        (await list(`?pageSize=2&page=${page}&sort=status&order=asc`)).data.map((item) => item.id);
      const all = [...(await ids(1)), ...(await ids(2)), ...(await ids(3))];
      expect(new Set(all).size).toBe(5);
    });
  });

  describe("bad queries are 422", () => {
    it.each([
      ["an unknown status", "?status=SHIPPED"],
      ["an unknown sort field", "?sort=customerId"],
      ["a bad order", "?order=sideways"],
      ["a page size over 100", "?pageSize=101"],
      ["a page of zero", "?page=0"],
      ["a malformed customer id", "?customerId=alex"],
      ["a malformed date", "?dueFrom=12/03/2026"],
      ["an impossible date", "?dueTo=2026-02-30"],
      ["an end before the start", "?dueFrom=2026-03-10&dueTo=2026-03-01"],
      ["an issue range backwards", "?issuedFrom=2026-03-10&issuedTo=2026-03-01"],
      ["a search over 100 characters", `?q=${"x".repeat(101)}`],
    ])("%s", async (_name, query) => {
      expectApiError(await w.client.get(`${ADMIN_INVOICES}${query}`, { cookie: w.adminCookie }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  it("is 401 without a session and 403 for a customer", async () => {
    await seed();
    expectApiError(await w.client.get(ADMIN_INVOICES), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    for (const cookie of [w.alexCookie, w.priyaCookie]) {
      expectApiError(await w.client.get(ADMIN_INVOICES, { cookie }), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }
  });

  it("is empty for a business with no invoices, with zero counts", async () => {
    const page = await list();
    expect(page.data).toEqual([]);
    expect(page.pagination.totalItems).toBe(0);
    expect(page.meta.counts.all).toBe(0);
  });

  it("a job's draft appears at once and a startInvoice for another job is independent", async () => {
    const { job } = await completedJob(w);
    const invoice = await startInvoice(w, job.id);
    const page = await list();
    expect(page.data.map((item) => item.id)).toEqual([invoice.id]);
    expect(page.data[0]?.invoiceNumber).toBeNull();
    expect(page.data[0]?.issueDate).toBeNull();
  });
});
