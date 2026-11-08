import {
  type AdminWorkOrderDto,
  type AdminWorkOrderListResponse,
  ErrorCode,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createInvoice } from "../../test/fixtures.js";
import { expectApiError } from "../../test/http.js";
import { dataOf } from "../../test/quotation-world.js";
import {
  ADMIN_WORK_ORDERS,
  at,
  insertJob,
  newJob,
  schedule,
  scheduleBody,
  scheduleRequest,
  type WorkOrderWorld,
  workOrderWorld,
} from "../../test/work-order-world.js";
import { canPerformWorkOrderAction } from "./work-orders.domain.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const S = WorkOrderStatus;
const A = WorkOrderAction;
/** A response's JSON body, typed `unknown` (supertest types it `any`). */
const jsonOf = (response: { body: unknown }): unknown => response.body;
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
const DAY = "2026-03-03";
const ALEX_EMAIL = "alex.morgan@example.test";

const COMPLETION_NOTE =
  "Replaced the run capacitor and re-gassed the system. The unit now cools to 68 degrees.";
const INTERNAL_NOTE = "INTERNAL-NOTE: upsell a surge protector; Mr Morgan is slow to pay.";
const INTERNAL_REASON = "INTERNAL-REASON: the part is backordered and the customer wants a refund.";
const CUSTOMER_MESSAGE = "We are sorry for the trouble and will phone you this week.";

type LifecycleAction =
  typeof A.START | typeof A.MARK_NEEDS_RESCHEDULING | typeof A.COMPLETE | typeof A.CANCEL;
const LIFECYCLE_ACTIONS: readonly LifecycleAction[] = [
  A.START,
  A.MARK_NEEDS_RESCHEDULING,
  A.COMPLETE,
  A.CANCEL,
];

/** The body a screen would send for `action` on a job it sees in `status`. */
function bodyFor(action: LifecycleAction, status: WorkOrderStatus, extra: object = {}) {
  const fields = {
    [A.START]: {},
    [A.MARK_NEEDS_RESCHEDULING]: { reason: INTERNAL_REASON },
    [A.COMPLETE]: { completionNote: COMPLETION_NOTE, internalNote: INTERNAL_NOTE },
    [A.CANCEL]: { reason: INTERNAL_REASON },
  }[action];
  return { action, expectedStatus: status, ...fields, ...extra };
}

function transition(w: WorkOrderWorld, id: string, body: object, cookie = w.adminCookie) {
  return w.client.post(`${ADMIN_WORK_ORDERS}/${id}/transitions`, { cookie }).send(body);
}

/** A job scheduled for 10:00 to 12:00 on 3 March with Jordan, the real way. */
async function scheduledJob(w: WorkOrderWorld, owner: "alex" | "priya" = "alex") {
  const job = await newJob(w, owner);
  return schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
}

/** A job that has been started, through the endpoint. */
async function startedJob(w: WorkOrderWorld) {
  const job = await scheduledJob(w);
  const response = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));
  expect(response.status).toBe(200);
  return dataOf<AdminWorkOrderDto>(response);
}

/** A job inserted straight into `status`, with the columns that status implies. */
async function jobIn(w: WorkOrderWorld, status: WorkOrderStatus) {
  const booked = status === S.SCHEDULED || status === S.IN_PROGRESS;
  const job = await insertJob(w, {
    status,
    ...(booked && {
      technicianId: w.jordan.id,
      start: at(DAY, "10:00"),
      end: at(DAY, "12:00"),
    }),
  });
  if (status === S.IN_PROGRESS) {
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { startedAt: new Date("2026-03-02T09:00:00.000Z") },
    });
  }
  return job;
}

