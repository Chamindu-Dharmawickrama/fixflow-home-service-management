import {
  type AdminWorkOrderDto,
  type CustomerRequestDto,
  ErrorCode,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import { dataOf } from "../../test/quotation-world.js";
import {
  ADMIN_WORK_ORDERS,
  at,
  bookedJob,
  insertJob,
  newJob,
  schedule,
  scheduleBody,
  scheduleRequest,
  type WorkOrderWorld,
  workOrderWorld,
} from "../../test/work-order-world.js";
import {
  SCHEDULE_END_AFTER_START_MESSAGE,
  SCHEDULE_IN_THE_PAST_MESSAGE,
  SCHEDULE_TOO_LONG_MESSAGE,
} from "./work-orders.domain.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
const DAY = "2026-03-03";

/** The stored columns of a job that decide what a refusal must leave alone. */
async function storedJob(id: string) {
  const row = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
  return {
    status: row.status,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    technicianId: row.technicianId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Everything a successful schedule would have added, which a refusal must not. */
async function footprint(w: WorkOrderWorld) {
  await w.deps.emailDispatcher.idle();
  return {
    events: await prisma.activityEvent.count({ where: { entityType: "WORK_ORDER" } }),
    notifications: await prisma.notification.count({ where: { recipientUserId: w.alex.user.id } }),
    emails: w.emails.sent.length,
  };
}

describe("PATCH /admin/work-orders/:id/schedule (G.2)", () => {
  it("schedules a new job with an active technician", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );

    expect(response.status).toBe(200);
    const scheduled = dataOf<AdminWorkOrderDto>(response);
    expect(scheduled).toMatchObject({
      id: job.id,
      status: WorkOrderStatus.SCHEDULED,
      statusLabel: "Scheduled",
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technician: {
        id: w.jordan.id,
        name: "Jordan Lee",
        calendarColor: "blue",
        phone: "(212) 555-0151",
        email: "jordan.lee@coolbreeze.test",
        isActive: true,
      },
      availableActions: [
        WorkOrderAction.RESCHEDULE,
        WorkOrderAction.START,
        WorkOrderAction.MARK_NEEDS_RESCHEDULING,
        WorkOrderAction.CANCEL,
      ],
    });
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored).toMatchObject({ status: "SCHEDULED", technicianId: w.jordan.id });
    expect(stored.scheduledStart?.toISOString()).toBe("2026-03-03T15:00:00.000Z");
  });

  it("reads the times as instants: an offset is honoured, and the same instant is stored", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, "2026-03-03T10:00:00-05:00", "2026-03-03T12:00:00.000-05:00"),
    );

    expect(response.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
    });
  });

  it("writes the schedule to the job's history with the times and the technician, staff and customer voices", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "work_order.scheduled" },
    });
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "WORK_ORDER",
      entityId: job.id,
      requestId: job.request.id,
      customerId: w.alex.profile.id,
      fromStatus: "PENDING_SCHEDULING",
      toStatus: "SCHEDULED",
      summary: `Morgan Reyes scheduled job ${job.reference} for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST with Jordan Lee.`,
      publicSummary: "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    });
    expect(event.metadata).toEqual({
      workOrderReference: job.reference,
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technicianId: w.jordan.id,
    });
  });

  it("tells the customer in the app: the reference, the date and the window, and nothing else", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const [notification, ...others] = await prisma.notification.findMany({
      where: { type: "JOB_SCHEDULED" },
    });
    expect(others).toEqual([]);
    expect(notification).toMatchObject({
      recipientUserId: w.alex.user.id,
      type: "JOB_SCHEDULED",
      title: `Visit for ${job.reference} scheduled`,
      message: "Your visit is scheduled for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
      linkPath: `/portal/jobs/${job.id}`,
      entityType: "WORK_ORDER",
      entityId: job.id,
      readAt: null,
    });
    // Nobody else is told: not the other customer, not the admin who did it.
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
  });

  it("emails the customer once, after the commit, with the time on the business's clocks", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const before = w.emails.sent.length;
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    await w.deps.emailDispatcher.idle();

    const sent = w.emails.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "alex.morgan@example.test",
      subject: "Your AC Repair visit is scheduled",
    });
    expect(sent[0]?.text).toContain("Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(sent[0]?.text).toContain(job.reference);
    expect(sent[0]?.text).toContain(`/portal/jobs/${job.id}`);
  });

  it("keeps the technician and the staff's notes out of every customer-facing place", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    await w.deps.emailDispatcher.idle();

    const secrets = [
      "Jordan",
      "Lee",
      "555-0151",
      "jordan.lee@coolbreeze.test",
      "Larkspur Lane job",
    ];
    const mine = await w.client.get(`/api/v1/requests/${job.request.id}`, { cookie: w.alexCookie });
    const customerSees = JSON.stringify({
      request: JSON.stringify(mine.body),
      notifications: await prisma.notification.findMany({
        where: { recipientUserId: w.alex.user.id },
      }),
      emails: w.emails.sent.filter((mail) => mail.subject.includes("scheduled")),
    });
    for (const secret of secrets) {
      expect(customerSees).not.toContain(secret);
    }
    const timeline = dataOf<CustomerRequestDto>(mine).timeline.map((event) => event.publicSummary);
    expect(timeline).toContain(
      "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    );
  });

  it("stands even when the email cannot be sent", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    w.emails.failWith = new Error("SMTP is down");

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect((await storedJob(job.id)).status).toBe("SCHEDULED");
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
    expect(await prisma.emailDeliveryLog.count({ where: { status: "FAILED" } })).toBe(1);
  });

  it("schedules a job that needs rescheduling afresh, as a first booking", async () => {
    const w = await workOrderWorld(prisma);
    const stuck = await insertJob(w, {
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      technicianId: w.jordan.id,
      start: at("2026-03-02", "14:00"),
      end: at("2026-03-02", "16:00"),
    });

    const response = await scheduleRequest(
      w,
      stuck.id,
      scheduleBody({ status: "NEEDS_RESCHEDULING" }, w.sam.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );

    expect(response.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
      status: "SCHEDULED",
      technician: { name: "Sam Ortiz" },
    });
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { entityId: stuck.id, action: "work_order.scheduled" },
    });
    expect(event.fromStatus).toBe("NEEDS_RESCHEDULING");
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
  });

  it("does not touch the request, the quotation or any other job", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const other = await newJob(w, "priya");
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    expect(await storedJob(other.id)).toMatchObject({
      status: "PENDING_SCHEDULING",
      technicianId: null,
    });
    const request = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: job.request.id },
    });
    expect(request.status).toBe("CONVERTED_TO_JOB");
  });

  it("answers GET with the new schedule and the history", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const read = await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, { cookie: w.adminCookie });
    expect(dataOf<AdminWorkOrderDto>(read)).toMatchObject({
      status: "SCHEDULED",
      technician: { name: "Jordan Lee" },
    });
    expect(dataOf<AdminWorkOrderDto>(read).timeline.map((event) => event.action)).toEqual([
      "work_order.created",
      "work_order.scheduled",
    ]);
  });
});

