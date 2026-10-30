import { randomBytes } from "node:crypto";

import type { NoteVisibility, ServiceRequestStatus } from "@fixflow/shared";

import { nextReference } from "../../apps/server/src/lib/references.js";
import { createService, createServiceRequest } from "../../apps/server/src/test/fixtures.js";
import { withDatabase } from "./accounts.js";
import { E2E_SERVICE_PREFIX } from "./catalogue.js";

/**
 * Service-request scenarios for the E2E suite (T11): rows inserted straight into the E2E database
 * and read back from it, as the rest of the fixtures are (CLAUDE.md §11). There is no test-only
 * endpoint in the product. Customers are created per test, never the shared demo customers.
 */

export interface StoredRequest {
  id: string;
  reference: string;
  customerId: string;
  serviceId: string;
  serviceNameSnapshot: string;
  serviceAddressId: string | null;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressRegion: string | null;
  addressPostalCode: string;
  accessNotesSnapshot: string | null;
  description: string;
  preferredDate: string;
  preferredWindow: string;
  preferredStart: Date;
  preferredEnd: Date;
  status: ServiceRequestStatus;
  submissionKey: string | null;
  submittedAt: Date;
}

async function customerIdOf(
  prisma: Parameters<Parameters<typeof withDatabase>[0]>[0],
  userId: string,
): Promise<string> {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { userId },
    select: { id: true },
  });
  return profile.id;
}

/** The customer's requests as stored, oldest first. */
export async function readRequestsOf(userId: string): Promise<StoredRequest[]> {
  return withDatabase(async (prisma) => {
    const rows = await prisma.serviceRequest.findMany({
      where: { customerId: await customerIdOf(prisma, userId) },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      ...row,
      preferredDate: row.preferredDate.toISOString().slice(0, 10),
    }));
  });
}

/** How many requests exist for the customer. */
export async function countRequestsOf(userId: string): Promise<number> {
  return (await readRequestsOf(userId)).length;
}

/** A service that is open to requests and one of the seeded five, by name. */
export async function seededServiceId(name: string): Promise<string> {
  return withDatabase(async (prisma) => {
    const service = await prisma.service.findFirstOrThrow({
      where: { name },
      select: { id: true },
    });
    return service.id;
  });
}

export interface InsertedRequest {
  id: string;
  reference: string;
}

/** Gives a customer requests, newest last. References are unique, so parallel tests never clash. */
export async function createRequestsFor(
  userId: string,
  count: number,
  options: {
    serviceName?: string;
    status?: ServiceRequestStatus;
    /** The first one was submitted this long ago; each later one is a minute newer. */
    firstAgeMinutes?: number;
  } = {},
): Promise<InsertedRequest[]> {
  const { serviceName = "AC Routine Maintenance", status = "SUBMITTED" } = options;
  const firstAge = options.firstAgeMinutes ?? count + 5;
  const serviceId = await seededServiceId(serviceName);
  return withDatabase(async (prisma) => {
    const customerId = await customerIdOf(prisma, userId);
    const created: InsertedRequest[] = [];
    for (let index = 0; index < count; index += 1) {
      // From the same counter the API uses, so a reference is unique whoever makes it, whichever
      // worker is running, and has the real format.
      const reference = await prisma.$transaction((tx) =>
        nextReference(tx, "REQUEST", new Date(), "America/New_York"),
      );
      const row = await createServiceRequest(prisma, {
        customerId,
        serviceId,
        serviceNameSnapshot: serviceName,
        status,
        reference,
        submittedAt: new Date(Date.now() - (firstAge - index) * 60_000),
      });
      created.push({ id: row.id, reference: row.reference });
    }
    return created;
  });
}

/** A note on a request, from the business, either shown to the customer or internal. */
export async function createNoteOn(
  requestId: string,
  authorUserId: string,
  body: string,
  visibility: NoteVisibility,
): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.requestNote.create({ data: { requestId, authorUserId, body, visibility } });
  });
}

/** An activity event on a request, with or without words for the customer. */
export async function createEventOn(
  request: { id: string; customerId: string },
  actorUserId: string,
  summary: string,
  publicSummary: string | null,
): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.activityEvent.create({
      data: {
        actorUserId,
        entityType: "SERVICE_REQUEST",
        entityId: request.id,
        action: "request.noted",
        summary,
        publicSummary,
        requestId: request.id,
        customerId: request.customerId,
      },
    });
  });
}

export interface CreatedService {
  id: string;
  name: string;
  slug: string;
}

/**
 * A service that is not open to requests, with a name that starts with the E2E prefix so the
 * catalogue specs' cleanup finds it. Unpublished or archived services never appear on the website,
 * so creating one cannot disturb the public-site specs running at the same time.
 */
export async function createInactiveService(
  state: "unpublished" | "archived",
): Promise<CreatedService> {
  const tag = randomBytes(3).toString("hex");
  const name = `${E2E_SERVICE_PREFIX}Retired ${tag}`;
  const slug = `e2e-retired-${tag}`;
  return withDatabase(async (prisma) => {
    const service = await createService(prisma, {
      name,
      slug,
      isPublished: false,
      archivedAt: state === "archived" ? new Date() : null,
    });
    return { id: service.id, name, slug };
  });
}

/** The in-app notifications created for admins about one request. */
export async function receivedNotificationsFor(requestId: string) {
  return withDatabase((prisma) =>
    prisma.notification.findMany({
      where: { entityId: requestId, type: "REQUEST_RECEIVED" },
      select: { recipientUserId: true, title: true, message: true, linkPath: true },
    }),
  );
}

/** The activity events recorded for one request. */
export async function activityOf(requestId: string) {
  return withDatabase((prisma) =>
    prisma.activityEvent.findMany({
      where: { requestId },
      select: { action: true, summary: true, publicSummary: true, toStatus: true },
    }),
  );
}

/**
 * Puts a request in a status behind the application's back, as another admin's change would. For
 * scenarios that start from a state the screens cannot reach yet (T12 specs): the product's own
 * transition rules are tested through the API.
 */
export async function setRequestStatus(
  requestId: string,
  status: ServiceRequestStatus,
): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.serviceRequest.update({ where: { id: requestId }, data: { status } });
  });
}

/** A request's status and cancellation fields as stored. */
export async function readRequestState(requestId: string) {
  return withDatabase((prisma) =>
    prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        status: true,
        cancelReason: true,
        cancelCustomerMessage: true,
        cancelledAt: true,
        cancelledByUserId: true,
      },
    }),
  );
}

/** The notes on a request, oldest first. */
export async function notesOf(requestId: string) {
  return withDatabase((prisma) =>
    prisma.requestNote.findMany({
      where: { requestId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { body: true, visibility: true, authorUserId: true },
    }),
  );
}

/** A customer's saved addresses (label and street), oldest first. */
export async function savedAddressesOf(
  userId: string,
): Promise<Array<{ label: string; line1: string; isDefault: boolean }>> {
  return withDatabase(async (prisma) =>
    prisma.serviceAddress.findMany({
      where: { customerId: await customerIdOf(prisma, userId) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { label: true, line1: true, isDefault: true },
    }),
  );
}