/** The stored columns a refusal must leave alone, or a success must change. */
async function storedJob(id: string) {
  const row = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
  return {
    status: row.status,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    technicianId: row.technicianId,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completionNote: row.completionNote,
    internalCompletionNote: row.internalCompletionNote,
    cancelReason: row.cancelReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Everything a successful transition would have added, which a refusal must not. */
async function footprint(w: WorkOrderWorld) {
  await w.deps.emailDispatcher.idle();
  return {
    events: await prisma.activityEvent.count(),
    notifications: await prisma.notification.count(),
    emails: w.emails.sent.length,
    emailLogs: await prisma.emailDeliveryLog.count(),
  };
}

function eventsOf(id: string) {
  return prisma.activityEvent.findMany({
    where: { entityType: "WORK_ORDER", entityId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function lastEventOf(id: string) {
  const events = await eventsOf(id);
  const last = events[events.length - 1];
  if (last === undefined) throw new Error("The job has no history.");
  return last;
}

function emailsToAlex(w: WorkOrderWorld) {
  return w.emails.sent.filter((mail) => mail.to === ALEX_EMAIL);
}

/** Everything the customer can read about the job: the API, the history, the notifications and the emails. */
async function whatTheCustomerCanRead(w: WorkOrderWorld, job: { id: string; requestId: string }) {
  await w.deps.emailDispatcher.idle();
  const mine = await w.client.get(`/api/v1/work-orders/${job.id}`, { cookie: w.alexCookie });
  const list = await w.client.get("/api/v1/work-orders/me", { cookie: w.alexCookie });
  const request = await w.client.get(`/api/v1/requests/${job.requestId}`, {
    cookie: w.alexCookie,
  });
  return JSON.stringify({
    mine: jsonOf(mine),
    list: jsonOf(list),
    request: jsonOf(request),
    notifications: await prisma.notification.findMany({
      where: { recipientUserId: w.alex.user.id },
    }),
    emails: emailsToAlex(w),
  });
}

describe("POST /admin/work-orders/:id/transitions: START (G.1)", () => {
  it("moves a scheduled job to in progress and stamps the start with the server's clock", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    w.clock.set("2026-03-03T15:20:00.000Z");

    const response = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));

    expect(response.status).toBe(200);
    const body = response.body as { data: AdminWorkOrderDto; meta: object };
    expect(body.data).toMatchObject({
      id: job.id,
      status: S.IN_PROGRESS,
      statusLabel: "In progress",
      startedAt: "2026-03-03T15:20:00.000Z",
      completedAt: null,
      availableActions: [A.COMPLETE, A.MARK_NEEDS_RESCHEDULING],
    });
    expect(body.meta).toEqual({ startedBeforeSchedule: false });
    expect(await storedJob(job.id)).toMatchObject({
      status: S.IN_PROGRESS,
      startedAt: "2026-03-03T15:20:00.000Z",
      technicianId: w.jordan.id,
    });
  });

  it("is allowed before the scheduled start, and says so in the response and the history", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    // The test clock is a day before the 10:00 visit.
    const response = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));

    expect(response.status).toBe(200);
    expect((response.body as { meta: object }).meta).toEqual({ startedBeforeSchedule: true });
    expect(dataOf<AdminWorkOrderDto>(response).status).toBe(S.IN_PROGRESS);
    const event = await lastEventOf(job.id);
    expect(event.summary).toBe(
      `Morgan Reyes started job ${job.reference} before its scheduled start.`,
    );
  });

  it("is not early from the scheduled moment on", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    w.clock.set("2026-03-03T15:00:00.000Z");

    const response = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));

    expect((response.body as { meta: object }).meta).toEqual({ startedBeforeSchedule: false });
    expect((await lastEventOf(job.id)).summary).toBe(`Morgan Reyes started job ${job.reference}.`);
  });

  it("records the start for both audiences and tells the customer nothing by notification or email", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await footprint(w);

    await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));

    const event = await lastEventOf(job.id);
    expect(event).toMatchObject({
      action: "work_order.started",
      fromStatus: S.SCHEDULED,
      toStatus: S.IN_PROGRESS,
      publicSummary: "We started work on your job.",
      customerId: w.alex.profile.id,
      actorUserId: w.admin.id,
    });
    expect(event.metadata).toEqual({
      workOrderReference: job.reference,
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
    });
    const after = await footprint(w);
    expect(after.events).toBe(before.events + 1);
    expect(after.notifications).toBe(before.notifications);
    expect(after.emails).toBe(before.emails);
  });
});