describe("an appointment that makes no sense (G.3: 422)", () => {
  async function refused(
    w: WorkOrderWorld,
    job: AdminWorkOrderDto,
    start: string,
    end: string,
    expected: Record<string, string>,
  ) {
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };
    const response = await scheduleRequest(w, job.id, scheduleBody(job, w.jordan.id, start, end));
    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors).toEqual(expected);
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  }

  it("refuses an end that is the same as the start", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await refused(w, job, at(DAY, "10:00"), at(DAY, "10:00"), {
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
  });

  it("refuses an end before the start", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await refused(w, job, at(DAY, "12:00"), at(DAY, "10:00"), {
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
  });

  it("refuses a visit longer than 12 hours, and allows exactly 12", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await refused(w, job, at(DAY, "06:00"), "2026-03-03T23:00:00.001Z", {
      scheduledEnd: SCHEDULE_TOO_LONG_MESSAGE,
    });

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "06:00"), at(DAY, "18:00")),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a start in the past", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    // The fake clock reads 2 March 2026, 09:00 UTC.
    await refused(w, job, "2026-03-01T15:00:00.000Z", "2026-03-01T17:00:00.000Z", {
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
    });
  });

  it("allows a start exactly 15 minutes ago and refuses one a millisecond earlier", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await refused(w, job, "2026-03-02T08:44:59.999Z", "2026-03-02T10:00:00.000Z", {
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
    });

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, "2026-03-02T08:45:00.000Z", "2026-03-02T10:00:00.000Z"),
    );
    expect(response.status).toBe(200);
  });

  it("follows the server's clock, not the browser's: the same request is fine once the clock moves back", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const start = "2026-03-01T15:00:00.000Z";
    const end = "2026-03-01T17:00:00.000Z";
    await refused(w, job, start, end, { scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE });

    w.clock.set("2026-03-01T09:00:00.000Z");
    const response = await scheduleRequest(w, job.id, scheduleBody(job, w.jordan.id, start, end));
    expect(response.status).toBe(200);
  });

  it("names every field at once when the start and the end are both wrong", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await refused(w, job, "2026-03-01T17:00:00.000Z", "2026-03-01T15:00:00.000Z", {
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
  });

  it("refuses times that are not instants: a date without a zone, a date alone, nonsense", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    for (const bad of ["2026-03-03T10:00:00", "2026-03-03", "tomorrow at ten", "", 12]) {
      const response = await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, bad as string, at(DAY, "12:00")),
      );
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["scheduledStart"]);
    }
    expect((await storedJob(job.id)).status).toBe("PENDING_SCHEDULING");
  });

  it("names the missing fields, and refuses a body that sends more than it may", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);

    const empty = expectApiError(await scheduleRequest(w, job.id, {}), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(Object.keys(empty.fieldErrors ?? {}).sort()).toEqual([
      "expectedStatus",
      "scheduledEnd",
      "scheduledStart",
      "technicianId",
    ]);

    for (const extra of [
      { status: "COMPLETED" },
      { reference: "JOB-1" },
      { customerId: w.priya.profile.id },
    ]) {
      const response = await scheduleRequest(w, job.id, {
        ...scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
        ...extra,
      });
      expect(response.status).toBe(422);
    }
    expect(await storedJob(job.id)).toMatchObject({ status: "PENDING_SCHEDULING" });
  });

  it("refuses a malformed job id with 422 and an unknown one with 404", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const body = scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    expectApiError(await scheduleRequest(w, "not-an-id", body), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await scheduleRequest(w, MISSING_ID, body), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe("the technician (G.3)", () => {
  it("refuses an inactive technician with TECHNICIAN_INACTIVE, beside the technician field, and changes nothing", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.retired.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );

    const error = expectApiError(response, { status: 422, code: ErrorCode.TECHNICIAN_INACTIVE });
    expect(error.fieldErrors?.technicianId).toContain("Rae Retired is inactive");
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("says inactive before it says booked", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.retired.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.retired.id, at(DAY, "10:00"), at(DAY, "12:00")),
      ),
      { status: 422, code: ErrorCode.TECHNICIAN_INACTIVE },
    );
  });

  it("follows a technician's reactivation", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await prisma.technician.update({ where: { id: w.retired.id }, data: { isActive: true } });
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.retired.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a technician that does not exist, beside the technician field", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, MISSING_ID, at(DAY, "10:00"), at(DAY, "12:00")),
      ),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["technicianId"]);
    expect((await storedJob(job.id)).status).toBe("PENDING_SCHEDULING");
  });

  it("refuses a technician id that is not an id", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, "jordan", at(DAY, "10:00"), at(DAY, "12:00")),
      ),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["technicianId"]);
  });
});

