import {
  type AdminDashboardSummaryDto,
  type AttentionItemDto,
  type AttentionItemType,
  ErrorCode,
  InvoiceStatus,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DASHBOARD_NOW,
  DASHBOARD_TODAY,
  type DashboardWorld,
  dashboardWorld,
} from "../../test/dashboard-world.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createQuotation } from "../../test/fixtures.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import { invoiceWorld } from "../../test/invoice-world.js";
import { dataOf, makeRequest } from "../../test/quotation-world.js";
import { at, insertJob } from "../../test/work-order-world.js";

const prisma = getTestPrisma();
const SUMMARY = "/api/v1/admin/dashboard/summary";

let w: DashboardWorld;

beforeAll(async () => {
  await resetDatabase(prisma);
  w = await dashboardWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function summary(range?: string, cookie = w.adminCookie): Promise<AdminDashboardSummaryDto> {
  const response = await w.client.get(range === undefined ? SUMMARY : `${SUMMARY}?range=${range}`, {
    cookie,
  });
  expect(response.status).toBe(200);
  return dataOf<AdminDashboardSummaryDto>(response);
}

/** The API route behind a list link of the dashboard: `/app/jobs?...` is `/api/v1/admin/work-orders?...`. */
function apiPathOf(link: string): string {
  const [path = "", query = ""] = link.split("?");
  const api: Record<string, string> = {
    "/app/requests": "/api/v1/admin/requests",
    "/app/jobs": "/api/v1/admin/work-orders",
    "/app/invoices": "/api/v1/admin/invoices",
  };
  const target = api[path];
  if (target === undefined) {
    throw new Error(`No list behind ${path}.`);
  }
  return `${target}?${query}&pageSize=100`;
}

async function listBehind(link: string): Promise<{ ids: string[]; total: number }> {
  const response = await w.client.get(apiPathOf(link), { cookie: w.adminCookie });
  expect(response.status).toBe(200);
  const body = bodyOf<{ data: Array<{ id: string }>; pagination: { totalItems: number } }>(
    response,
  );
  return { ids: body.data.map((row) => row.id), total: body.pagination.totalItems };
}

describe("GET /admin/dashboard/summary: access (SEC-AUTH)", () => {
  it("is 401 without a session, 403 for a customer, and 422 for a range that does not exist", async () => {
    expectApiError(await w.client.get(SUMMARY), { status: 401, code: ErrorCode.UNAUTHENTICATED });
    expectApiError(await w.client.get(SUMMARY, { cookie: w.alexCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    const bad = await w.client.get(`${SUMMARY}?range=year`, { cookie: w.adminCookie });
    expect(bad.status).toBe(422);
  });
});

describe("the period and the clock (FR-080, D-42)", () => {
  it("defaults to 7 days and reports the days it covers on the business's calendar", async () => {
    const data = await summary();
    expect(data.period).toEqual({ range: "7d", from: "2026-02-27", to: "2026-03-05" });
    expect(data.today).toBe(DASHBOARD_TODAY);
    expect(data.timeZone).toBe("America/New_York");
    expect(data.currencyCode).toBe("USD");
    expect(data.generatedAt).toBe(DASHBOARD_NOW);
    expect(data.isFresh).toBe(false);
  });

  it.each([
    ["today", "2026-03-05", "2026-03-05", 2],
    ["7d", "2026-02-27", "2026-03-05", 7],
    ["30d", "2026-02-04", "2026-03-05", 10],
  ] as const)(
    "%s: new requests are counted on the local days %s to %s",
    async (range, from, to, count) => {
      const data = await summary(range);
      expect(data.period).toEqual({ range, from, to });
      expect(data.kpis.newRequests.value).toBe(count);
    },
  );

  it("counts a request sent at 23:30 local (04:30 UTC the next day) on the day it was sent", async () => {
    const edge = w.requests.lateEdge.id;
    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: edge } });
    expect(stored.submittedAt.toISOString()).toBe("2026-03-05T04:30:00.000Z");

    // Today is the 5th locally, and the request belongs to the 4th: not today's, but the week's.
    const todayList = await listBehind((await summary("today")).kpis.newRequests.link);
    expect(todayList.ids).not.toContain(edge);
    const weekList = await listBehind((await summary("7d")).kpis.newRequests.link);
    expect(weekList.ids).toContain(edge);
  });

  it("includes the first instant of a period and excludes the second before it", async () => {
    // 00:00 local on the 5th is in today; 23:59:59 on the 26th of February is not in the 7 days.
    const today = await listBehind((await summary("today")).kpis.newRequests.link);
    expect(today.ids).toContain(w.requests.midnight.id);
    const week = await listBehind((await summary("7d")).kpis.newRequests.link);
    expect(week.ids).toContain(w.requests.weekStart.id);
    expect(week.ids).not.toContain(w.requests.weekOut.id);
    const month = await listBehind((await summary("30d")).kpis.newRequests.link);
    expect(month.ids).toContain(w.requests.monthStart.id);
    expect(month.ids).not.toContain(w.requests.monthOut.id);
  });

  it("changes only the period-dependent figure with the range", async () => {
    const [today, week, month] = await Promise.all([
      summary("today"),
      summary("7d"),
      summary("30d"),
    ]);
    for (const other of [week, month]) {
      expect(other.kpis.requestsNeedingAction).toEqual(today.kpis.requestsNeedingAction);
      expect(other.kpis.jobs).toEqual(today.kpis.jobs);
      expect(other.kpis.awaitingInvoice).toEqual(today.kpis.awaitingInvoice);
      expect(other.kpis.unpaidBalance).toEqual(today.kpis.unpaidBalance);
      expect(other.needsAttention).toEqual(today.needsAttention);
      expect(other.upcomingSchedule).toEqual(today.upcomingSchedule);
    }
    expect(today.kpis.newRequests.scope).toBe("range");
    expect(today.kpis.requestsNeedingAction.scope).toBe("current");
  });
});

describe("the five KPIs (FR-080, FR-085)", () => {
  it("counts what needs action: submitted, under review, accepted and declined (3 + 1 + 1 + 1)", async () => {
    const { requestsNeedingAction } = (await summary()).kpis;
    expect(requestsNeedingAction.value).toBe(6);
  });

  it("counts the visits that start today (3) and in the days after (2), the clocks changing on the way", async () => {
    // Today: j1 09:00, j2 11:00 (in progress), j3 15:00. After: 6 March 09:00 and 12 March 22:30 (EDT).
    // Not counted: 13 March 00:00 local (the first minute past the window), 4 March, the job that needs
    // a new time (it still holds its old appointment as a reference), the cancelled and finished ones.
    const { jobs } = (await summary()).kpis;
    expect(jobs.value).toBe(3);
    expect(jobs.upcomingCount).toBe(2);
    expect(jobs.upcomingDays).toBe(7);
  });

  it("counts the completed jobs with no invoice besides a void one (2)", async () => {
    // The finished job that was never invoiced, and the one whose only invoice was voided. A job whose
    // invoice is a draft, issued or paid is not waiting for one.
    expect((await summary()).kpis.awaitingInvoice.value).toBe(2);
  });

  it("adds up the balance still owed: 300 + 150 + 100 + 80 + 60 = 690.00 over five invoices", async () => {
    // Issued 300.00; part-paid 200.00 less 50.00; overdue 120.00 less 20.00; overdue 80.00; the other
    // customer's 60.00. A paid, a voided and a draft invoice owe nothing.
    const { unpaidBalance } = (await summary()).kpis;
    expect(unpaidBalance.value).toBe("690.00");
    expect(unpaidBalance.currencyCode).toBe("USD");
    expect(unpaidBalance.invoiceCount).toBe(5);
    expect(unpaidBalance.overdueCount).toBe(2);
    expect(unpaidBalance.overdueAmount).toBe("180.00");
  });

  it("gives every KPI a definition and says which figure follows the range", async () => {
    const { kpis } = await summary();
    for (const kpi of [
      kpis.newRequests,
      kpis.requestsNeedingAction,
      kpis.jobs,
      kpis.awaitingInvoice,
      kpis.unpaidBalance,
    ]) {
      expect(kpi.definition.length).toBeGreaterThan(30);
    }
    expect(kpis.newRequests.scope).toBe("range");
    for (const kpi of [
      kpis.requestsNeedingAction,
      kpis.jobs,
      kpis.awaitingInvoice,
      kpis.unpaidBalance,
    ]) {
      expect(kpi.scope).toBe("current");
    }
  });
});

describe("every KPI links to a list that reproduces it (G.2)", () => {
  it.each(["today", "7d", "30d"] as const)("new requests, for %s", async (range) => {
    const { kpis } = await summary(range);
    expect((await listBehind(kpis.newRequests.link)).total).toBe(kpis.newRequests.value);
  });

  it("requests needing action", async () => {
    const { kpis } = await summary();
    const list = await listBehind(kpis.requestsNeedingAction.link);
    expect(list.total).toBe(kpis.requestsNeedingAction.value);
    for (const key of [
      "recent",
      "midnight",
      "lateEdge",
      "review",
      "accepted",
      "declined",
    ] as const) {
      expect(list.ids).toContain(w.requests[key].id);
    }
    expect(list.ids).not.toContain(w.requests.quoted.id);
  });

  it("jobs today and next 7 days: the list holds both", async () => {
    const { kpis } = await summary();
    const list = await listBehind(kpis.jobs.link);
    expect(list.total).toBe(kpis.jobs.value + kpis.jobs.upcomingCount);
    const expected = [w.jobs.j1, w.jobs.j2, w.jobs.j3, w.jobs.j4, w.jobs.j5].map((job) => job.id);
    expect([...list.ids].sort()).toEqual([...expected].sort());
  });

  it("completed, awaiting invoice", async () => {
    const { kpis } = await summary();
    const list = await listBehind(kpis.awaitingInvoice.link);
    expect(list.total).toBe(kpis.awaitingInvoice.value);
    expect(list.ids).toContain(w.jobs.j10.id);
    expect(list.ids).toContain(w.invoices.voided.job.id);
  });

  it("unpaid balance and its overdue part", async () => {
    const { kpis } = await summary();
    const unpaid = await listBehind(kpis.unpaidBalance.link);
    expect(unpaid.total).toBe(kpis.unpaidBalance.invoiceCount);
    const overdue = await listBehind(kpis.unpaidBalance.overdueLink);
    expect(overdue.total).toBe(kpis.unpaidBalance.overdueCount);
    expect(overdue.ids).toEqual(
      expect.arrayContaining([w.invoices.p3.invoice.id, w.invoices.p4.invoice.id]),
    );
  });
});

describe("the needs-attention queue (FR-081)", () => {
  const ids = (items: AttentionItemDto[]) => items.map((item) => item.id);

  it("lists every kind of item, most urgent first, oldest first inside a kind", async () => {
    const { needsAttention } = await summary();
    expect(ids(needsAttention.items)).toEqual([
      `OVERDUE_INVOICE:${w.invoices.p3.invoice.id}`, // due 27 Feb: 6 days
      `OVERDUE_INVOICE:${w.invoices.p4.invoice.id}`, // due 1 Mar: 4 days
      `JOB_TODAY_NOT_STARTED:${w.jobs.j1.id}`, // 09:00, already past
      `JOB_TODAY_NOT_STARTED:${w.jobs.j3.id}`, // 15:00
      `NEW_REQUEST:${w.requests.lateEdge.id}`,
      `NEW_REQUEST:${w.requests.midnight.id}`,
      `NEW_REQUEST:${w.requests.recent.id}`,
      `ACCEPTED_QUOTATION:${w.requests.accepted.id}`,
      `JOB_NEEDS_SCHEDULING:${w.jobs.j8.id}`, // two days
      `JOB_NEEDS_SCHEDULING:${w.jobs.j9.id}`, // one hour
      `JOB_AWAITING_INVOICE:${w.jobs.j10.id}`, // finished 1 March
      `JOB_AWAITING_INVOICE:${w.invoices.voided.job.id}`, // finished 2 March
      `QUOTATION_EXPIRING:${w.sentQuote.id}`, // valid to 6 March
      `QUOTATION_EXPIRING:${w.edgeQuote.id}`, // valid to 7 March
    ]);
    expect(needsAttention.totalItems).toBe(14);
    expect(needsAttention.counts).toEqual({
      OVERDUE_INVOICE: 2,
      JOB_TODAY_NOT_STARTED: 2,
      NEW_REQUEST: 3,
      ACCEPTED_QUOTATION: 1,
      JOB_NEEDS_SCHEDULING: 2,
      JOB_AWAITING_INVOICE: 2,
      QUOTATION_EXPIRING: 2,
    } satisfies Record<AttentionItemType, number>);
  });

  it("says how long things have waited, in words, from the server's clock", async () => {
    const { items } = (await summary()).needsAttention;
    const byId = new Map(items.map((item) => [item.id, item]));
    const context = (id: string) => byId.get(id)?.context;

    expect(context(`OVERDUE_INVOICE:${w.invoices.p3.invoice.id}`)).toBe("overdue by 6 days");
    expect(context(`OVERDUE_INVOICE:${w.invoices.p4.invoice.id}`)).toBe("overdue by 4 days");
    expect(context(`JOB_TODAY_NOT_STARTED:${w.jobs.j1.id}`)).toBe(
      "AC Repair · was due to start at 09:00 · Jordan Lee",
    );
    expect(context(`JOB_TODAY_NOT_STARTED:${w.jobs.j3.id}`)).toBe(
      "AC Repair · starts at 15:00 today · Jordan Lee",
    );
    expect(context(`NEW_REQUEST:${w.requests.recent.id}`)).toBe("AC Repair · submitted 2 h ago");
    expect(context(`NEW_REQUEST:${w.requests.lateEdge.id}`)).toBe("AC Repair · submitted 12 h ago");
    expect(context(`ACCEPTED_QUOTATION:${w.requests.accepted.id}`)).toBe(
      "AC Repair · quotation accepted 1 day ago",
    );
    expect(context(`JOB_NEEDS_SCHEDULING:${w.jobs.j8.id}`)).toBe(
      "AC Repair · needs a time · 2 days ago",
    );
    expect(context(`JOB_NEEDS_SCHEDULING:${w.jobs.j9.id}`)).toBe(
      "AC Repair · needs a new time · 1 h ago",
    );
    expect(context(`JOB_AWAITING_INVOICE:${w.jobs.j10.id}`)).toBe(
      "AC Repair · completed 4 days ago",
    );
    expect(context(`QUOTATION_EXPIRING:${w.sentQuote.id}`)).toBe("AC Repair · expires tomorrow");
    expect(context(`QUOTATION_EXPIRING:${w.edgeQuote.id}`)).toBe("AC Repair · expires in 2 days");
  });

  it("gives each item a title, an action label, and the balance for an overdue invoice", async () => {
    const { items } = (await summary()).needsAttention;
    const first = items[0];
    expect(first).toMatchObject({
      type: "OVERDUE_INVOICE",
      actionLabel: "Open invoice",
      amount: { amount: "100.00", currencyCode: "USD" },
    });
    expect(first?.title).toMatch(/^INV-\d{4}-\d{5} · Alex Morgan$/);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(5);
      expect(item.actionLabel.length).toBeGreaterThan(2);
    }
    expect(items.find((item) => item.type === "NEW_REQUEST")?.actionLabel).toBe("Review request");
    expect(items.find((item) => item.type === "JOB_NEEDS_SCHEDULING")?.actionLabel).toBe(
      "Schedule",
    );
  });

  it("links every item to a record that exists (G.2)", async () => {
    const { items } = (await summary()).needsAttention;
    const resource: Record<string, string> = {
      "/app/requests/": "/api/v1/admin/requests/",
      "/app/jobs/": "/api/v1/admin/work-orders/",
      "/app/invoices/": "/api/v1/admin/invoices/",
      "/app/quotations/": "/api/v1/admin/quotations/",
    };
    for (const item of items) {
      const [path = ""] = item.link.split("?");
      const prefix = Object.keys(resource).find((candidate) => path.startsWith(candidate));
      expect(prefix, item.link).toBeDefined();
      const record = path.slice(prefix?.length ?? 0);
      const response = await w.client.get(`${resource[prefix ?? ""]}${record}`, {
        cookie: w.adminCookie,
      });
      expect(response.status, item.link).toBe(200);
    }
  });

  it("every item is true: the request is really new, the job really has no time, and so on", async () => {
    const { items } = (await summary()).needsAttention;
    for (const item of items) {
      const record = item.id.split(":")[1] ?? "";
      if (item.type === "NEW_REQUEST") {
        const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: record } });
        expect(row.status).toBe(ServiceRequestStatus.SUBMITTED);
      }
      if (item.type === "ACCEPTED_QUOTATION") {
        const row = await prisma.serviceRequest.findUniqueOrThrow({
          where: { id: record },
          include: { workOrder: true },
        });
        expect([row.status, row.workOrder]).toEqual([ServiceRequestStatus.ACCEPTED, null]);
      }
      if (item.type === "OVERDUE_INVOICE") {
        const row = await prisma.invoice.findUniqueOrThrow({ where: { id: record } });
        expect(row.status).toBe(InvoiceStatus.OVERDUE);
      }
      if (item.type === "QUOTATION_EXPIRING") {
        const row = await prisma.quotation.findUniqueOrThrow({ where: { id: record } });
        expect(row.status).toBe(QuotationStatus.SENT);
      }
    }
  });

  it("holds at most 15 items and reports the true total", async () => {
    const before = await summary();
    expect(before.needsAttention.totalItems).toBe(14);
    for (let index = 0; index < 4; index += 1) {
      await makeRequest(w, {
        status: "SUBMITTED",
        submittedAt: new Date(`2026-03-04T1${index}:00:00.000Z`),
      });
    }
    const after = await summary();
    expect(after.needsAttention.items).toHaveLength(15);
    expect(after.needsAttention.totalItems).toBe(18);
    expect(after.needsAttention.counts.NEW_REQUEST).toBe(7);
    // One of every kind is kept, then the places left go to the most urgent: 7 kinds, then one more
    // overdue invoice, one more visit today and six more new requests (8 places) make 15.
    const kinds = after.needsAttention.items.map((item) => item.type);
    const count = (type: string) => kinds.filter((kind) => kind === type).length;
    expect(kinds[0]).toBe("OVERDUE_INVOICE");
    expect(kinds.at(-1)).toBe("QUOTATION_EXPIRING");
    expect([
      count("OVERDUE_INVOICE"),
      count("JOB_TODAY_NOT_STARTED"),
      count("NEW_REQUEST"),
      count("ACCEPTED_QUOTATION"),
      count("JOB_NEEDS_SCHEDULING"),
      count("JOB_AWAITING_INVOICE"),
      count("QUOTATION_EXPIRING"),
    ]).toEqual([2, 2, 7, 1, 1, 1, 1]);

    await prisma.serviceRequest.deleteMany({
      where: {
        submittedAt: {
          gte: new Date("2026-03-04T10:00:00.000Z"),
          lt: new Date("2026-03-04T14:00:00.000Z"),
        },
      },
    });
  });
});