describe("POST /admin/work-orders/:id/transitions: MARK_NEEDS_RESCHEDULING (G.1)", () => {
  it.each([S.SCHEDULED, S.IN_PROGRESS])(
    "moves a %s job to needs rescheduling, keeping its old appointment as a reference",
    async (status) => {
      const w = await workOrderWorld(prisma);
      const job = status === S.IN_PROGRESS ? await startedJob(w) : await scheduledJob(w);

      const response = await transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, status));

      expect(response.status).toBe(200);
      expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
        status: S.NEEDS_RESCHEDULING,
        statusLabel: "Needs rescheduling",
        scheduledStart: "2026-03-03T15:00:00.000Z",
        scheduledEnd: "2026-03-03T17:00:00.000Z",
        technician: { name: "Jordan Lee" },
        // A job that needs a new time has not started, however far it had got.
        startedAt: null,
        availableActions: [A.SCHEDULE, A.CANCEL],
      });
      expect(await storedJob(job.id)).toMatchObject({
        status: S.NEEDS_RESCHEDULING,
        scheduledStart: "2026-03-03T15:00:00.000Z",
        technicianId: w.jordan.id,
        startedAt: null,
      });
    },
  );

  it("stops the old slot blocking the technician at once", async () => {
    const w = await workOrderWorld(prisma);
    const first = await scheduledJob(w);
    const second = await newJob(w, "priya");

    const blocked = await scheduleRequest(
      w,
      second.id,
      scheduleBody(second, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expectApiError(blocked, { status: 409, code: ErrorCode.SCHEDULING_CONFLICT });

    await transition(w, first.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED));

    const freed = await scheduleRequest(
      w,
      second.id,
      scheduleBody(second, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(freed.status).toBe(200);
  });

  it("can be scheduled again afterwards, as a first booking", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    await transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.IN_PROGRESS));

    const again = await schedule(
      w,
      { id: job.id, status: S.NEEDS_RESCHEDULING },
      w.sam.id,
      at("2026-03-04", "09:00"),
      at("2026-03-04", "11:00"),
    );

    expect(again).toMatchObject({
      status: S.SCHEDULED,
      startedAt: null,
      technician: { name: "Sam Ortiz" },
    });
  });

  it("keeps the old appointment in the history, with the reason for staff only", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);

    await transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED));

    const event = await lastEventOf(job.id);
    expect(event).toMatchObject({
      action: "work_order.needs_rescheduling",
      fromStatus: S.SCHEDULED,
      toStatus: S.NEEDS_RESCHEDULING,
      publicSummary: "We need to find a new time for your visit.",
    });
    expect(event.metadata).toEqual({
      workOrderReference: job.reference,
      previousScheduledStart: "2026-03-03T15:00:00.000Z",
      previousScheduledEnd: "2026-03-03T17:00:00.000Z",
      technicianId: w.jordan.id,
    });
    expect(event.summary).toContain(`marked job ${job.reference} as needing a new time`);
    expect(event.summary).toContain("it was Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(event.summary).toContain(INTERNAL_REASON);
    expect(event.publicSummary).not.toContain("backordered");
  });

  it("tells the customer in the app and by email, with the message and without the reason", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await footprint(w);

    await transition(
      w,
      job.id,
      bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED, { customerMessage: CUSTOMER_MESSAGE }),
    );
    const after = await footprint(w);

    expect(after.notifications).toBe(before.notifications + 1);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "JOB_NEEDS_RESCHEDULING" },
    });
    expect(notification).toMatchObject({
      recipientUserId: w.alex.user.id,
      title: `Visit for ${job.reference} needs a new time`,
      linkPath: `/portal/jobs/${job.id}`,
      entityType: "WORK_ORDER",
      entityId: job.id,
      readAt: null,
    });
    expect(notification.message).toContain("AC Repair");

    const mail = emailsToAlex(w).at(-1);
    expect(mail?.subject).toBe("We need to find a new time for your AC Repair visit");
    expect(mail?.text).toContain(CUSTOMER_MESSAGE);
    expect(mail?.text).toContain(`/portal/jobs/${job.id}`);
    expect(mail?.text).not.toContain("INTERNAL-REASON");
    expect(mail?.html).not.toContain("INTERNAL-REASON");
  });

  it("sends the email without a message when none was written", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);

    await transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED));
    await w.deps.emailDispatcher.idle();

    const mail = emailsToAlex(w).at(-1);
    expect(mail?.subject).toBe("We need to find a new time for your AC Repair visit");
    expect(mail?.text).not.toContain("A message from");
  });

  it("accepts a reason of 200 characters and refuses one of 201", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await storedJob(job.id);

    const tooLong = await transition(
      w,
      job.id,
      bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED, { reason: "r".repeat(201) }),
    );
    const error = expectApiError(tooLong, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors?.reason).toMatch(/200 characters or fewer/);
    expect(await storedJob(job.id)).toEqual(before);

    const justRight = await transition(
      w,
      job.id,
      bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED, { reason: "r".repeat(200) }),
    );
    expect(justRight.status).toBe(200);
    // Even a reason this long fits the history line, whatever the names are.
    expect((await lastEventOf(job.id)).summary.length).toBeLessThanOrEqual(500);
  });
});

describe("POST /admin/work-orders/:id/transitions: COMPLETE (G.2)", () => {
  it("completes a job in progress, storing both notes and the time it was done", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    w.clock.set("2026-03-03T16:45:00.000Z");

    const response = await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));

    expect(response.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
      status: S.COMPLETED,
      statusLabel: "Completed",
      completedAt: "2026-03-03T16:45:00.000Z",
      completionNote: COMPLETION_NOTE,
      internalCompletionNote: INTERNAL_NOTE,
      // A completed job is ready for its invoice (T20); it has none yet.
      availableActions: [A.CREATE_INVOICE],
      invoice: null,
    });
    expect(await storedJob(job.id)).toMatchObject({
      status: S.COMPLETED,
      completedAt: "2026-03-03T16:45:00.000Z",
      completionNote: COMPLETION_NOTE,
      internalCompletionNote: INTERNAL_NOTE,
    });
  });

  it("does not need an internal note", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);

    const response = await transition(w, job.id, {
      action: A.COMPLETE,
      expectedStatus: S.IN_PROGRESS,
      completionNote: COMPLETION_NOTE,
    });

    expect(response.status).toBe(200);
    expect(await storedJob(job.id)).toMatchObject({
      completionNote: COMPLETION_NOTE,
      internalCompletionNote: null,
    });
  });

  it("trims the notes and treats a blank internal note as none", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);

    await transition(w, job.id, {
      action: A.COMPLETE,
      expectedStatus: S.IN_PROGRESS,
      completionNote: `   ${COMPLETION_NOTE}   `,
      internalNote: "    ",
    });

    expect(await storedJob(job.id)).toMatchObject({
      completionNote: COMPLETION_NOTE,
      internalCompletionNote: null,
    });
  });

  it("makes the job appear in Ready to invoice", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    const readyUrl = `${ADMIN_WORK_ORDERS}?view=ready-to-invoice`;

    const before = await w.client.get(readyUrl, { cookie: w.adminCookie });
    expect(dataOf<unknown[]>(before)).toEqual([]);

    await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));

    const after = await w.client.get(readyUrl, { cookie: w.adminCookie });
    expect(dataOf<{ id: string; status: string }[]>(after)).toMatchObject([
      { id: job.id, status: S.COMPLETED },
    ]);
    expect((after.body as AdminWorkOrderListResponse).meta.viewCounts["ready-to-invoice"]).toBe(1);
  });

  it("records the completion without the notes, and tells the customer in the app and by email", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    const before = await footprint(w);

    await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));

    const event = await lastEventOf(job.id);
    expect(event).toMatchObject({
      action: "work_order.completed",
      fromStatus: S.IN_PROGRESS,
      toStatus: S.COMPLETED,
      publicSummary: "We marked your job as complete.",
      summary: `Morgan Reyes completed job ${job.reference}.`,
    });
    expect(event.metadata).toEqual({ workOrderReference: job.reference });

    const after = await footprint(w);
    expect(after.notifications).toBe(before.notifications + 1);
    expect(after.emails).toBe(before.emails + 1);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "JOB_COMPLETED" },
    });
    expect(notification).toMatchObject({
      recipientUserId: w.alex.user.id,
      title: `Job ${job.reference} is complete`,
      linkPath: `/portal/jobs/${job.id}`,
    });
    const mail = emailsToAlex(w).at(-1);
    expect(mail?.subject).toBe("Your AC Repair job is complete");
    expect(mail?.text).toContain(`/portal/jobs/${job.id}`);
  });

  it("is the same through the real endpoints from a pending job: schedule, start, complete", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const scheduled = await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const started = await transition(w, job.id, bodyFor(A.START, scheduled.status));
    const done = await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));

    expect([started.status, done.status]).toEqual([200, 200]);
    expect((await eventsOf(job.id)).map((event) => event.action)).toEqual([
      "work_order.created",
      "work_order.scheduled",
      "work_order.started",
      "work_order.completed",
    ]);
  });
});