describe("overlapping appointments (G.3: 409 SCHEDULING_CONFLICT)", () => {
  it("names the job it collides with: its reference, start and end", async () => {
    const w = await workOrderWorld(prisma);
    const existing = await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "11:00"), at(DAY, "13:00")),
    );

    const error = expectApiError(response, { status: 409, code: ErrorCode.SCHEDULING_CONFLICT });
    expect(error.message).toBe(
      `Jordan Lee is already booked for ${existing.reference} on Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST. Choose another time or technician.`,
    );
    expect(error.details).toEqual({
      conflictJobId: existing.id,
      conflictReference: existing.reference,
      conflictStart: "2026-03-03T15:00:00.000Z",
      conflictEnd: "2026-03-03T17:00:00.000Z",
      conflictCount: 1,
    });
    // The new job and the one it collided with are exactly as they were.
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
    expect((await storedJob(existing.id)).scheduledStart).toBe("2026-03-03T15:00:00.000Z");
  });

  // The existing visit is 10:00 to 12:00.
  it.each([
    ["the same time", "10:00", "12:00"],
    ["a visit inside it", "10:30", "11:30"],
    ["a visit around it", "09:00", "13:00"],
    ["one that starts before and ends inside", "09:00", "11:00"],
    ["one that starts inside and ends after", "11:00", "13:00"],
    ["one that ends a minute into it", "09:00", "10:01"],
    ["one that starts a minute before its end", "11:59", "14:00"],
  ])("refuses %s", async (_name, from, to) => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);

    expectApiError(
      await scheduleRequest(w, job.id, scheduleBody(job, w.jordan.id, at(DAY, from), at(DAY, to))),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    expect((await storedJob(job.id)).status).toBe("PENDING_SCHEDULING");
  });

  it.each([
    ["ending the moment it starts", "08:00", "10:00"],
    ["starting the moment it ends", "12:00", "14:00"],
    ["well before it", "07:00", "08:30"],
    ["well after it", "15:00", "16:00"],
  ])("accepts a back-to-back or separate visit: %s", async (_name, from, to) => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, from), at(DAY, to)),
    );
    expect(response.status).toBe(200);
  });

  it("lets back-to-back visits fill a technician's day, one after another", async () => {
    const w = await workOrderWorld(prisma);
    const slots = [
      ["08:00", "10:00"],
      ["10:00", "12:00"],
      ["12:00", "14:00"],
      ["14:00", "17:00"],
    ] as const;
    for (const [from, to] of slots) {
      const job = await newJob(w);
      await schedule(w, job, w.jordan.id, at(DAY, from), at(DAY, to));
    }
    expect(await prisma.workOrder.count({ where: { status: "SCHEDULED" } })).toBe(4);
  });

  it("lets two technicians work at the same time", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.sam.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(response.status).toBe(200);
  });

  it("is blocked by a job in progress as well as a scheduled one", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(
      w,
      w.jordan.id,
      at(DAY, "10:00"),
      at(DAY, "12:00"),
      WorkOrderStatus.IN_PROGRESS,
    );
    const job = await newJob(w);
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at(DAY, "11:00"), at(DAY, "13:00")),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
  });

  it.each([
    WorkOrderStatus.PENDING_SCHEDULING,
    WorkOrderStatus.NEEDS_RESCHEDULING,
    WorkOrderStatus.COMPLETED,
    WorkOrderStatus.CANCELLED,
  ])("is not blocked by a %s job, which holds no time", async (status) => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"), status);
    const job = await newJob(w);
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(response.status).toBe(200);
  });

  it("reports the first of several collisions, and how many there are", async () => {
    const w = await workOrderWorld(prisma);
    const later = await bookedJob(w, w.jordan.id, at(DAY, "13:00"), at(DAY, "14:00"));
    const earlier = await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "11:00"));
    const job = await newJob(w);

    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at(DAY, "09:00"), at(DAY, "15:00")),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    expect(error.details).toMatchObject({
      conflictJobId: earlier.id,
      conflictReference: earlier.reference,
      conflictCount: 2,
    });
    expect(error.message).toContain("(and 1 more)");
    expect(error.details?.conflictJobId).not.toBe(later.id);
  });

  it("sees a visit that runs past midnight", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "22:00"), at("2026-03-04", "02:00"));
    const job = await newJob(w);
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at("2026-03-04", "01:00"), at("2026-03-04", "03:00")),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    const clear = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at("2026-03-04", "02:00"), at("2026-03-04", "03:00")),
    );
    expect(clear.status).toBe(200);
  });

  it("is judged on instants, so the night the clocks change is no different", async () => {
    const w = await workOrderWorld(prisma);
    w.clock.set("2026-03-07T09:00:00.000Z");
    // 8 March 2026: 01:00 EST to 03:30 EDT is only 1.5 hours of real time.
    await bookedJob(w, w.jordan.id, at("2026-03-08", "01:00"), at("2026-03-08", "03:30"));
    const job = await newJob(w);
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at("2026-03-08", "03:00"), at("2026-03-08", "05:00")),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at("2026-03-08", "03:30"), at("2026-03-08", "05:00")),
    );
    expect(response.status).toBe(200);
  });
});

