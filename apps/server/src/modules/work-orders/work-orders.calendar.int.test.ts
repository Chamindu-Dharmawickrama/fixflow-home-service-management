import {
  CALENDAR_RULES,
  type CalendarDto,
  ErrorCode,
  WorkOrderAction,
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

const CALENDAR = "/api/v1/admin/calendar";

async function calendar(w: WorkOrderWorld, query: string, cookie = w.adminCookie) {
  return w.client.get(`${CALENDAR}?${query}`, { cookie });
}

async function read(w: WorkOrderWorld, query: string): Promise<CalendarDto> {
  const response = await calendar(w, query);
  expect(response.status).toBe(200);
  return dataOf<CalendarDto>(response);
}

const referencesOf = (result: CalendarDto) => result.items.map((item) => item.reference);

describe("GET /admin/calendar: what it returns (FR-052)", () => {
  it("answers an empty week with the range, the business time zone and nothing else", async () => {
    const w = await workOrderWorld(prisma);
    expect(await read(w, "from=2026-03-02&to=2026-03-08")).toEqual({
      from: "2026-03-02",
      to: "2026-03-08",
      timeZone: "America/New_York",
      items: [],
      truncated: false,
      needsScheduling: [],
      needsSchedulingTotal: 0,
    });
  });

  it("returns the visits of the range, earliest first, with exactly the compact fields", async () => {
    const w = await workOrderWorld(prisma);
    const later = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-04", "14:00"),
      at("2026-03-04", "15:30"),
    );
    const first = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "12:00"),
    );

    const result = await read(w, "from=2026-03-02&to=2026-03-08");

    expect(referencesOf(result)).toEqual([first.reference, later.reference]);
    expect(result.items[0]).toEqual({
      id: first.id,
      reference: first.reference,
      status: WorkOrderStatus.SCHEDULED,
      statusLabel: "Scheduled",
      start: "2026-03-03T15:00:00.000Z",
      end: "2026-03-03T17:00:00.000Z",
      technician: { id: w.jordan.id, name: "Jordan Lee", calendarColor: "blue" },
      customerName: expect.any(String) as string,
      serviceName: "AC Repair",
      city: expect.any(String) as string,
      availableActions: [
        WorkOrderAction.RESCHEDULE,
        WorkOrderAction.START,
        WorkOrderAction.MARK_NEEDS_RESCHEDULING,
        WorkOrderAction.CANCEL,
      ],
    });
    expect(result.items[1]?.technician).toEqual({
      id: w.sam.id,
      name: "Sam Ortiz",
      calendarColor: "green",
    });
  });

  it("never carries what the job page holds: no address, contacts, notes or internal fields", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));
    const result = await read(w, "from=2026-03-03&to=2026-03-03");
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(
      [
        "availableActions",
        "city",
        "customerName",
        "end",
        "id",
        "reference",
        "serviceName",
        "start",
        "status",
        "statusLabel",
        "technician",
      ].sort(),
    );
    expect(Object.keys(result.items[0]?.technician ?? {}).sort()).toEqual(
      ["calendarColor", "id", "name"].sort(),
    );
    const text = JSON.stringify(result);
    for (const secret of [
      "jordan.lee@coolbreeze.test",
      "(212) 555-0151",
      "Larkspur Lane",
      "Senior technician",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("lists scheduled, in-progress and completed visits, and leaves out the rest by default", async () => {
    const w = await workOrderWorld(prisma);
    const day = "2026-03-03";
    const scheduled = await bookedJob(w, w.jordan.id, at(day, "08:00"), at(day, "09:00"));
    const underWay = await bookedJob(
      w,
      w.sam.id,
      at(day, "09:00"),
      at(day, "10:00"),
      WorkOrderStatus.IN_PROGRESS,
    );
    const done = await insertJob(w, {
      status: WorkOrderStatus.COMPLETED,
      technicianId: w.jordan.id,
      start: at(day, "10:00"),
      end: at(day, "11:00"),
    });
    // These have times too (a cancelled job and one that needs a new time keep their old slot).
    await insertJob(w, {
      status: WorkOrderStatus.CANCELLED,
      technicianId: w.jordan.id,
      start: at(day, "11:00"),
      end: at(day, "12:00"),
    });
    await insertJob(w, {
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      technicianId: w.sam.id,
      start: at(day, "12:00"),
      end: at(day, "13:00"),
    });
    await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });

    const result = await read(w, `from=${day}&to=${day}`);
    expect(referencesOf(result)).toEqual([scheduled.reference, underWay.reference, done.reference]);
    expect(result.items.map((item) => item.status)).toEqual([
      WorkOrderStatus.SCHEDULED,
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.COMPLETED,
    ]);
  });

  it("adds cancelled jobs and jobs needing a new time when asked (includeUnbooked=true)", async () => {
    const w = await workOrderWorld(prisma);
    const day = "2026-03-03";
    const scheduled = await bookedJob(w, w.jordan.id, at(day, "08:00"), at(day, "09:00"));
    const cancelled = await insertJob(w, {
      status: WorkOrderStatus.CANCELLED,
      technicianId: w.jordan.id,
      start: at(day, "11:00"),
      end: at(day, "12:00"),
    });
    const needs = await insertJob(w, {
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      technicianId: w.sam.id,
      start: at(day, "12:00"),
      end: at(day, "13:00"),
    });
    // A job that has never had a time cannot be placed on a day, with the flag or without it.
    await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });

    const withFlag = await read(w, `from=${day}&to=${day}&includeUnbooked=true`);
    expect(referencesOf(withFlag)).toEqual([
      scheduled.reference,
      cancelled.reference,
      needs.reference,
    ]);
    expect(withFlag.items.map((item) => item.statusLabel)).toEqual([
      "Scheduled",
      "Cancelled",
      "Needs rescheduling",
    ]);
    // A cancelled job offers no action; the drawer must not offer Reschedule for it.
    expect(withFlag.items[1]?.availableActions).toEqual([]);

    expect(referencesOf(await read(w, `from=${day}&to=${day}&includeUnbooked=false`))).toEqual([
      scheduled.reference,
    ]);
  });

  it("offers Reschedule only for the visits the server says can be moved (D-43)", async () => {
    const w = await workOrderWorld(prisma);
    const day = "2026-03-03";
    await bookedJob(w, w.jordan.id, at(day, "08:00"), at(day, "09:00"));
    await bookedJob(w, w.sam.id, at(day, "09:00"), at(day, "10:00"), WorkOrderStatus.IN_PROGRESS);
    await insertJob(w, {
      status: WorkOrderStatus.COMPLETED,
      technicianId: w.jordan.id,
      start: at(day, "10:00"),
      end: at(day, "11:00"),
    });
    const result = await read(w, `from=${day}&to=${day}`);
    const canMove = result.items.map((item) =>
      item.availableActions.includes(WorkOrderAction.RESCHEDULE),
    );
    expect(canMove).toEqual([true, false, false]);
  });
});