describe("POST /admin/work-orders/:id/transitions: CANCEL (G.1)", () => {
  it.each([S.PENDING_SCHEDULING, S.SCHEDULED, S.NEEDS_RESCHEDULING])(
    "cancels a %s job, storing the reason and the time",
    async (status) => {
      const w = await workOrderWorld(prisma);
      const job = await jobIn(w, status);
      w.clock.set("2026-03-02T18:00:00.000Z");

      const response = await transition(w, job.id, bodyFor(A.CANCEL, status));

      expect(response.status).toBe(200);
      expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
        status: S.CANCELLED,
        statusLabel: "Cancelled",
        cancelledAt: "2026-03-02T18:00:00.000Z",
        cancelReason: INTERNAL_REASON,
        availableActions: [],
      });
      expect(await storedJob(job.id)).toMatchObject({
        status: S.CANCELLED,
        cancelledAt: "2026-03-02T18:00:00.000Z",
        cancelReason: INTERNAL_REASON,
      });
    },
  );

  it("frees the technician's time", async () => {
    const w = await workOrderWorld(prisma);
    const first = await scheduledJob(w);
    const second = await newJob(w, "priya");
    await transition(w, first.id, bodyFor(A.CANCEL, S.SCHEDULED));

    const response = await scheduleRequest(
      w,
      second.id,
      scheduleBody(second, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(response.status).toBe(200);
  });

  it("tells the customer in the app and by email, with the message and without the reason", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);

    await transition(
      w,
      job.id,
      bodyFor(A.CANCEL, S.SCHEDULED, { customerMessage: CUSTOMER_MESSAGE }),
    );
    await w.deps.emailDispatcher.idle();

    const event = await lastEventOf(job.id);
    expect(event).toMatchObject({
      action: "work_order.cancelled",
      fromStatus: S.SCHEDULED,
      toStatus: S.CANCELLED,
      publicSummary: "We cancelled your job.",
    });
    expect(event.summary).toContain(INTERNAL_REASON);
    expect(event.summary).toContain("The customer was sent a message.");
    expect(event.metadata).toMatchObject({
      workOrderReference: job.reference,
      previousScheduledStart: "2026-03-03T15:00:00.000Z",
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "JOB_CANCELLED" },
    });
    expect(notification).toMatchObject({
      recipientUserId: w.alex.user.id,
      title: `Job ${job.reference} was cancelled`,
      linkPath: `/portal/jobs/${job.id}`,
    });
    const mail = emailsToAlex(w).at(-1);
    expect(mail?.subject).toBe("Your AC Repair job was cancelled");
    expect(mail?.text).toContain(CUSTOMER_MESSAGE);
    expect(mail?.text).not.toContain("INTERNAL-REASON");
    expect(mail?.html).not.toContain("INTERNAL-REASON");
  });

  it("leaves the request converted and the quotation accepted: the history is not rewritten", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await transition(w, job.id, bodyFor(A.CANCEL, S.SCHEDULED));

    const request = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: job.request.id },
    });
    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: job.quotation.id } });
    expect(request.status).toBe("CONVERTED_TO_JOB");
    expect(quotation.status).toBe("ACCEPTED");
  });

  it("accepts a reason of 500 characters and refuses one of 501", async () => {
    const w = await workOrderWorld(prisma);
    const job = await jobIn(w, S.PENDING_SCHEDULING);

    const tooLong = await transition(
      w,
      job.id,
      bodyFor(A.CANCEL, S.PENDING_SCHEDULING, { reason: "r".repeat(501) }),
    );
    expectApiError(tooLong, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect((await storedJob(job.id)).status).toBe(S.PENDING_SCHEDULING);

    const justRight = await transition(
      w,
      job.id,
      bodyFor(A.CANCEL, S.PENDING_SCHEDULING, { reason: "r".repeat(500) }),
    );
    expect(justRight.status).toBe(200);
    // The history line stays inside its limit however long the reason is.
    expect((await lastEventOf(job.id)).summary.length).toBeLessThanOrEqual(500);
  });
});

