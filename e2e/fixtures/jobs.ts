import { randomInt } from "node:crypto";

import { wallClockToInstant } from "@fixflow/shared";

import { withDatabase } from "./accounts.js";
import { createJobFor } from "./customers.js";
import { BUSINESS_TIME_ZONE, businessDay, createSentQuotationFor } from "./quotations.js";
import { insertTechnician } from "./technicians.js";

/**
 * Helpers for the job and scheduling specs (T17), in the style of the other fixtures: the specs make
 * the accepted quotations they need by inserting rows in the E2E database, drive the screens as a
 * person would, and check what was stored. Nothing here is a test-only endpoint of the product.
 *
 * The specs run in parallel on one database, and the seeded technicians are shared, so each test
 * books its technician on a day of its own, far enough ahead to be clear of every other spec's.
 */

export { BUSINESS_TIME_ZONE };

/** A day on the business's calendar that no other test is likely to use: 100 to 800 days ahead. */
export function uniqueFutureDay(): string {
  return businessDay(randomInt(100, 800));
}

/** `HH:mm` on `date` on the business's clocks, as the instant the product stores. */
export function instantAt(date: string, time: string): Date {
  const instant = wallClockToInstant(date, time, BUSINESS_TIME_ZONE);
  if (instant === null) {
    throw new Error(`${date} ${time} does not exist in ${BUSINESS_TIME_ZONE}.`);
  }
  return instant;
}

/**
 * A quotation the customer has accepted, as T15 leaves it: the quotation `ACCEPTED` with who answered
 * and when, and the request `ACCEPTED`. It is inserted as a sent quotation and then answered in the
 * database, so a spec starts exactly where "Create job" becomes available.
 */
export async function createAcceptedQuotationFor(
  customerUserId: string,
  options: { serviceName?: string; accessNotes?: string } = {},
) {
  const inserted = await createSentQuotationFor(customerUserId, {
    ...(options.serviceName !== undefined && { serviceName: options.serviceName }),
  });
  await withDatabase(async (prisma) => {
    const respondedAt = new Date();
    await prisma.quotation.update({
      where: { id: inserted.quotation.id },
      data: { status: "ACCEPTED", respondedAt, respondedByUserId: customerUserId },
    });
    await prisma.serviceRequest.update({
      where: { id: inserted.request.id },
      data: {
        status: "ACCEPTED",
        ...(options.accessNotes !== undefined && { accessNotesSnapshot: options.accessNotes }),
      },
    });
  });
  return inserted;
}

/** The seeded technician with this name (the demo team is seeded with the base data). */
export async function seededTechnician(name: string) {
  return withDatabase((prisma) => prisma.technician.findFirstOrThrow({ where: { name } }));
}

/** A job that is already booked: Jordan, or whoever is given, from `start` to `end` on `date` (business clocks). */
export async function createBookedJobFor(
  customerUserId: string,
  technicianId: string,
  date: string,
  from: string,
  to: string,
) {
  const start = instantAt(date, from);
  const job = await createJobFor(customerUserId, { status: "SCHEDULED", scheduledStart: start });
  await withDatabase((prisma) =>
    prisma.workOrder.update({
      where: { id: job.jobId },
      data: { technicianId, scheduledEnd: instantAt(date, to) },
    }),
  );
  return job;
}

/** The job made from a request, as stored, or `null` if there is none. */
export async function workOrderOf(requestId: string) {
  return withDatabase((prisma) => prisma.workOrder.findUnique({ where: { requestId } }));
}

/** A job as stored, by id. */
export async function workOrderById(id: string) {
  return withDatabase((prisma) => prisma.workOrder.findUniqueOrThrow({ where: { id } }));
}

/** How many jobs exist for a request (always 0 or 1: the database allows no more). */
export async function countWorkOrdersOf(requestId: string): Promise<number> {
  return withDatabase((prisma) => prisma.workOrder.count({ where: { requestId } }));
}

/** The events recorded for a job, oldest first, with both voices of the sentence. */
export async function jobEventsOf(jobId: string) {
  return withDatabase((prisma) =>
    prisma.activityEvent.findMany({
      where: { entityType: "WORK_ORDER", entityId: jobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        action: true,
        summary: true,
        publicSummary: true,
        fromStatus: true,
        toStatus: true,
        metadata: true,
      },
    }),
  );
}

/** The request as stored: its status after the job was made. */
export async function requestStatusOf(requestId: string): Promise<string> {
  return withDatabase(async (prisma) => {
    const row = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    return row.status;
  });
}

/** The customer's notifications about their jobs, newest first. */
export async function jobNotificationsFor(customerUserId: string) {
  return withDatabase((prisma) =>
    prisma.notification.findMany({
      where: {
        recipientUserId: customerUserId,
        type: { in: ["JOB_SCHEDULED", "JOB_RESCHEDULED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { type: true, title: true, message: true, linkPath: true },
    }),
  );
}

/** Runs a query against the E2E database, for the fixtures a spec needs to adjust (long text, odd states). */
export { withDatabase as withDatabaseQuery } from "./accounts.js";

/**
 * A technician made for one test, named "Jordan Lee <tag>" with a tag no other test has, so the test
 * books its own diary. The seeded technicians are shared by every spec running in parallel, and a
 * random "unique" day is not isolation: two specs drawing the same day and an overlapping hour made
 * one conflict line read "... and 1 more". Remove them afterwards with `deleteTechniciansTagged`.
 */
export async function ownTechnician(tag: string) {
  return insertTechnician(tag, { name: `Jordan Lee ${tag}`, calendarColor: "blue" });
}
