import { randomUUID } from "node:crypto";

import {
  addDaysToDateOnly,
  type AdminDashboardSummaryDto,
  type CustomerOverviewDto,
  dateOnlyInTimeZone,
  ErrorCode,
  InvoiceStatus,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DemoPasswords } from "../config/env.js";
import { FakeClock } from "../lib/clock.js";
import type { PrismaClient } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { RoutingEmailSender } from "../modules/email/email-sender.js";
import { LogEmailSender } from "../modules/email/log-email-sender.js";
import { signInAs } from "../test/auth-helpers.js";
import { buildTestApp } from "../test/build-test-app.js";
import { databaseName, disconnectTestPrisma, getTestPrisma } from "../test/db.js";
import { RecordingEmailSender } from "../test/fakes.js";
import { api, bodyOf, expectApiError } from "../test/http.js";
import { DemoResetGuardError, resetDemoDatabase, truncateAllTables } from "./reset-demo.js";
import { seedShowcase, ShowcaseError } from "./showcase/showcase.js";
import { createCalendar } from "./showcase/showcase-time.js";
import { formatDemoReport, SHOWCASE_VOLUMES, verifyDemo } from "./verify-demo.js";

/**
 * The showcase seed against a real database (T24): the §19.3 volumes, every check of the invariant
 * checker, dates counted from the run time, the same structure on every run, the meaningful dashboard
 * and portal, and the path the demo script needs. The seed is built by the application's own services,
 * so the checker is the proof that the data is consistent, not a way to make it so.
 */