describe("a disallowed action leaves the job as it was (G.1: 409)", () => {
  it("refuses every status and action pair D-24 does not list, and writes nothing", async () => {
    const w = await workOrderWorld(prisma);
    let refusals = 0;

    for (const status of Object.values(S)) {
      for (const action of LIFECYCLE_ACTIONS) {
        if (canPerformWorkOrderAction(status, action)) continue;
        const job = await jobIn(w, status);
        const stored = await storedJob(job.id);
        const written = await footprint(w);
        const label = `${action} on a ${status} job`;

        const response = await transition(w, job.id, bodyFor(action, status));

        const error = expectApiError(response, {
          status: 409,
          code: ErrorCode.INVALID_STATE_TRANSITION,
        });
        expect(error.details, label).toMatchObject({ currentStatus: status });
        expect(await storedJob(job.id), label).toEqual(stored);
        expect(await footprint(w), label).toEqual(written);
        refusals += 1;
      }
    }
    // 6 statuses x 4 lifecycle actions = 24 pairs, 7 of them allowed (the scheduling actions are T17's).
    expect(refusals).toBe(17);
  });

  it("will not complete a job that is still pending scheduling (spec 6.4)", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const stored = await storedJob(job.id);
    const written = await footprint(w);

    const response = await transition(w, job.id, bodyFor(A.COMPLETE, S.PENDING_SCHEDULING));

    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.details).toEqual({
      currentStatus: S.PENDING_SCHEDULING,
      requestedStatus: S.COMPLETED,
    });
    expect(await storedJob(job.id)).toEqual(stored);
    expect(await footprint(w)).toEqual(written);
    const read = await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, { cookie: w.adminCookie });
    expect(dataOf<AdminWorkOrderDto>(read)).toMatchObject({
      status: S.PENDING_SCHEDULING,
      completedAt: null,
      completionNote: null,
    });
  });

  it("will not cancel a job in progress: it is completed with a note instead", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    const response = await transition(w, job.id, bodyFor(A.CANCEL, S.IN_PROGRESS));
    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.message).toBe("A job that is in progress cannot be cancelled.");
    expect((await storedJob(job.id)).status).toBe(S.IN_PROGRESS);
  });

  it("will not change a finished job at all, whoever asks", async () => {
    const w = await workOrderWorld(prisma);
    for (const status of [S.COMPLETED, S.CANCELLED]) {
      const job = await jobIn(w, status);
      for (const action of LIFECYCLE_ACTIONS) {
        const response = await transition(w, job.id, bodyFor(action, status));
        const error = expectApiError(response, {
          status: 409,
          code: ErrorCode.INVALID_STATE_TRANSITION,
        });
        expect(error.message).toMatch(/can no longer be changed/);
      }
    }
  });
});

describe("a missing note or reason (G.1: 422)", () => {
  async function refused(w: WorkOrderWorld, jobId: string, status: WorkOrderStatus, body: object) {
    const stored = await storedJob(jobId);
    const written = await footprint(w);
    const response = await transition(w, jobId, { expectedStatus: status, ...body });
    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await storedJob(jobId)).toEqual(stored);
    expect(await footprint(w)).toEqual(written);
    return error;
  }

  it("refuses to complete without a completion summary, or with a short one", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);

    const missing = await refused(w, job.id, S.IN_PROGRESS, { action: A.COMPLETE });
    expect(missing.fieldErrors?.completionNote).toMatch(/completion summary of 10 to 2000/);

    const blank = await refused(w, job.id, S.IN_PROGRESS, {
      action: A.COMPLETE,
      completionNote: "          ",
    });
    expect(blank.fieldErrors?.completionNote).toBeDefined();

    const short = await refused(w, job.id, S.IN_PROGRESS, {
      action: A.COMPLETE,
      completionNote: "Done.",
      internalNote: INTERNAL_NOTE,
    });
    expect(short.fieldErrors?.completionNote).toMatch(/at least 10 characters/);

    const long = await refused(w, job.id, S.IN_PROGRESS, {
      action: A.COMPLETE,
      completionNote: "d".repeat(2001),
    });
    expect(long.fieldErrors?.completionNote).toMatch(/2000 characters or fewer/);
  });

  it.each([A.CANCEL, A.MARK_NEEDS_RESCHEDULING])(
    "refuses to %s without a reason",
    async (action) => {
      const w = await workOrderWorld(prisma);
      const job = await scheduledJob(w);

      const missing = await refused(w, job.id, S.SCHEDULED, { action });
      expect(missing.fieldErrors?.reason).toMatch(/Enter a reason/);

      const short = await refused(w, job.id, S.SCHEDULED, { action, reason: "no" });
      expect(short.fieldErrors?.reason).toMatch(/at least 5 characters/);
    },
  );

  it("refuses a field the action does not take", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);

    const reason = await refused(w, job.id, S.IN_PROGRESS, {
      action: A.COMPLETE,
      completionNote: COMPLETION_NOTE,
      reason: INTERNAL_REASON,
    });
    expect(reason.fieldErrors?.reason).toMatch(/does not take a reason/);

    const note = await refused(w, job.id, S.IN_PROGRESS, {
      action: A.MARK_NEEDS_RESCHEDULING,
      reason: INTERNAL_REASON,
      completionNote: COMPLETION_NOTE,
    });
    expect(note.fieldErrors?.completionNote).toMatch(/does not take a completion summary/);
  });

  it("refuses a status, a timestamp and any other key: the server decides those", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    for (const extra of [
      { status: S.COMPLETED },
      { completedAt: "2026-03-03T16:00:00Z" },
      { startedAt: "2026-03-03T16:00:00Z" },
      { technicianId: w.sam.id },
    ]) {
      await refused(w, job.id, S.SCHEDULED, { action: A.START, ...extra });
    }
  });

  it("refuses an unknown action, the scheduling actions and a missing expectedStatus", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    for (const action of ["REOPEN", A.SCHEDULE, A.RESCHEDULE, "start", undefined]) {
      const error = await refused(w, job.id, S.SCHEDULED, { action });
      expect(error.fieldErrors?.action).toMatch(/action must be one of/);
    }
    const response = await transition(w, job.id, { action: A.START });
    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors?.expectedStatus).toBeDefined();
  });
});

