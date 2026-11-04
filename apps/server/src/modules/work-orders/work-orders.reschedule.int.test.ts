import {
  type AdminWorkOrderDto,
  type CustomerRequestDto,
  ErrorCode,
  SCHEDULE_RULES,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import { dataOf } from "../../test/quotation-world.js";
import {
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
import { RESCHEDULE_REASON_REQUIRED_MESSAGE } from "./work-orders.domain.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const DAY = "2026-03-03";
const REASON = "The part arrives a day late, so we move the visit.";

/** A job scheduled for 10:00 to 12:00 on 3 March with Jordan, ready to be moved. */
async function scheduledJob(w: WorkOrderWorld) {
  const job = await newJob(w);
  const scheduled = await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
  await w.deps.emailDispatcher.idle();
  return scheduled;
}

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

async function footprint(w: WorkOrderWorld) {
  await w.deps.emailDispatcher.idle();
  return {
    events: await prisma.activityEvent.count({ where: { entityType: "WORK_ORDER" } }),
    notifications: await prisma.notification.count({ where: { recipientUserId: w.alex.user.id } }),
    emails: w.emails.sent.length,
  };
}

describe("rescheduling a scheduled job (G.4)", () => {
  it("moves it, keeping the technician, when a reason is given", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
        reason: REASON,
      }),
    );

    expect(response.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
      status: WorkOrderStatus.SCHEDULED,
      scheduledStart: "2026-03-04T19:00:00.000Z",
      scheduledEnd: "2026-03-04T21:00:00.000Z",
      technician: { name: "Jordan Lee" },
    });
  });

  it("needs a reason: none, a blank one, one that is too short or too long is 422 beside the field", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };
    const move = (overrides: Record<string, unknown>) =>
      scheduleRequest(w, job.id, {
        ...scheduleBody(job, w.jordan.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00")),
        ...overrides,
      });

    const missing = expectApiError(await move({}), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(missing.fieldErrors).toEqual({ reason: RESCHEDULE_REASON_REQUIRED_MESSAGE });

    for (const reason of [
      "",
      "   ",
      "abcd",
      "x".repeat(SCHEDULE_RULES.rescheduleReasonMaxLength + 1),
    ]) {
      const error = expectApiError(await move({ reason }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["reason"]);
    }
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);

    // The shortest and the longest allowed reasons both go through.
    expect((await move({ reason: "abcde" })).status).toBe(200);
  });

  it("allows a reason of exactly 200 characters", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const reason = "r".repeat(SCHEDULE_RULES.rescheduleReasonMaxLength);
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
        reason,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("does not take a reason for a first booking", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"), { reason: REASON }),
      ),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["reason"]);
    expect((await storedJob(job.id)).status).toBe("PENDING_SCHEDULING");
  });

  it("records the old and the new time and technician, and the reason, for staff only", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await schedule(w, job, w.sam.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
      reason: REASON,
    });

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "work_order.rescheduled" },
    });
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "WORK_ORDER",
      entityId: job.id,
      fromStatus: "SCHEDULED",
      toStatus: "SCHEDULED",
      summary: `Morgan Reyes rescheduled job ${job.reference} to Wed, Mar 4, 2026, 2:00 – 4:00 PM EST with Sam Ortiz (was Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST). Reason: ${REASON}`,
      publicSummary: "We moved your visit to Wed, Mar 4, 2026, 2:00 – 4:00 PM EST.",
    });
    expect(event.metadata).toEqual({
      workOrderReference: job.reference,
      scheduledStart: "2026-03-04T19:00:00.000Z",
      scheduledEnd: "2026-03-04T21:00:00.000Z",
      technicianId: w.sam.id,
      previousScheduledStart: "2026-03-03T15:00:00.000Z",
      previousScheduledEnd: "2026-03-03T17:00:00.000Z",
      previousTechnicianId: w.jordan.id,
    });
    // The reason is in the staff line only.
    expect(event.publicSummary).not.toContain("part");
    expect(JSON.stringify(event.metadata)).not.toContain("part arrives");
  });

  it("notifies the customer of the new time (JOB_RESCHEDULED), without the reason or the technician", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await schedule(w, job, w.sam.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
      reason: REASON,
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "JOB_RESCHEDULED" },
    });
    expect(notification).toMatchObject({
      recipientUserId: w.alex.user.id,
      title: `Visit for ${job.reference} rescheduled`,
      message: "Your visit has moved to Wed, Mar 4, 2026, 2:00 – 4:00 PM EST.",
      linkPath: `/portal/jobs/${job.id}`,
      entityType: "WORK_ORDER",
      entityId: job.id,
    });
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
    expect(JSON.stringify(notification)).not.toContain("part");
    expect(JSON.stringify(notification)).not.toContain("Sam");
  });

  it("emails the customer the new and the previous time", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = w.emails.sent.length;
    await schedule(w, job, w.jordan.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
      reason: REASON,
    });
    await w.deps.emailDispatcher.idle();

    const sent = w.emails.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "alex.morgan@example.test",
      subject: "Your AC Repair visit has moved",
    });
    expect(sent[0]?.text).toContain("Wed, Mar 4, 2026, 2:00 – 4:00 PM EST");
    expect(sent[0]?.text).toContain("Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    for (const secret of ["part arrives", "Jordan", "Sam"]) {
      expect(sent[0]?.text).not.toContain(secret);
    }
  });

  it("shows the customer's timeline the move and nothing of why", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await schedule(w, job, w.jordan.id, at("2026-03-04", "14:00"), at("2026-03-04", "16:00"), {
      reason: REASON,
    });

    const mine = await w.client.get(`/api/v1/requests/${job.request.id}`, { cookie: w.alexCookie });
    const timeline = dataOf<CustomerRequestDto>(mine).timeline.map((event) => event.publicSummary);
    expect(timeline).toContain("We moved your visit to Wed, Mar 4, 2026, 2:00 – 4:00 PM EST.");
    expect(JSON.stringify(mine.body)).not.toContain("part arrives");
  });

  it("lets the new visit overlap the job's own old one: a shift of half an hour is not a clash", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.jordan.id, at(DAY, "10:30"), at(DAY, "12:30"), { reason: REASON }),
    );
    expect(response.status).toBe(200);
    expect(await prisma.workOrder.count({ where: { status: "SCHEDULED" } })).toBe(1);
  });

  it("frees the old time for another job", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const other = await newJob(w, "priya");
    expectApiError(
      await scheduleRequest(
        w,
        other.id,
        scheduleBody(other, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );

    await schedule(w, job, w.jordan.id, at("2026-03-04", "10:00"), at("2026-03-04", "12:00"), {
      reason: REASON,
    });

    expect(
      (
        await scheduleRequest(
          w,
          other.id,
          scheduleBody(other, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00")),
        )
      ).status,
    ).toBe(200);
  });

  it("refuses a move into someone else's time, and keeps the job where it was", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const busy = await bookedJob(w, w.sam.id, at("2026-03-04", "10:00"), at("2026-03-04", "12:00"));
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.sam.id, at("2026-03-04", "11:00"), at("2026-03-04", "13:00"), {
          reason: REASON,
        }),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    expect(error.details).toMatchObject({ conflictReference: busy.reference });
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("refuses a move that changes nothing, and tells nobody", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"), { reason: REASON }),
      ),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["scheduledStart"]);
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("refuses a stale view of the job with 409 STALE_STATE", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = { job: await storedJob(job.id), footprint: await footprint(w) };

    const error = expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(
          { status: "PENDING_SCHEDULING" },
          w.jordan.id,
          at("2026-03-04", "10:00"),
          at("2026-03-04", "12:00"),
        ),
      ),
      { status: 409, code: ErrorCode.STALE_STATE },
    );
    expect(error.details).toEqual({ currentStatus: "SCHEDULED" });
    expect(await storedJob(job.id)).toEqual(before.job);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("refuses an inactive technician for a reschedule too", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await storedJob(job.id);
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.retired.id, at("2026-03-04", "10:00"), at("2026-03-04", "12:00"), {
          reason: REASON,
        }),
      ),
      { status: 422, code: ErrorCode.TECHNICIAN_INACTIVE },
    );
    expect(await storedJob(job.id)).toEqual(before);
  });

  it("can be done again and again; each move is its own event with the one before it", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await schedule(w, job, w.jordan.id, at("2026-03-04", "10:00"), at("2026-03-04", "12:00"), {
      reason: "First change of plan.",
    });
    await schedule(w, job, w.jordan.id, at("2026-03-05", "10:00"), at("2026-03-05", "12:00"), {
      reason: "Second change of plan.",
    });

    const events = await prisma.activityEvent.findMany({
      where: { action: "work_order.rescheduled" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[1]?.metadata).toMatchObject({
      previousScheduledStart: "2026-03-04T15:00:00.000Z",
      scheduledStart: "2026-03-05T15:00:00.000Z",
    });
    expect(await prisma.notification.count({ where: { type: "JOB_RESCHEDULED" } })).toBe(2);
  });
});

