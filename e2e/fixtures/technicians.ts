import { randomBytes } from "node:crypto";

import type { Prisma } from "../../apps/server/src/generated/prisma/client.js";
import { createTechnician } from "../../apps/server/src/test/fixtures.js";
import { withDatabase } from "./accounts.js";
import { createJobFor, type InsertedJob } from "./customers.js";

/**
 * Helpers for the technician specs (T16). Like the other fixtures they talk to the E2E database
 * directly: the specs make technicians through the real screens or insert them here, and clean up
 * here, because the product never deletes a technician. The seeded demo technicians are only read.
 *
 * Every technician a spec makes carries a unique tag in its name, so the specs (which run in
 * parallel on one database) find their own people again and clean up only those.
 */

/** A word no other test or run shares. */
export function newTechnicianTag(): string {
  return randomBytes(4).toString("hex");
}

/** Inserts an active technician whose name contains `tag`. */
export async function insertTechnician(
  tag: string,
  overrides: Partial<Prisma.TechnicianUncheckedCreateInput> = {},
) {
  return withDatabase((prisma) =>
    createTechnician(prisma, { name: `Casey Brooks ${tag}`, ...overrides }),
  );
}

/** The technician with exactly this name, as stored. */
export async function technicianNamed(name: string) {
  return withDatabase((prisma) => prisma.technician.findFirst({ where: { name } }));
}

/** A day offset from now at 15:00 UTC: far from any business-day edge in New York. */
export function inDays(days: number): Date {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(15, 0, 0, 0);
  return date;
}

/**
 * Gives a technician a job for `customerUserId` that starts at `start` and lasts two hours. The
 * job is made with the same fixture the customer specs use, then assigned.
 */
export async function assignJob(
  technicianId: string,
  customerUserId: string,
  start: Date,
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" = "SCHEDULED",
): Promise<InsertedJob> {
  const job = await createJobFor(customerUserId, { status, scheduledStart: start });
  await withDatabase((prisma) =>
    prisma.workOrder.update({ where: { id: job.jobId }, data: { technicianId } }),
  );
  return job;
}

/** Every job assigned to a technician, whole, to compare before and after something that must not touch them. */
export async function jobsOf(technicianId: string) {
  return withDatabase((prisma) =>
    prisma.workOrder.findMany({ where: { technicianId }, orderBy: { reference: "asc" } }),
  );
}

/** The history lines about a technician, oldest first. */
export async function eventsAbout(technicianId: string) {
  return withDatabase((prisma) =>
    prisma.activityEvent.findMany({
      where: { entityType: "TECHNICIAN", entityId: technicianId },
      orderBy: { createdAt: "asc" },
      select: { action: true, summary: true, publicSummary: true, metadata: true },
    }),
  );
}

/** Removes the technicians whose name contains `tag`, after letting go of the jobs assigned to them. */
export async function deleteTechniciansTagged(tag: string): Promise<number> {
  if (!/^[0-9a-f]{8}$/.test(tag)) {
    throw new Error("Refusing to delete technicians by something that is not a fixture tag.");
  }
  return withDatabase(async (prisma) => {
    const found = await prisma.technician.findMany({
      where: { name: { contains: tag } },
      select: { id: true },
    });
    const ids = found.map((technician) => technician.id);
    await prisma.workOrder.updateMany({
      where: { technicianId: { in: ids } },
      data: { technicianId: null },
    });
    const result = await prisma.technician.deleteMany({ where: { id: { in: ids } } });
    return result.count;
  });
}