describe("a stale view (G.1: 409 STALE_STATE)", () => {
  it("refuses an expectedStatus that is no longer the job's status, and changes nothing", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const stored = await storedJob(job.id);
    const written = await footprint(w);

    const response = await transition(w, job.id, bodyFor(A.START, S.PENDING_SCHEDULING));

    const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: S.SCHEDULED });
    expect(await storedJob(job.id)).toEqual(stored);
    expect(await footprint(w)).toEqual(written);
  });

  it("answers a second press of the same button with STALE_STATE, not a second change", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const first = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));
    const written = await footprint(w);

    const second = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));

    expect(first.status).toBe(200);
    const error = expectApiError(second, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: S.IN_PROGRESS });
    expect(await footprint(w)).toEqual(written);
  });

  it("says the view is stale before it says the action is not allowed", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    // The screen still shows SCHEDULED; the job has moved on to IN_PROGRESS, where START is not allowed.
    const response = await transition(w, job.id, bodyFor(A.START, S.SCHEDULED));
    expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
  });
});

describe("who may use the endpoint", () => {
  it("answers 401 without a session and 403 to a customer, even for their own job", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const stored = await storedJob(job.id);
    const written = await footprint(w);
    const body = bodyFor(A.START, S.SCHEDULED);

    const anonymous = await w.client.post(`${ADMIN_WORK_ORDERS}/${job.id}/transitions`).send(body);
    expectApiError(anonymous, { status: 401, code: ErrorCode.UNAUTHENTICATED });

    const owner = await transition(w, job.id, body, w.alexCookie);
    expectApiError(owner, { status: 403, code: ErrorCode.FORBIDDEN });
    const stranger = await transition(w, job.id, body, w.priyaCookie);
    expectApiError(stranger, { status: 403, code: ErrorCode.FORBIDDEN });

    expect(await storedJob(job.id)).toEqual(stored);
    expect(await footprint(w)).toEqual(written);
  });

  it("answers 404 for a job that does not exist and 422 for something that is not an id", async () => {
    const w = await workOrderWorld(prisma);
    const missing = await transition(w, MISSING_ID, bodyFor(A.START, S.SCHEDULED));
    expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
    const notAnId = await transition(w, "not-an-id", bodyFor(A.START, S.SCHEDULED));
    expectApiError(notAnId, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("refuses a request from another origin", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const response = await w.client
      .post(`${ADMIN_WORK_ORDERS}/${job.id}/transitions`, {
        cookie: w.adminCookie,
        origin: "https://evil.example.com",
      })
      .send(bodyFor(A.START, S.SCHEDULED));
    expect(response.status).toBe(403);
    expect((await storedJob(job.id)).status).toBe(S.SCHEDULED);
  });
});

describe("what the customer can read (G.3, G.4)", () => {
  it("never includes the internal note, an internal reason or the technician's contact details", async () => {
    const w = await workOrderWorld(prisma);
    const done = await startedJob(w);
    await transition(w, done.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));
    const stopped = await scheduledJob(w);
    await transition(
      w,
      stopped.id,
      bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED, { customerMessage: CUSTOMER_MESSAGE }),
    );
    const cancelled = await jobIn(w, S.PENDING_SCHEDULING);
    await transition(w, cancelled.id, bodyFor(A.CANCEL, S.PENDING_SCHEDULING));

    for (const job of [done, stopped]) {
      const seen = await whatTheCustomerCanRead(w, { id: job.id, requestId: job.request.id });
      for (const secret of [
        "INTERNAL-NOTE",
        "INTERNAL-REASON",
        "surge protector",
        "backordered",
        "555-0151",
        "jordan.lee@",
        "Do not send to the Larkspur Lane job",
        "Jordan Lee",
        "internalCompletionNote",
        "cancelReason",
      ]) {
        expect(seen, `${job.reference}: ${secret}`).not.toContain(secret);
      }
    }
    // The customer does read the completion summary, on the job.
    const mine = await w.client.get(`/api/v1/work-orders/${done.id}`, { cookie: w.alexCookie });
    expect(mine.body).toMatchObject({ data: { completionNote: COMPLETION_NOTE } });
  });

  it("never sends the notes or the reasons to anyone but the customer's own address", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    await w.deps.emailDispatcher.idle();
    const alreadySent = w.emails.sent.length;
    await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));
    await w.deps.emailDispatcher.idle();

    const sentByTheCompletion = w.emails.sent.slice(alreadySent);
    expect(sentByTheCompletion).toHaveLength(1);
    for (const mail of sentByTheCompletion) {
      expect(mail.to).toBe(ALEX_EMAIL);
      expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toMatch(/INTERNAL-/);
    }
  });
});