describe("the job's own state", () => {
  it("answers a stale expectedStatus with 409 STALE_STATE and changes nothing", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    // Someone else scheduled it; this screen still thinks it is waiting.
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody({ status: "PENDING_SCHEDULING" }, w.sam.id, at(DAY, "13:00"), at(DAY, "14:00")),
    );

    const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: "SCHEDULED" });
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("refuses a job that is under way, done or cancelled with INVALID_STATE_TRANSITION", async () => {
    const w = await workOrderWorld(prisma);
    for (const status of [
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.COMPLETED,
      WorkOrderStatus.CANCELLED,
    ]) {
      const job = await insertJob(w, {
        status,
        technicianId: w.sam.id,
        start: at("2026-03-05", "10:00"),
        end: at("2026-03-05", "12:00"),
      });
      const before = await storedJob(job.id);
      const response = await scheduleRequest(
        w,
        job.id,
        scheduleBody({ status }, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
      );
      const error = expectApiError(response, {
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(error.details).toMatchObject({ currentStatus: status });
      expect(await storedJob(job.id)).toEqual(before);
    }
  });

  it("answers stale before it says anything about the technician or the times", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    // Stale, and the technician is inactive: stale is what the screen must hear first.
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(
          { status: "PENDING_SCHEDULING" },
          w.retired.id,
          at(DAY, "13:00"),
          at(DAY, "14:00"),
        ),
      ),
      { status: 409, code: ErrorCode.STALE_STATE },
    );
  });
});