const prisma = getTestPrisma();
const DATABASE = databaseName("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL ?? "");
/** Passwords for these tests only; the real seed reads them from the environment. */
const PASSWORDS: DemoPasswords = {
  admin: "Showcase admin pass 2026!",
  customer: "Showcase customer pass 2026!",
};
const ZONE = "America/New_York";

/** Wednesday 18 March 2026, 11:00 in New York: the clocks changed on 8 March, inside the six weeks. */
const MID_MARCH = new Date("2026-03-18T15:00:00.000Z");
/** Saturday 14 November 2026, 03:00 in New York: very early, and the clocks changed on 1 November. */
const EARLY_SATURDAY = new Date("2026-11-14T08:00:00.000Z");

afterAll(async () => {
  await disconnectTestPrisma();
});

const reset = (now: Date) =>
  resetDemoDatabase(prisma, { expectedDatabase: DATABASE, passwords: PASSWORDS, now });

/** Counts of each status of one entity. */
function tally(statuses: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

/** What must be the same on every run: references, statuses, who and what, and the money. */
async function structure(db: PrismaClient) {
  const [requests, quotations, jobs, invoices, payments] = await Promise.all([
    db.serviceRequest.findMany({
      select: {
        reference: true,
        status: true,
        customer: { select: { user: { select: { email: true } } } },
        serviceNameSnapshot: true,
      },
      orderBy: { reference: "asc" },
    }),
    db.quotation.findMany({
      select: {
        reference: true,
        status: true,
        totalAmount: true,
        request: { select: { reference: true } },
      },
      orderBy: { reference: "asc" },
    }),
    db.workOrder.findMany({
      select: {
        reference: true,
        status: true,
        request: { select: { reference: true } },
        technician: { select: { name: true } },
      },
      orderBy: { reference: "asc" },
    }),
    db.invoice.findMany({
      select: {
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        amountPaid: true,
        workOrder: { select: { reference: true } },
      },
      orderBy: [{ workOrder: { reference: "asc" } }, { createdAt: "asc" }],
    }),
    db.paymentRecord.findMany({
      select: { amount: true, method: true, invoice: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    requests: requests.map(
      (row) =>
        `${row.reference} ${row.status} ${row.customer.user.email} ${row.serviceNameSnapshot}`,
    ),
    quotations: quotations.map(
      (row) =>
        `${row.reference} ${row.status} ${row.totalAmount.toFixed(2)} ${row.request.reference}`,
    ),
    jobs: jobs.map(
      (row) =>
        `${row.reference} ${row.status} ${row.request.reference} ${row.technician?.name ?? "-"}`,
    ),
    invoices: invoices.map(
      (row) =>
        `${row.invoiceNumber ?? "draft"} ${row.status} ${row.totalAmount.toFixed(2)} ${row.amountPaid.toFixed(2)} ${row.workOrder.reference}`,
    ),
    payments: payments.map(
      (row) => `${row.invoice.invoiceNumber ?? "?"} ${row.method} ${row.amount.toFixed(2)}`,
    ),
  };
}

describe("the showcase, built on a Saturday before dawn", () => {
  let clock: FakeClock;

  beforeAll(async () => {
    const result = await reset(EARLY_SATURDAY);
    expect(formatDemoReport(result.report)).toContain("checks passed");
    clock = new FakeClock(new Date(EARLY_SATURDAY.getTime() + 60_000));
  }, 120_000);

  it("produces the volumes of spec §19.3, widened where that section contradicts itself (D-112)", async () => {
    const counts = {
      customers: await prisma.customerProfile.count(),
      technicians: await prisma.technician.count(),
      requests: await prisma.serviceRequest.count(),
      quotations: await prisma.quotation.count(),
      workOrders: await prisma.workOrder.count(),
      invoices: await prisma.invoice.count(),
      payments: await prisma.paymentRecord.count(),
    };

    expect(counts).toEqual({
      customers: 8,
      technicians: 4,
      requests: 20,
      quotations: 19,
      workOrders: 13,
      invoices: 6,
      payments: 3,
    });
    for (const [name, count] of Object.entries(counts)) {
      const range = SHOWCASE_VOLUMES[name as keyof typeof SHOWCASE_VOLUMES];
      expect(count, name).toBeGreaterThanOrEqual(range.min);
      expect(count, name).toBeLessThanOrEqual(range.max);
    }
  });

  it("gives every customer one to three addresses, and the demo accounts are among the eight customers", async () => {
    const customers = await prisma.customerProfile.findMany({
      select: { user: { select: { email: true } }, _count: { select: { addresses: true } } },
    });
    for (const customer of customers) {
      expect(customer._count.addresses).toBeGreaterThanOrEqual(1);
      expect(customer._count.addresses).toBeLessThanOrEqual(3);
    }
    const emails = customers.map((customer) => customer.user.email);
    expect(emails).toContain("alex.morgan@example.test");
    expect(emails).toContain("priya.shah@example.test");
    expect(emails.every((email) => email.endsWith(".test"))).toBe(true);
  });

  it("shows every status of every entity, in the numbers the stories give", async () => {
    expect(
      tally(
        (await prisma.serviceRequest.findMany({ select: { status: true } })).map((r) => r.status),
      ),
    ).toEqual({
      [ServiceRequestStatus.SUBMITTED]: 2,
      [ServiceRequestStatus.UNDER_REVIEW]: 1,
      [ServiceRequestStatus.QUOTED]: 1,
      [ServiceRequestStatus.ACCEPTED]: 1,
      [ServiceRequestStatus.DECLINED]: 1,
      [ServiceRequestStatus.CONVERTED_TO_JOB]: 13,
      [ServiceRequestStatus.CANCELLED]: 1,
    });
    expect(
      tally((await prisma.quotation.findMany({ select: { status: true } })).map((q) => q.status)),
    ).toEqual({
      [QuotationStatus.DRAFT]: 1,
      [QuotationStatus.SENT]: 1,
      [QuotationStatus.ACCEPTED]: 14,
      [QuotationStatus.DECLINED]: 1,
      [QuotationStatus.EXPIRED]: 1,
      [QuotationStatus.VOID]: 1,
    });
    expect(
      tally((await prisma.workOrder.findMany({ select: { status: true } })).map((w) => w.status)),
    ).toEqual({
      [WorkOrderStatus.PENDING_SCHEDULING]: 1,
      [WorkOrderStatus.SCHEDULED]: 3,
      [WorkOrderStatus.IN_PROGRESS]: 1,
      [WorkOrderStatus.COMPLETED]: 6,
      [WorkOrderStatus.CANCELLED]: 1,
      [WorkOrderStatus.NEEDS_RESCHEDULING]: 1,
    });
    expect(
      tally((await prisma.invoice.findMany({ select: { status: true } })).map((i) => i.status)),
    ).toEqual({
      [InvoiceStatus.DRAFT]: 1,
      [InvoiceStatus.ISSUED]: 1,
      [InvoiceStatus.PARTIALLY_PAID]: 1,
      [InvoiceStatus.PAID]: 1,
      [InvoiceStatus.OVERDUE]: 1,
      [InvoiceStatus.VOID]: 1,
    });
  });

  it("passes every check of the invariant checker", async () => {
    const report = await verifyDemo(prisma, EARLY_SATURDAY);

    expect(report.ok, formatDemoReport(report)).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(18);
  });

  it("has a paid invoice whose payments add up to its total, and a void one with its reason", async () => {
    const paid = await prisma.invoice.findFirstOrThrow({
      where: { status: InvoiceStatus.PAID },
      include: { payments: true },
    });
    expect(paid.payments.length).toBeGreaterThan(1);
    const sum = paid.payments.reduce(
      (total, payment) => total.plus(payment.amount),
      paid.totalAmount.minus(paid.totalAmount),
    );
    expect(sum.toFixed(2)).toBe(paid.totalAmount.toFixed(2));
    expect(paid.amountPaid.toFixed(2)).toBe(paid.totalAmount.toFixed(2));

    const voided = await prisma.invoice.findFirstOrThrow({ where: { status: InvoiceStatus.VOID } });
    expect((voided.voidReason ?? "").length).toBeGreaterThan(10);
    const declined = await prisma.quotation.findFirstOrThrow({
      where: { status: QuotationStatus.DECLINED },
    });
    expect((declined.declineReason ?? "").length).toBeGreaterThan(10);
  });

  it("counts every date from the run time, in the business's time zone", async () => {
    const calendar = createCalendar(EARLY_SATURDAY, ZONE);
    const first = await prisma.serviceRequest.findFirstOrThrow({ orderBy: { reference: "asc" } });

    // The oldest story starts 44 days before the run, at 09:12 New York time.
    expect(first.submittedAt.toISOString()).toBe(calendar.instant([-44, "09:12"]).toISOString());

    // Nothing is in the future; the newest requests are of today.
    const [latest] = await prisma.serviceRequest.findMany({
      orderBy: { submittedAt: "desc" },
      take: 1,
    });
    expect(latest?.submittedAt.getTime()).toBeLessThanOrEqual(EARLY_SATURDAY.getTime());
    expect(dateOnlyInTimeZone(latest?.submittedAt ?? EARLY_SATURDAY, ZONE)).toBe(calendar.today);
    expect(await prisma.activityEvent.count({ where: { createdAt: { gt: EARLY_SATURDAY } } })).toBe(
      0,
    );
    expect(await prisma.notification.count({ where: { createdAt: { gt: EARLY_SATURDAY } } })).toBe(
      0,
    );

    // The invoices are due and overdue relative to today.
    const overdue = await prisma.invoice.findFirstOrThrow({
      where: { status: InvoiceStatus.OVERDUE },
    });
    expect(overdue.dueDate?.toISOString().slice(0, 10)).toBe(calendar.dateOf(-33 + 14));
    const issued = await prisma.invoice.findFirstOrThrow({
      where: { status: InvoiceStatus.ISSUED },
    });
    expect(issued.dueDate?.toISOString().slice(0, 10)).toBe(calendar.dateOf(-5 + 14));
  });

  it("has one visit in progress today, and visits booked for the coming working days with different technicians, including a back-to-back pair", async () => {
    const calendar = createCalendar(EARLY_SATURDAY, ZONE);
    const jobs = await prisma.workOrder.findMany({
      where: { status: { in: [WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS] } },
      include: { technician: true },
      orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }],
    });
    expect(jobs).toHaveLength(4);

    const [inProgress, ...booked] = jobs;
    expect(inProgress?.status).toBe(WorkOrderStatus.IN_PROGRESS);
    expect(dateOnlyInTimeZone(inProgress?.scheduledStart ?? EARLY_SATURDAY, ZONE)).toBe(
      calendar.today,
    );
    expect(inProgress?.technician?.name).toBe("Jordan Lee");

    // The rest are on the next days that are not Sundays: Monday, Monday and Tuesday from this Saturday.
    expect(booked.every((job) => job.status === WorkOrderStatus.SCHEDULED)).toBe(true);
    expect(
      booked.map((job) => dateOnlyInTimeZone(job.scheduledStart ?? EARLY_SATURDAY, ZONE)),
    ).toEqual([calendar.dateOf(2), calendar.dateOf(2), calendar.dateOf(3)]);
    expect(booked.map((job) => job.technician?.name)).toEqual([
      "Casey Nguyen",
      "Casey Nguyen",
      "Jordan Lee",
    ]);
    // The back-to-back pair: the second visit begins the moment the first ends.
    expect(booked[0]?.scheduledEnd?.toISOString()).toBe(booked[1]?.scheduledStart?.toISOString());
  });

  it("leaves some notifications read and some unread for the demo admin and for Alex", async () => {
    for (const email of ["admin@demo.fixflow.test", "alex.morgan@example.test"]) {
      const [read, unread] = await Promise.all([
        prisma.notification.count({ where: { recipient: { email }, readAt: { not: null } } }),
        prisma.notification.count({ where: { recipient: { email }, readAt: null } }),
      ]);
      expect(read, email).toBeGreaterThan(0);
      expect(unread, email).toBeGreaterThan(0);
    }
  });

  it("tells a plausible story for each request: a history that starts with its submission", async () => {
    const requests = await prisma.serviceRequest.findMany({
      select: { id: true, reference: true, status: true },
    });
    for (const request of requests) {
      const events = await prisma.activityEvent.findMany({
        where: { requestId: request.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(events[0]?.action, request.reference).toBe("request.submitted");
      expect(events.length, request.reference).toBeGreaterThanOrEqual(1);
    }
    // A converted request has the longest story: submission to payment.
    const paid = await prisma.invoice.findFirstOrThrow({
      where: { status: InvoiceStatus.PAID },
      select: { workOrder: { select: { requestId: true } } },
    });
    const actions = (
      await prisma.activityEvent.findMany({
        where: { requestId: paid.workOrder.requestId },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      })
    ).map((event) => event.action);
    for (const step of [
      "request.submitted",
      "request.review_started",
      "quotation.sent",
      "quotation.accepted",
      "work_order.created",
      "work_order.scheduled",
      "work_order.started",
      "work_order.completed",
      "invoice.issued",
      "payment.recorded",
    ]) {
      expect(actions, step).toContain(step);
    }
  });

  it("only ever logs email: every delivery is LOGGED, and none went to a real address", async () => {
    const statuses = await prisma.emailDeliveryLog.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe("LOGGED");
    expect(statuses[0]?._count._all).toBeGreaterThan(50);
  });

  describe("on the running application", () => {
    const setup = async () => {
      const test = buildTestApp({ prisma, clock, env: { DEMO_MODE: "true" } });
      return {
        ...test,
        admin: await signInAs(test.app, "admin@demo.fixflow.test", PASSWORDS.admin),
        alex: await signInAs(test.app, "alex.morgan@example.test", PASSWORDS.customer),
      };
    };

    it("shows the demo admin a dashboard with meaningful, non-zero figures and a queue of work", async () => {
      const { app, admin } = await setup();

      const response = await api(app).get("/api/v1/admin/dashboard/summary?range=7d", {
        cookie: admin,
      });

      expect(response.status).toBe(200);
      const { data } = bodyOf<{ data: AdminDashboardSummaryDto }>(response);
      expect(data.isFresh).toBe(false);
      expect(data.kpis.newRequests.value).toBeGreaterThan(5);
      expect(data.kpis.requestsNeedingAction.value).toBe(5);
      expect(data.kpis.jobs.value).toBe(1);
      expect(data.kpis.jobs.upcomingCount).toBe(3);
      expect(data.kpis.awaitingInvoice.value).toBe(1);
      expect(data.kpis.unpaidBalance.invoiceCount).toBe(3);
      expect(data.kpis.unpaidBalance.overdueCount).toBe(1);
      expect(Number(data.kpis.unpaidBalance.value)).toBeGreaterThan(300);
      expect(Number(data.kpis.unpaidBalance.overdueAmount)).toBeGreaterThan(100);

      // Worked out from the stories: the overdue invoice, the two new requests, the accepted quotation,
      // the two jobs that need a time (one waiting to be scheduled, one that must be rebooked), and the
      // completed job whose invoice was voided.
      const { counts, items, totalItems } = data.needsAttention;
      expect(counts).toMatchObject({
        OVERDUE_INVOICE: 1,
        NEW_REQUEST: 2,
        ACCEPTED_QUOTATION: 1,
        JOB_NEEDS_SCHEDULING: 2,
        JOB_AWAITING_INVOICE: 1,
      });
      expect(totalItems).toBe(7);
      expect(items).toHaveLength(7);
      expect(data.upcomingSchedule.length).toBeGreaterThanOrEqual(4);
      expect(data.recentActivity.length).toBeGreaterThanOrEqual(8);
    });

    it("shows Alex a quotation waiting for an answer and an invoice to pay", async () => {
      const { app, alex } = await setup();

      const response = await api(app).get("/api/v1/customers/me/overview", { cookie: alex });

      expect(response.status).toBe(200);
      const { data } = bodyOf<{ data: CustomerOverviewDto }>(response);
      expect(data.actionRequired.quotations.totalItems).toBe(1);
      expect(data.actionRequired.invoices.totalItems).toBe(1);
      expect(data.counts.actionRequired).toBe(2);
      // …and a visit booked for the coming days, with Jordan Lee.
      expect(data.upcomingVisits.totalItems).toBe(1);
      expect(data.counts.upcomingVisits).toBe(1);
      expect(data.recentRequests.totalItems).toBe(3);
      const quotation = data.actionRequired.quotations.items[0];
      expect(quotation?.status).toBe(QuotationStatus.SENT);
    });

    it("lets Alex send a fresh AC repair request (the first step of the demo script)", async () => {
      const { app, alex } = await setup();
      const service = await prisma.service.findFirstOrThrow({
        where: { slug: "ac-diagnostic-visit" },
      });
      const addresses = await api(app).get("/api/v1/customers/me/addresses", { cookie: alex });
      const home = bodyOf<{ data: { id: string; label: string }[] }>(addresses).data.find(
        (address) => address.label === "Home",
      );
      expect(home).toBeDefined();

      const response = await api(app)
        .post("/api/v1/requests", { cookie: alex })
        .send({
          serviceId: service.id,
          serviceAddressId: home?.id,
          description:
            "The downstairs AC is leaking water onto the carpet and the fan is very noisy.",
          preferredDate: addDaysToDateOnly(dateOnlyInTimeZone(clock.now(), ZONE), 2),
          preferredWindow: "MORNING",
          submissionKey: randomUUID(),
        });

      expect(response.status).toBe(201);
      expect(bodyOf<{ data: { status: string } }>(response).data.status).toBe(
        ServiceRequestStatus.SUBMITTED,
      );
    });

    it("leaves Jordan Lee free later this week: a pending job can be booked with him", async () => {
      const { app, admin } = await setup();
      const jordan = await prisma.technician.findFirstOrThrow({ where: { name: "Jordan Lee" } });
      const pending = await prisma.workOrder.findFirstOrThrow({
        where: { status: WorkOrderStatus.PENDING_SCHEDULING },
      });
      const calendar = createCalendar(clock.now(), ZONE);
      const day = calendar.workday(3);

      const response = await api(app)
        .patch(`/api/v1/admin/work-orders/${pending.id}/schedule`, { cookie: admin })
        .send({
          scheduledStart: calendar.instant([day, "10:00"]).toISOString(),
          scheduledEnd: calendar.instant([day, "12:00"]).toISOString(),
          technicianId: jordan.id,
          expectedStatus: WorkOrderStatus.PENDING_SCHEDULING,
        });

      expect(response.status).toBe(200);
      expect(bodyOf<{ data: { status: string } }>(response).data.status).toBe(
        WorkOrderStatus.SCHEDULED,
      );
    });

    it("logs, and never sends, the email an action sends to a seeded .test account (D-52)", async () => {
      const smtp = new RecordingEmailSender();
      const log = new LogEmailSender({
        logger: createLogger({ level: "silent", pretty: false }),
        clock,
        outboxDir: undefined,
      });
      const test = buildTestApp({
        prisma,
        clock,
        env: { DEMO_MODE: "true" },
        // Real SMTP is configured here: anything that is not a reserved address would go to `smtp`.
        emailSender: new RoutingEmailSender(log, smtp),
      });
      const admin = await signInAs(test.app, "admin@demo.fixflow.test", PASSWORDS.admin);
      const waiting = await prisma.quotation.findFirstOrThrow({
        where: { status: QuotationStatus.SENT },
        include: { customer: { select: { user: { select: { email: true } } } } },
      });
      expect(waiting.customer.user.email).toBe("alex.morgan@example.test");
      const before = await prisma.emailDeliveryLog.count();

      const response = await api(test.app)
        .post(`/api/v1/admin/quotations/${waiting.id}/void`, { cookie: admin })
        .send({ reason: "Withdrawn to correct the price.", expectedStatus: QuotationStatus.SENT });
      await test.deps.emailDispatcher.idle();

      expect(response.status).toBe(200);
      expect(smtp.sent).toHaveLength(0);
      const logs = await prisma.emailDeliveryLog.findMany({
        orderBy: { createdAt: "desc" },
        take: (await prisma.emailDeliveryLog.count()) - before,
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((entry) => entry.status === "LOGGED" && entry.transport === "log")).toBe(
        true,
      );
    });
  });
});

describe("running the reset again", () => {
  it("gives the same structure each time, with the dates counted from the new run", async () => {
    await reset(MID_MARCH);
    const first = await structure(prisma);
    const firstSubmitted = (
      await prisma.serviceRequest.findFirstOrThrow({ orderBy: { reference: "asc" } })
    ).submittedAt;

    await reset(EARLY_SATURDAY);
    const second = await structure(prisma);
    const secondSubmitted = (
      await prisma.serviceRequest.findFirstOrThrow({ orderBy: { reference: "asc" } })
    ).submittedAt;

    expect(second).toEqual(first);
    expect(firstSubmitted.toISOString()).toBe(
      createCalendar(MID_MARCH, ZONE).instant([-44, "09:12"]).toISOString(),
    );
    expect(secondSubmitted.toISOString()).toBe(
      createCalendar(EARLY_SATURDAY, ZONE).instant([-44, "09:12"]).toISOString(),
    );
    expect(secondSubmitted.getTime()).not.toBe(firstSubmitted.getTime());
  }, 180_000);

  it("starts from nothing: a visitor's account from before the reset is gone", async () => {
    await prisma.user.create({
      data: {
        email: "visitor@example.test",
        name: "Visitor",
        role: "CUSTOMER",
        passwordHash: "x".repeat(20),
      },
    });

    await reset(EARLY_SATURDAY);

    expect(await prisma.user.count({ where: { email: "visitor@example.test" } })).toBe(0);
    expect(await prisma.serviceRequest.count()).toBe(20);
  }, 120_000);
});

describe("the showcase on other days and at other hours", () => {
  it.each([
    ["in the evening, with the clocks having changed 10 days before", "2026-03-18T23:30:00.000Z"],
    ["late on a Sunday night", "2026-11-16T04:30:00.000Z"],
    [
      "just after midnight on New Year's Day, when the oldest stories are in the year before",
      "2026-01-01T05:30:00.000Z",
    ],
    ["on a Friday afternoon", "2026-06-12T19:00:00.000Z"],
  ])(
    "passes every check %s",
    async (_label, iso) => {
      const now = new Date(iso);

      const { report } = await reset(now);

      expect(report.ok, formatDemoReport(report)).toBe(true);
      // Whatever the day, the demo script has its visit today and its visits to come.
      expect(await prisma.workOrder.count({ where: { status: WorkOrderStatus.IN_PROGRESS } })).toBe(
        1,
      );
      expect(await prisma.workOrder.count({ where: { status: WorkOrderStatus.SCHEDULED } })).toBe(
        3,
      );
    },
    120_000,
  );
});

describe("the reset and the seed refuse to do harm", () => {
  it("empties nothing when the connection is not on the database that was confirmed", async () => {
    await reset(EARLY_SATURDAY);
    const before = await prisma.serviceRequest.count();

    await expect(truncateAllTables(prisma, "some_other_database")).rejects.toBeInstanceOf(
      DemoResetGuardError,
    );

    expect(await prisma.serviceRequest.count()).toBe(before);
    expect(before).toBe(20);
  }, 120_000);

  it("refuses to add the showcase to a business that already has requests", async () => {
    await reset(EARLY_SATURDAY);

    await expect(seedShowcase(prisma, { now: EARLY_SATURDAY })).rejects.toBeInstanceOf(
      ShowcaseError,
    );
    await expect(seedShowcase(prisma, { now: EARLY_SATURDAY })).rejects.toThrow(/db:reset-demo/);
    expect(await prisma.serviceRequest.count()).toBe(20);
  }, 120_000);

  it("rejects an unauthenticated and a customer reading of the admin dashboard, as before", async () => {
    await reset(EARLY_SATURDAY);
    const test = buildTestApp({ prisma, env: { DEMO_MODE: "true" } });
    const alex = await signInAs(test.app, "alex.morgan@example.test", PASSWORDS.customer);

    expectApiError(await api(test.app).get("/api/v1/admin/dashboard/summary"), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await api(test.app).get("/api/v1/admin/dashboard/summary", { cookie: alex }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  }, 120_000);
});