describe("GET /admin/calendar: the range is read on the business's calendar (BR-17)", () => {
  it("includes a visit at the first instant of the first day and the last minute of the last", async () => {
    const w = await workOrderWorld(prisma);
    // New York is UTC-5 in early March: local midnight is 05:00Z.
    const midnight = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-02", "00:00"),
      at("2026-03-02", "01:00"),
    );
    const lateSunday = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-08", "00:30"),
      at("2026-03-08", "01:30"),
    );
    const lastMinute = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-01", "23:00"),
      at("2026-03-01", "23:59"),
    );
    const result = await read(w, "from=2026-03-02&to=2026-03-02");
    expect(referencesOf(result)).toEqual([midnight.reference]);
    expect(referencesOf(await read(w, "from=2026-03-08&to=2026-03-08"))).toEqual([
      lateSunday.reference,
    ]);
    expect(referencesOf(await read(w, "from=2026-03-01&to=2026-03-01"))).toEqual([
      lastMinute.reference,
    ]);
  });

  it("puts a 21:00 evening visit on its business day even though it is the next day in UTC", async () => {
    const w = await workOrderWorld(prisma);
    // 21:00 on 3 March in New York is 02:00Z on 4 March.
    const evening = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-03", "21:00"),
      at("2026-03-03", "22:00"),
    );
    expect(evening).toBeDefined();
    expect(referencesOf(await read(w, "from=2026-03-03&to=2026-03-03"))).toEqual([
      evening.reference,
    ]);
    expect(referencesOf(await read(w, "from=2026-03-04&to=2026-03-04"))).toEqual([]);
  });

  it("splits the day the clocks go forward correctly (8 March 2026, 23 hours long)", async () => {
    const w = await workOrderWorld(prisma);
    const early = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-08", "01:00"),
      at("2026-03-08", "01:30"),
    );
    // 03:00 EDT is the first hour after the change: UTC-4.
    const afterChange = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-08", "03:00"),
      at("2026-03-08", "04:00"),
    );
    const lastNight = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-08", "23:30"),
      at("2026-03-09", "00:30"),
    );
    const nextMorning = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-09", "00:00"),
      at("2026-03-09", "01:00"),
    );

    expect(referencesOf(await read(w, "from=2026-03-08&to=2026-03-08"))).toEqual([
      early.reference,
      afterChange.reference,
      lastNight.reference,
    ]);
    expect(referencesOf(await read(w, "from=2026-03-09&to=2026-03-09"))).toEqual([
      nextMorning.reference,
    ]);
  });

  it("splits the day the clocks go back correctly (1 November 2026, 25 hours long)", async () => {
    const w = await workOrderWorld(prisma);
    const first = await bookedJob(
      w,
      w.jordan.id,
      at("2026-11-01", "00:30"),
      at("2026-11-01", "01:00"),
    );
    const evening = await bookedJob(
      w,
      w.jordan.id,
      at("2026-11-01", "23:30"),
      at("2026-11-02", "00:00"),
    );
    const next = await bookedJob(w, w.sam.id, at("2026-11-02", "00:00"), at("2026-11-02", "01:00"));

    expect(referencesOf(await read(w, "from=2026-11-01&to=2026-11-01"))).toEqual([
      first.reference,
      evening.reference,
    ]);
    expect(referencesOf(await read(w, "from=2026-11-02&to=2026-11-02"))).toEqual([next.reference]);
    // A week that holds the change gets all three.
    expect(referencesOf(await read(w, "from=2026-10-26&to=2026-11-01"))).toEqual([
      first.reference,
      evening.reference,
    ]);
    expect(referencesOf(await read(w, "from=2026-11-01&to=2026-11-07"))).toEqual([
      first.reference,
      evening.reference,
      next.reference,
    ]);
  });

  it("matches a visit by its start: one that starts before the range is not in it", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at("2026-03-02", "23:00"), at("2026-03-03", "01:00"));
    expect(referencesOf(await read(w, "from=2026-03-03&to=2026-03-03"))).toEqual([]);
  });
});

