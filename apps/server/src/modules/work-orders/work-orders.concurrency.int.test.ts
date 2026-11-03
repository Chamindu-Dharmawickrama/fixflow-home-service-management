import { type AdminWorkOrderDto, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf } from "../../test/http.js";
import { dataOf } from "../../test/quotation-world.js";
import {
  at,
  newJob,
  schedule,
  scheduleBody,
  scheduleRequest,
  type WorkOrderWorld,
  workOrderWorld,
} from "../../test/work-order-world.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/** Days that are all ordinary (no change of the clocks), after the fake clock's 2 March. */
const DAYS = ["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09", "2026-03-10"];

async function jobs(w: WorkOrderWorld, count: number) {
  const made: AdminWorkOrderDto[] = [];
  for (let index = 0; index < count; index += 1) {
    made.push(await newJob(w, index % 2 === 0 ? "alex" : "priya"));
  }
  return made;
}

function codeOf(response: { body: unknown }): string | undefined {
  return bodyOf<{ error?: { code: string } }>(response as never).error?.code;
}

describe("two overlapping schedules for one technician at the same moment (SEC-TXN-02)", () => {
  it("lets exactly one succeed and refuses the other, round after round", async () => {
    const w = await workOrderWorld(prisma);

    for (const day of DAYS) {
      const [first, second] = await jobs(w, 2);
      if (first === undefined || second === undefined) throw new Error("no jobs");

      // The two visits overlap (10:00 to 12:00 and 11:00 to 13:00); both want Jordan.
      const [a, b] = await Promise.all([
        scheduleRequest(
          w,
          first.id,
          scheduleBody(first, w.jordan.id, at(day, "10:00"), at(day, "12:00")),
        ),
        scheduleRequest(
          w,
          second.id,
          scheduleBody(second, w.jordan.id, at(day, "11:00"), at(day, "13:00")),
        ),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const refused = a.status === 409 ? a : b;
      expect(codeOf(refused)).toBe(ErrorCode.SCHEDULING_CONFLICT);
      // Exactly one of the two is booked, and the loser was left exactly as it was.
      const rows = await prisma.workOrder.findMany({
        where: { id: { in: [first.id, second.id] } },
        orderBy: { reference: "asc" },
      });
      expect(rows.filter((row) => row.status === "SCHEDULED")).toHaveLength(1);
      expect(rows.filter((row) => row.status === "PENDING_SCHEDULING")).toHaveLength(1);
      expect(rows.find((row) => row.status === "PENDING_SCHEDULING")).toMatchObject({
        technicianId: null,
        scheduledStart: null,
      });
    }

    // Across all six rounds: six bookings, none overlapping another.
    const booked = await prisma.workOrder.findMany({ where: { status: "SCHEDULED" } });
    expect(booked).toHaveLength(DAYS.length);
  });

  it("lets exactly one of four overlapping schedules succeed", async () => {
    const w = await workOrderWorld(prisma);
    const four = await jobs(w, 4);
    const day = "2026-03-03";
    // Every pair overlaps (the last starts before the first ends): a pair that merely touched,
    // like 09:00-11:00 and 11:00-13:00, may both be booked, and the answer would depend on who wins.
    const windows = [
      ["10:00", "12:00"],
      ["10:30", "12:30"],
      ["11:00", "13:00"],
      ["11:30", "13:30"],
    ] as const;

    const responses = await Promise.all(
      four.map((job, index) => {
        const [from, to] = windows[index] ?? windows[0];
        return scheduleRequest(
          w,
          job.id,
          scheduleBody(job, w.jordan.id, at(day, from), at(day, to)),
        );
      }),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    const refused = responses.filter((r) => r.status !== 200);
    expect(refused).toHaveLength(3);
    for (const response of refused) {
      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe(ErrorCode.SCHEDULING_CONFLICT);
    }
    expect(await prisma.workOrder.count({ where: { status: "SCHEDULED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { action: "work_order.scheduled" } })).toBe(1);
  });

  it("lets back-to-back schedules for one technician both succeed at once", async () => {
    const w = await workOrderWorld(prisma);
    const [first, second] = await jobs(w, 2);
    if (first === undefined || second === undefined) throw new Error("no jobs");

    const [a, b] = await Promise.all([
      scheduleRequest(
        w,
        first.id,
        scheduleBody(first, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00")),
      ),
      scheduleRequest(
        w,
        second.id,
        scheduleBody(second, w.jordan.id, at("2026-03-03", "12:00"), at("2026-03-03", "14:00")),
      ),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it("lets two technicians take the same hour at once", async () => {
    const w = await workOrderWorld(prisma);
    const [first, second] = await jobs(w, 2);
    if (first === undefined || second === undefined) throw new Error("no jobs");

    const [a, b] = await Promise.all([
      scheduleRequest(
        w,
        first.id,
        scheduleBody(first, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00")),
      ),
      scheduleRequest(
        w,
        second.id,
        scheduleBody(second, w.sam.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00")),
      ),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it("keeps a reschedule and a new booking from taking the same time", async () => {
    const w = await workOrderWorld(prisma);
    const [mover, newcomer] = await jobs(w, 2);
    if (mover === undefined || newcomer === undefined) throw new Error("no jobs");
    const booked = await schedule(
      w,
      mover,
      w.jordan.id,
      at("2026-03-03", "08:00"),
      at("2026-03-03", "09:00"),
    );

    // The booked job moves into 10:00 to 12:00 while the other is booked into 11:00 to 13:00.
    const [a, b] = await Promise.all([
      scheduleRequest(
        w,
        booked.id,
        scheduleBody(booked, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"), {
          reason: "Moving it later in the day.",
        }),
      ),
      scheduleRequest(
        w,
        newcomer.id,
        scheduleBody(newcomer, w.jordan.id, at("2026-03-03", "11:00"), at("2026-03-03", "13:00")),
      ),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe("two schedules of the same job at the same moment", () => {
  it("books it once when the same request is sent twice (a double click)", async () => {
    const w = await workOrderWorld(prisma);
    const [job] = await jobs(w, 1);
    if (job === undefined) throw new Error("no job");
    const body = scheduleBody(
      job,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "12:00"),
    );

    const [a, b] = await Promise.all([
      scheduleRequest(w, job.id, body),
      scheduleRequest(w, job.id, body),
    ]);
    await w.deps.emailDispatcher.idle();

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(codeOf(refused)).toBe(ErrorCode.STALE_STATE);
    expect(await prisma.activityEvent.count({ where: { action: "work_order.scheduled" } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "JOB_SCHEDULED" } })).toBe(1);
    expect(w.emails.sent.filter((mail) => mail.subject.includes("is scheduled"))).toHaveLength(1);
  });

  it("books it with one technician when two admins choose different ones", async () => {
    const w = await workOrderWorld(prisma);
    const [job] = await jobs(w, 1);
    if (job === undefined) throw new Error("no job");

    const [a, b] = await Promise.all([
      scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00")),
      ),
      scheduleRequest(
        w,
        job.id,
        scheduleBody(job, w.sam.id, at("2026-03-03", "14:00"), at("2026-03-03", "16:00")),
      ),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    // What is stored is exactly what the winner was told: not a mixture of the two.
    expect(stored.technicianId).toBe(dataOf<AdminWorkOrderDto>(winner).technician?.id);
    expect(stored.scheduledStart?.toISOString()).toBe(
      dataOf<AdminWorkOrderDto>(winner).scheduledStart,
    );
    // Only the winner's technician holds any time.
    const holders = await prisma.workOrder.count({ where: { technicianId: { not: null } } });
    expect(holders).toBe(1);
  });

  it("applies two reschedules one after the other, and the job ends up as the later one left it", async () => {
    const w = await workOrderWorld(prisma);
    const [job] = await jobs(w, 1);
    if (job === undefined) throw new Error("no job");
    const booked = await schedule(
      w,
      job,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "12:00"),
    );

    const [a, b] = await Promise.all([
      scheduleRequest(
        w,
        booked.id,
        scheduleBody(booked, w.jordan.id, at("2026-03-04", "10:00"), at("2026-03-04", "12:00"), {
          reason: "The customer asked for Wednesday.",
        }),
      ),
      scheduleRequest(
        w,
        booked.id,
        scheduleBody(booked, w.jordan.id, at("2026-03-05", "10:00"), at("2026-03-05", "12:00"), {
          reason: "The customer asked for Thursday.",
        }),
      ),
    ]);

    // Both are valid one after the other; neither is lost, and the history says which came last.
    expect([a.status, b.status]).toEqual([200, 200]);
    const events = await prisma.activityEvent.findMany({
      where: { action: "work_order.rescheduled" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(events).toHaveLength(2);
    const last = events[1]?.metadata as { scheduledStart: string };
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.scheduledStart?.toISOString()).toBe(last.scheduledStart);
    // And the second saw the first's result as its "previous" time.
    expect(events[1]?.metadata).toMatchObject({
      previousScheduledStart: (events[0]?.metadata as { scheduledStart: string }).scheduledStart,
    });
  });
});

describe("a schedule racing a technician's deactivation", () => {
  it("either books them before they were deactivated or is refused, never both", async () => {
    const w = await workOrderWorld(prisma);
    const outcomes = new Set<string>();

    for (const day of DAYS.slice(0, 4)) {
      const technician = await prisma.technician.create({
        data: { name: `Race ${day}`, calendarColor: "teal", isActive: true },
      });
      const [job] = await jobs(w, 1);
      if (job === undefined) throw new Error("no job");

      const [booking, deactivation] = await Promise.all([
        scheduleRequest(
          w,
          job.id,
          scheduleBody(job, technician.id, at(day, "10:00"), at(day, "12:00")),
        ),
        w.client.post(`/api/v1/admin/technicians/${technician.id}/deactivate`, {
          cookie: w.adminCookie,
        }),
      ]);

      expect(deactivation.status).toBe(200);
      const stored = await prisma.technician.findUniqueOrThrow({ where: { id: technician.id } });
      expect(stored.isActive).toBe(false);
      if (booking.status === 200) {
        outcomes.add("booked");
        // Booked before the deactivation: the job stays with them (the deactivation never touches jobs).
        expect(
          (await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } })).technicianId,
        ).toBe(technician.id);
      } else {
        outcomes.add("refused");
        expect(codeOf(booking)).toBe(ErrorCode.TECHNICIAN_INACTIVE);
        expect(
          (await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } })).technicianId,
        ).toBeNull();
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });
});