describe("who may schedule", () => {
  it("is for the business only: a customer gets 403, a visitor 401, a cross-origin write 403, and nothing changes", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const url = `${ADMIN_WORK_ORDERS}/${job.id}/schedule`;
    const body = scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const before = await storedJob(job.id);

    expectApiError(await w.client.patch(url, { cookie: w.alexCookie }).send(body), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(await w.client.patch(url).send(body), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(
      await w.client
        .patch(url, { cookie: w.adminCookie, origin: "https://evil.example" })
        .send(body),
      { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH },
    );
    expect(await storedJob(job.id)).toEqual(before);
  });
});

describe("atomicity", () => {
  it("leaves the job unscheduled when the customer's notification cannot be written, then succeeds on a retry", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION refuse_job_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'JOB_SCHEDULED' THEN RAISE EXCEPTION 'refused for the test'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER refuse_job_notification BEFORE INSERT ON notifications
       FOR EACH ROW EXECUTE FUNCTION refuse_job_notification()`,
    );
    try {
      const failed = await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
      );
      expect(failed.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER refuse_job_notification ON notifications");
      await prisma.$executeRawUnsafe("DROP FUNCTION refuse_job_notification()");
    }

    // The booking, its history and its email were all undone together.
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);

    const retry = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
    );
    expect(retry.status).toBe(200);
  });
});