describe("the upcoming schedule and the activity (FR-082, FR-083)", () => {
  it("lists the next visits in order: the one under way, then those still to come (j1 has finished)", async () => {
    const { upcomingSchedule } = await summary();
    expect(upcomingSchedule.map((job) => job.id)).toEqual([
      w.jobs.j2.id, // in progress until 13:00
      w.jobs.j3.id, // 15:00 today
      w.jobs.j4.id, // 6 March
      w.jobs.j5.id, // 12 March, 22:30 EDT
      w.jobs.j6.id, // 13 March, 00:00 EDT
    ]);
    expect(upcomingSchedule[0]).toMatchObject({
      reference: w.jobs.j2.reference,
      customerName: "Alex Morgan",
      serviceName: "AC Repair",
      technicianName: "Sam Ortiz",
      status: "IN_PROGRESS",
      scheduledStart: "2026-03-05T16:00:00.000Z",
      scheduledEnd: "2026-03-05T18:00:00.000Z",
      link: `/app/jobs/${w.jobs.j2.id}`,
    });
  });

  it("shows the latest ten events, newest first, with a link where the record has a page", async () => {
    const { recentActivity } = await summary();
    expect(recentActivity.length).toBeGreaterThan(0);
    expect(recentActivity.length).toBeLessThanOrEqual(10);
    const times = recentActivity.map((event) => event.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const invoiceEvent = recentActivity.find((event) => event.entityType === "INVOICE");
    expect(invoiceEvent?.link).toMatch(/^\/app\/invoices\/[0-9a-f-]{36}$/);
    for (const event of recentActivity) {
      expect(event.summary.length).toBeGreaterThan(3);
    }
  });
});

describe("time-based statuses are saved first (D-23)", () => {
  it("saves an overdue invoice before counting, so the list and the figure agree", async () => {
    const fresh = await prisma.invoice.findUniqueOrThrow({
      where: { id: w.invoices.p4.invoice.id },
    });
    expect(fresh.status).toBe(InvoiceStatus.OVERDUE);
  });

  it("saves an expired quotation and counts its request as needing action", async () => {
    const request = await makeRequest(w, {
      status: "QUOTED",
      submittedAt: new Date("2026-01-02T15:00:00.000Z"),
    });
    await createQuotation(prisma, {
      requestId: request.id,
      customerId: w.alex.profile.id,
      createdByUserId: w.admin.id,
      status: "SENT",
      sentAt: new Date("2026-02-20T15:00:00.000Z"),
      sentByUserId: w.admin.id,
      validUntil: new Date("2026-03-04"),
    });

    const data = await summary();
    // Under review again (D-23): one more request needs action, and the quotation is no longer "expiring".
    expect(data.kpis.requestsNeedingAction.value).toBe(7);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe(ServiceRequestStatus.UNDER_REVIEW);
    expect(data.needsAttention.counts.QUOTATION_EXPIRING).toBe(2);
  });
});

describe("money (D-100)", () => {
  it("adds up balances in the business's currency only", async () => {
    await prisma.invoice.update({
      where: { id: w.invoices.p1.invoice.id },
      data: { currencyCode: "EUR" },
    });
    const { unpaidBalance } = (await summary()).kpis;
    // 690.00 less the 300.00 invoice that is not in dollars.
    expect(unpaidBalance.value).toBe("390.00");
    expect(unpaidBalance.invoiceCount).toBe(4);
    await prisma.invoice.update({
      where: { id: w.invoices.p1.invoice.id },
      data: { currencyCode: "USD" },
    });
    expect((await summary()).kpis.unpaidBalance.value).toBe("690.00");
  });
});

describe("the response answers within the budget (NFR-01)", () => {
  it("answers well inside a second with this data (a generous bound for a busy test machine)", async () => {
    await summary();
    const started = performance.now();
    await summary("30d");
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("the schedule is capped at eight visits", () => {
  it("lists eight of the ten that are still to come, the soonest first", async () => {
    const before = (await summary()).upcomingSchedule.length;
    for (let index = 0; index < 5; index += 1) {
      await insertJob(w, {
        status: WorkOrderStatus.SCHEDULED,
        technicianId: w.jordan.id,
        start: at("2026-03-20", `1${index}:00`),
        end: at("2026-03-20", `1${index}:30`),
      });
    }
    const { upcomingSchedule } = await summary();
    expect(before).toBe(5);
    expect(upcomingSchedule).toHaveLength(8);
    const starts = upcomingSchedule.map((job) => job.scheduledStart);
    expect([...starts].sort()).toEqual(starts);
  });
});

describe("a business with nothing yet", () => {
  it("is fresh, with every figure zero and empty lists", async () => {
    await resetDatabase(prisma);
    const empty = await invoiceWorld(prisma);
    const response = await empty.client.get(SUMMARY, { cookie: empty.adminCookie });
    expect(response.status).toBe(200);
    const data = dataOf<AdminDashboardSummaryDto>(response);
    expect(data.isFresh).toBe(true);
    expect(data.kpis.newRequests.value).toBe(0);
    expect(data.kpis.requestsNeedingAction.value).toBe(0);
    expect(data.kpis.jobs).toMatchObject({ value: 0, upcomingCount: 0 });
    expect(data.kpis.awaitingInvoice.value).toBe(0);
    expect(data.kpis.unpaidBalance).toMatchObject({
      value: "0.00",
      overdueAmount: "0.00",
      overdueCount: 0,
      invoiceCount: 0,
    });
    expect(data.needsAttention).toMatchObject({ items: [], totalItems: 0 });
    expect(data.upcomingSchedule).toEqual([]);
  });
});