describe("GET /admin/calendar: the technician filter", () => {
  it("returns one technician's visits, and an unknown technician has none (not a 404)", async () => {
    const w = await workOrderWorld(prisma);
    const jordans = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "11:00"),
    );
    await bookedJob(w, w.sam.id, at("2026-03-03", "10:00"), at("2026-03-03", "11:00"));

    expect(
      referencesOf(await read(w, `from=2026-03-03&to=2026-03-03&technicianId=${w.jordan.id}`)),
    ).toEqual([jordans.reference]);
    expect(
      referencesOf(
        await read(
          w,
          "from=2026-03-03&to=2026-03-03&technicianId=00000000-0000-4000-8000-000000000000",
        ),
      ),
    ).toEqual([]);
  });

  it("shows a deactivated technician's past visits (they stay in history)", async () => {
    const w = await workOrderWorld(prisma);
    const done = await insertJob(w, {
      status: WorkOrderStatus.COMPLETED,
      technicianId: w.retired.id,
      start: at("2026-03-03", "10:00"),
      end: at("2026-03-03", "11:00"),
    });
    const result = await read(w, "from=2026-03-03&to=2026-03-03");
    expect(referencesOf(result)).toEqual([done.reference]);
    expect(result.items[0]?.technician?.name).toBe("Rae Retired");
  });
});