describe("failures", () => {
  it("stands even when the email cannot be sent", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    w.emails.failWith = new Error("SMTP is down");

    const response = await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect((await storedJob(job.id)).status).toBe(S.COMPLETED);
    expect(await prisma.notification.count({ where: { type: "JOB_COMPLETED" } })).toBe(1);
    expect(await prisma.emailDeliveryLog.count({ where: { status: "FAILED" } })).toBe(1);
  });

  it("changes nothing when the customer's notification cannot be written, then succeeds on a retry", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION refuse_completion_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'JOB_COMPLETED' THEN RAISE EXCEPTION 'refused for the test'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER refuse_completion_notification BEFORE INSERT ON notifications
       FOR EACH ROW EXECUTE FUNCTION refuse_completion_notification()`,
    );
    try {
      const failed = await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));
      expect(failed.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER refuse_completion_notification ON notifications",
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION refuse_completion_notification()");
    }

    // The status, both notes, the completion time, the history and the email were undone together.
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);

    const retry = await transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS));
    expect(retry.status).toBe(200);
  });
});

describe("two people acting at once (SEC-TXN-04)", () => {
  it("lets exactly one of two simultaneous starts win, with one event", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await footprint(w);

    const [a, b] = await Promise.all([
      transition(w, job.id, bodyFor(A.START, S.SCHEDULED)),
      transition(w, job.id, bodyFor(A.START, S.SCHEDULED)),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expectApiError(loser, { status: 409, code: ErrorCode.STALE_STATE });
    expect((await footprint(w)).events).toBe(before.events + 1);
  });

  it("lets exactly one of two simultaneous completions win: one event, one notification, one email", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);
    const before = await footprint(w);

    const [a, b] = await Promise.all([
      transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS)),
      transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS)),
    ]);
    const after = await footprint(w);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(after.events).toBe(before.events + 1);
    expect(after.notifications).toBe(before.notifications + 1);
    expect(after.emails).toBe(before.emails + 1);
  });

  it("lets one of a simultaneous start and cancel win, and leaves a job that matches the winner", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await footprint(w);

    const [start, cancel] = await Promise.all([
      transition(w, job.id, bodyFor(A.START, S.SCHEDULED)),
      transition(w, job.id, bodyFor(A.CANCEL, S.SCHEDULED)),
    ]);

    expect([start.status, cancel.status].sort()).toEqual([200, 409]);
    const stored = await storedJob(job.id);
    if (start.status === 200) {
      expect(stored).toMatchObject({
        status: S.IN_PROGRESS,
        cancelledAt: null,
        cancelReason: null,
      });
    } else {
      expect(stored).toMatchObject({ status: S.CANCELLED, startedAt: null });
    }
    const after = await footprint(w);
    expect(after.events).toBe(before.events + 1);
  });

  it("lets one of a simultaneous completion and 'needs a new time' win", async () => {
    const w = await workOrderWorld(prisma);
    const job = await startedJob(w);

    const [complete, needs] = await Promise.all([
      transition(w, job.id, bodyFor(A.COMPLETE, S.IN_PROGRESS)),
      transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.IN_PROGRESS)),
    ]);

    expect([complete.status, needs.status].sort()).toEqual([200, 409]);
    const stored = await storedJob(job.id);
    if (complete.status === 200) {
      expect(stored).toMatchObject({ status: S.COMPLETED, completionNote: COMPLETION_NOTE });
    } else {
      expect(stored).toMatchObject({
        status: S.NEEDS_RESCHEDULING,
        completionNote: null,
        completedAt: null,
      });
    }
  });

  it("keeps the appointment the history records when a reschedule races 'needs a new time'", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);

    const [moved, needs] = await Promise.all([
      scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at("2026-03-04", "09:00"), at("2026-03-04", "11:00"), {
          reason: "The customer asked for the next morning.",
        }),
      ),
      transition(w, job.id, bodyFor(A.MARK_NEEDS_RESCHEDULING, S.SCHEDULED)),
    ]);
    // Either can win. If "needs a new time" ran first the reschedule is stale (409); if the
    // reschedule ran first, "needs a new time" still finds the job scheduled and succeeds.
    expect([moved.status, needs.status]).not.toEqual([409, 409]);
    expect([moved.status, needs.status].filter((status) => status === 200).length).toBeGreaterThan(
      0,
    );

    // Whichever ran second saw the other's result: the old appointment in the history is the one
    // the job really had at that moment, and the stored appointment is the last one written.
    const stored = await storedJob(job.id);
    const history = (await eventsOf(job.id)).find(
      (event) => event.action === "work_order.needs_rescheduling",
    );
    if (needs.status === 200) {
      expect(history?.metadata).toMatchObject({
        previousScheduledStart: stored.scheduledStart,
        previousScheduledEnd: stored.scheduledEnd,
      });
    } else {
      expect(history).toBeUndefined();
    }
  });
});

describe("GET /admin/work-orders?view=ready-to-invoice (G.2)", () => {
  async function completedJob(w: WorkOrderWorld, completedAt: string, owner?: "alex" | "priya") {
    const job = await insertJob(w, { status: S.COMPLETED, ...(owner !== undefined && { owner }) });
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { completedAt: new Date(completedAt) },
    });
    return job;
  }

  function list(w: WorkOrderWorld, query: string) {
    return w.client.get(`${ADMIN_WORK_ORDERS}?${query}`, { cookie: w.adminCookie });
  }

  it("lists completed jobs that have no invoice, and nothing else", async () => {
    const w = await workOrderWorld(prisma);
    const ready = await completedJob(w, "2026-03-02T12:00:00.000Z");
    await jobIn(w, S.SCHEDULED);
    await jobIn(w, S.CANCELLED);
    await jobIn(w, S.PENDING_SCHEDULING);

    const response = await list(w, "view=ready-to-invoice");

    expect(response.status).toBe(200);
    expect(dataOf<{ id: string }[]>(response).map((item) => item.id)).toEqual([ready.id]);
    expect((response.body as AdminWorkOrderListResponse).pagination).toMatchObject({
      totalItems: 1,
    });
  });

  it("drops a job once an invoice that is not void exists, and keeps one whose invoice was voided", async () => {
    const w = await workOrderWorld(prisma);
    const invoiced = await completedJob(w, "2026-03-02T12:00:00.000Z");
    const drafted = await completedJob(w, "2026-03-02T13:00:00.000Z", "priya");
    const voided = await completedJob(w, "2026-03-02T14:00:00.000Z");
    const waiting = await completedJob(w, "2026-03-02T15:00:00.000Z");
    const owner = { createdByUserId: w.admin.id };
    await createInvoice(prisma, {
      workOrderId: invoiced.id,
      customerId: w.alex.profile.id,
      status: "ISSUED",
      invoiceNumber: "INV-2026-00001",
      issuedAt: new Date("2026-03-02T16:00:00.000Z"),
      issueDate: new Date("2026-03-02"),
      dueDate: new Date("2026-03-16"),
      ...owner,
    });
    await createInvoice(prisma, {
      workOrderId: drafted.id,
      customerId: w.priya.profile.id,
      status: "DRAFT",
      ...owner,
    });
    await createInvoice(prisma, {
      workOrderId: voided.id,
      customerId: w.alex.profile.id,
      status: "VOID",
      invoiceNumber: "INV-2026-00002",
      voidedAt: new Date("2026-03-02T16:00:00.000Z"),
      voidReason: "Wrong customer.",
      ...owner,
    });

    const response = await list(w, "view=ready-to-invoice&sort=completedAt&order=asc");

    expect(dataOf<{ id: string }[]>(response).map((item) => item.id)).toEqual([
      voided.id,
      waiting.id,
    ]);
    // A job with a draft invoice is already being invoiced; the plain "Completed" tab keeps all four.
    const completed = await list(w, "view=completed");
    expect(dataOf<unknown[]>(completed)).toHaveLength(4);
    expect((response.body as AdminWorkOrderListResponse).meta.viewCounts).toMatchObject({
      "ready-to-invoice": 2,
      completed: 4,
    });
  });

  it("sorts by completion time, oldest first and newest first, with the time in each row", async () => {
    const w = await workOrderWorld(prisma);
    const older = await completedJob(w, "2026-03-01T12:00:00.000Z");
    const newer = await completedJob(w, "2026-03-02T12:00:00.000Z");
    await jobIn(w, S.SCHEDULED);

    const oldest = await list(w, "view=all&sort=completedAt&order=asc");
    const newest = await list(w, "view=all&sort=completedAt&order=desc");

    const ids = (response: { body: unknown }) =>
      dataOf<{ id: string; completedAt: string | null }[]>(response).map((item) => item.id);
    // Jobs that are not completed come last, in either direction.
    expect(ids(oldest).slice(0, 2)).toEqual([older.id, newer.id]);
    expect(ids(newest).slice(0, 2)).toEqual([newer.id, older.id]);
    expect(dataOf<{ completedAt: string | null }[]>(oldest)[0]?.completedAt).toBe(
      "2026-03-01T12:00:00.000Z",
    );
    expect(dataOf<{ completedAt: string | null }[]>(oldest).at(-1)?.completedAt).toBeNull();
  });

  it("counts the tab under the other filters, and is for admins only", async () => {
    const w = await workOrderWorld(prisma);
    await completedJob(w, "2026-03-02T12:00:00.000Z");
    await completedJob(w, "2026-03-02T13:00:00.000Z", "priya");

    const filtered = await list(w, "view=needs-scheduling&q=Priya");
    expect((filtered.body as AdminWorkOrderListResponse).meta.viewCounts["ready-to-invoice"]).toBe(
      1,
    );

    const customer = await w.client.get(`${ADMIN_WORK_ORDERS}?view=ready-to-invoice`, {
      cookie: w.alexCookie,
    });
    expectApiError(customer, { status: 403, code: ErrorCode.FORBIDDEN });
    const anonymous = await w.client.get(`${ADMIN_WORK_ORDERS}?view=ready-to-invoice`);
    expectApiError(anonymous, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });
});
