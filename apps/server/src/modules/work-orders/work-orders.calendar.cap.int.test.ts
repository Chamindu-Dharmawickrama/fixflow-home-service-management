import type * as SharedModule from "@fixflow/shared";
import { type CalendarDto, WorkOrderStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { dataOf } from "../../test/quotation-world.js";
import { at, bookedJob, workOrderWorld } from "../../test/work-order-world.js";

// The real cap is 500 visits: inserting 501 jobs (each with its own request and quotation) would make
// this one test slower than the rest of the suite together. The cap is a constant the service reads,
// so it is lowered here to exercise the real code path; `calendar.test.ts` in the shared package pins
// the real number.
vi.mock("@fixflow/shared", async (importOriginal) => {
  const original = await importOriginal<typeof SharedModule>();
  return {
    ...original,
    CALENDAR_RULES: { ...original.CALENDAR_RULES, maxItems: 3, maxNeedsScheduling: 2 },
  };
});

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function read(w: Awaited<ReturnType<typeof workOrderWorld>>) {
  const response = await w.client.get("/api/v1/admin/calendar?from=2026-03-02&to=2026-03-08", {
    cookie: w.adminCookie,
  });
  expect(response.status).toBe(200);
  return dataOf<CalendarDto>(response);
}

describe("GET /admin/calendar: the cap on visits", () => {
  it("says so when the range holds more than the cap, and keeps the earliest ones", async () => {
    const w = await workOrderWorld(prisma);
    const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];
    const jobs = [];
    for (const day of days) {
      jobs.push(await bookedJob(w, w.jordan.id, at(day, "10:00"), at(day, "11:00")));
    }
    const result = await read(w);
    expect(result.truncated).toBe(true);
    expect(result.items.map((item) => item.reference)).toEqual(
      jobs.slice(0, 3).map((job) => job.reference),
    );
  });

  it("is not truncated when the range holds exactly the cap", async () => {
    const w = await workOrderWorld(prisma);
    for (const day of ["2026-03-02", "2026-03-03", "2026-03-04"]) {
      await bookedJob(w, w.jordan.id, at(day, "10:00"), at(day, "11:00"));
    }
    const result = await read(w);
    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("caps the waiting list but counts every waiting job", async () => {
    const w = await workOrderWorld(prisma);
    for (let index = 0; index < 3; index += 1) {
      await bookedJob(
        w,
        w.sam.id,
        at("2026-04-01", "09:00"),
        at("2026-04-01", "10:00"),
        WorkOrderStatus.NEEDS_RESCHEDULING,
      );
    }
    const result = await read(w);
    expect(result.needsScheduling).toHaveLength(2);
    expect(result.needsSchedulingTotal).toBe(3);
  });
});