describe("GET /admin/calendar: jobs waiting for a time", () => {
  it("lists new jobs and jobs needing a new time, whatever the range or the technician", async () => {
    const w = await workOrderWorld(prisma);
    const older = await insertJob(w, {
      status: WorkOrderStatus.PENDING_SCHEDULING,
      createdAt: new Date("2026-02-20T10:00:00.000Z"),
    });
    const newer = await insertJob(w, {
      status: WorkOrderStatus.PENDING_SCHEDULING,
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
    });
    const needs = await insertJob(w, {
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      technicianId: w.sam.id,
      start: at("2026-03-03", "10:00"),
      end: at("2026-03-03", "11:00"),
      createdAt: new Date("2026-02-28T10:00:00.000Z"),
    });
    // Not waiting: scheduled, finished and cancelled.
    await bookedJob(w, w.jordan.id, at("2026-03-04", "10:00"), at("2026-03-04", "11:00"));
    await insertJob(w, { status: WorkOrderStatus.CANCELLED });

    // An empty range and a technician who owns none of them: the list is the same.
    const result = await read(w, `from=2030-01-01&to=2030-01-07&technicianId=${w.jordan.id}`);
    expect(result.items).toEqual([]);
    // The job that already had a time comes first; then the longest waiting.
    expect(result.needsScheduling.map((job) => job.reference)).toEqual([
      needs.reference,
      older.reference,
      newer.reference,
    ]);
    expect(result.needsSchedulingTotal).toBe(3);
    expect(result.needsScheduling[0]).toEqual({
      id: needs.id,
      reference: needs.reference,
      status: WorkOrderStatus.NEEDS_RESCHEDULING,
      statusLabel: "Needs rescheduling",
      serviceName: "AC Repair",
      customerName: expect.any(String) as string,
      city: expect.any(String) as string,
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T16:00:00.000Z",
      technician: { id: w.sam.id, name: "Sam Ortiz", calendarColor: "green" },
    });
    expect(result.needsScheduling[1]).toMatchObject({
      status: WorkOrderStatus.PENDING_SCHEDULING,
      scheduledStart: null,
      scheduledEnd: null,
      technician: null,
    });
  });

  it("holds at most 20 and still counts them all", async () => {
    const w = await workOrderWorld(prisma);
    const total = CALENDAR_RULES.maxNeedsScheduling + 2;
    for (let index = 0; index < total; index += 1) {
      await insertJob(w, {
        status: WorkOrderStatus.PENDING_SCHEDULING,
        createdAt: new Date(Date.UTC(2026, 1, 1, 8, index)),
      });
    }
    const result = await read(w, "from=2026-03-02&to=2026-03-08");
    expect(result.needsScheduling).toHaveLength(CALENDAR_RULES.maxNeedsScheduling);
    expect(result.needsSchedulingTotal).toBe(total);
  });
});

describe("GET /admin/calendar: the range limits", () => {
  it("accepts exactly 42 days (six weeks) and one single day", async () => {
    const w = await workOrderWorld(prisma);
    expect((await calendar(w, "from=2026-03-02&to=2026-04-12")).status).toBe(200);
    expect((await calendar(w, "from=2026-03-02&to=2026-03-02")).status).toBe(200);
  });

  it("refuses 43 days with a 422 that names the end of the range", async () => {
    const w = await workOrderWorld(prisma);
    const error = expectApiError(await calendar(w, "from=2026-03-02&to=2026-04-13"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(error.fieldErrors).toEqual({ to: "The range can be at most 42 days." });
  });

  it.each([
    ["an end before the start", "from=2026-03-08&to=2026-03-02", "to"],
    ["no dates", "", "from"],
    ["no end", "from=2026-03-02", "to"],
    ["a date that does not exist", "from=2026-02-30&to=2026-03-02", "from"],
    ["a time instead of a date", "from=2026-03-02T00:00:00Z&to=2026-03-08", "from"],
    ["text for a date", "from=today&to=tomorrow", "from"],
  ])("refuses %s with a 422", async (_name, query, field) => {
    const w = await workOrderWorld(prisma);
    const error = expectApiError(await calendar(w, query), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(error.fieldErrors).toHaveProperty(field);
  });

  it.each(["technicianId=nope", "includeUnbooked=yes", "includeUnbooked=1"])(
    "refuses a bad filter (%s) with a 422",
    async (filter) => {
      const w = await workOrderWorld(prisma);
      expect((await calendar(w, `from=2026-03-02&to=2026-03-08&${filter}`)).status).toBe(422);
    },
  );
});

describe("GET /admin/calendar: who may read it", () => {
  it("is for the business only: a customer gets 403 and a visitor 401", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "11:00"));
    const url = `${CALENDAR}?from=2026-03-02&to=2026-03-08`;
    for (const cookie of [w.alexCookie, w.priyaCookie]) {
      expectApiError(await w.client.get(url, { cookie }), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }
    expectApiError(await w.client.get(url), { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it("changes nothing: reading twice gives the same answer and writes no history", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "11:00"));
    const events = await prisma.activityEvent.count();
    const first = await read(w, "from=2026-03-02&to=2026-03-08");
    const second = await read(w, "from=2026-03-02&to=2026-03-08");
    expect(second).toEqual(first);
    expect(await prisma.activityEvent.count()).toBe(events);
  });
});