describe("changing only the technician", () => {
  it("is recorded for staff, and the customer, whose date and window are the same, is told nothing", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    const before = await footprint(w);

    const response = await scheduleRequest(
      w,
      job.id,
      scheduleBody(job, w.sam.id, at(DAY, "10:00"), at(DAY, "12:00"), {
        reason: "Jordan is off sick.",
      }),
    );
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(response)).toMatchObject({
      technician: { name: "Sam Ortiz" },
      scheduledStart: "2026-03-03T15:00:00.000Z",
    });
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "work_order.reassigned" },
    });
    expect(event.publicSummary).toBeNull();
    expect(event.summary).toBe(
      `Morgan Reyes changed the technician of job ${job.reference} to Sam Ortiz (was Jordan Lee). Reason: Jordan is off sick.`,
    );
    expect(event.metadata).toMatchObject({
      technicianId: w.sam.id,
      previousTechnicianId: w.jordan.id,
    });
    const after = await footprint(w);
    expect(after.notifications).toBe(before.notifications);
    expect(after.emails).toBe(before.emails);
    expect(after.events).toBe(before.events + 1);
  });

  it("still needs a reason, and still checks the new technician's day", async () => {
    const w = await workOrderWorld(prisma);
    const job = await scheduledJob(w);
    await bookedJob(w, w.sam.id, at(DAY, "11:00"), at(DAY, "13:00"));

    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.sam.id, at(DAY, "10:00"), at(DAY, "12:00")),
      ),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
    expectApiError(
      await scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.sam.id, at(DAY, "10:00"), at(DAY, "12:00"), {
          reason: "Jordan is off sick.",
        }),
      ),
      { status: 409, code: ErrorCode.SCHEDULING_CONFLICT },
    );
    expect((await storedJob(job.id)).technicianId).toBe(w.jordan.id);
  });
});

describe("a job that needs a new time", () => {
  it("is booked again with no reason, and its old time is not held against the new one", async () => {
    const w = await workOrderWorld(prisma);
    const stuck = await insertJob(w, {
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      technicianId: w.jordan.id,
      start: at(DAY, "10:00"),
      end: at(DAY, "12:00"),
    });

    const response = await scheduleRequest(
      w,
      stuck.id,
      scheduleBody(
        { status: "NEEDS_RESCHEDULING" },
        w.jordan.id,
        at(DAY, "11:00"),
        at(DAY, "13:00"),
      ),
    );

    expect(response.status).toBe(200);
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { entityId: stuck.id, action: "work_order.scheduled" },
    });
    // A fresh booking: it keeps no "previous" appointment in its history.
    expect(event.metadata).not.toHaveProperty("previousScheduledStart");
  });
});
