import { randomInt } from "node:crypto";

import { addDaysToDateOnly } from "@fixflow/shared";
import { test } from "@playwright/test";

import { withDatabase } from "./accounts.js";
import { createJobFor } from "./customers.js";
import { createBookedJobFor, instantAt } from "./jobs.js";

/**
 * Helpers for the calendar specs (T19). The calendar shows the whole business's visits, and the other
 * specs book jobs on random days up to 800 days from now and leave them behind, so a calendar spec
 * must not read a week the others may have used. Each test gets a week of its own, far past theirs
 * (2032 to 2039). The weeks are split into eight bands of a year, one for each worker process (a
 * worker that is restarted after a failure is a new process with a new index), and within its band a
 * test draws a week at random and takes it only if the E2E database holds no job in or around it, so
 * even the leftovers of a failed test are never read by the next one. A test that needs exact contents
 * also filters by its own technician.
 */

/** A Monday: 5 January 2032. Every week handed out is a whole number of weeks after it. */
const FIRST_MONDAY = "2032-01-05";
const WEEKS_PER_BAND = 52;
const BANDS = 8;

/** The Monday of a week no other test in this run reads (call it from inside a test). */
export async function ownWeek(): Promise<string> {
  const band = test.info().workerIndex % BANDS;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const monday = addDaysToDateOnly(
      FIRST_MONDAY,
      (band * WEEKS_PER_BAND + randomInt(0, WEEKS_PER_BAND)) * 7,
    );
    // A day either side, so a visit that runs past midnight into the week is found too.
    const from = instantAt(addDaysToDateOnly(monday, -1), "00:00");
    const before = instantAt(addDaysToDateOnly(monday, 8), "00:00");
    const used = await withDatabase((prisma) =>
      prisma.workOrder.count({ where: { scheduledStart: { gte: from, lt: before } } }),
    );
    if (used === 0) return monday;
  }
  throw new Error("No empty week left in this worker's band of the calendar.");
}

/** The day `offset` days after `monday`: 0 is Monday, 1 is Tuesday, … 6 is Sunday. */
export function dayOfWeek(monday: string, offset: number): string {
  return addDaysToDateOnly(monday, offset);
}

/**
 * A job waiting for a time. It is made to look as if it had waited since 2001, so it comes first in
 * the "needs scheduling" panel, which is capped and lists the longest-waiting first: the panel is the
 * whole business's, and without this a test's job could fall outside the first twenty.
 */
export async function createWaitingJobFor(
  customerUserId: string,
  status: "PENDING_SCHEDULING" | "NEEDS_RESCHEDULING" = "PENDING_SCHEDULING",
) {
  const job = await createJobFor(customerUserId, { status });
  await withDatabase((prisma) =>
    prisma.workOrder.update({
      where: { id: job.jobId },
      data: { createdAt: new Date(Date.UTC(2001, 0, 1, 0, 0, test.info().parallelIndex)) },
    }),
  );
  return job;
}

/** A booked job with another status (`IN_PROGRESS`, `COMPLETED`, `CANCELLED`), for the block's look. */
export async function createVisitWithStatus(
  customerUserId: string,
  technicianId: string,
  date: string,
  from: string,
  to: string,
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NEEDS_RESCHEDULING",
) {
  const job = await createBookedJobFor(customerUserId, technicianId, date, from, to);
  await withDatabase((prisma) =>
    prisma.workOrder.update({
      where: { id: job.jobId },
      data: {
        status,
        ...(status === "COMPLETED" && { completedAt: new Date() }),
        ...(status === "CANCELLED" && { cancelledAt: new Date(), cancelReason: "Customer moved." }),
      },
    }),
  );
  return job;
}

/** Makes a booked job end on a later day: a visit that runs past midnight. */
export async function extendPastMidnight(jobId: string, endDate: string, endTime: string) {
  await withDatabase((prisma) =>
    prisma.workOrder.update({
      where: { id: jobId },
      data: { scheduledEnd: instantAt(endDate, endTime) },
    }),
  );
}
