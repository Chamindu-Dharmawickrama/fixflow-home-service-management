import { ActivityEntityType } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createBaseScenario } from "../../test/fixtures.js";
import { ActivityValidationError } from "./activity.metadata.js";
import { recordActivity } from "./activity.service.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("recordActivity", () => {
  it("stores an event with everything it was given", async () => {
    const { admin, customer, request } = await createBaseScenario(prisma);

    const event = await recordActivity(prisma, {
      actorUserId: admin.id,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: request.id,
      action: "request.review_started",
      fromStatus: "SUBMITTED",
      toStatus: "UNDER_REVIEW",
      summary: "Morgan Reyes started reviewing the request.",
      publicSummary: "Your request is being reviewed",
      metadata: { requestReference: request.reference, changedFields: ["status"] },
      requestId: request.id,
      customerId: customer.id,
    });

    const stored = await prisma.activityEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored).toMatchObject({
      actorUserId: admin.id,
      entityType: "SERVICE_REQUEST",
      entityId: request.id,
      action: "request.review_started",
      fromStatus: "SUBMITTED",
      toStatus: "UNDER_REVIEW",
      summary: "Morgan Reyes started reviewing the request.",
      publicSummary: "Your request is being reviewed",
      metadata: { requestReference: request.reference, changedFields: ["status"] },
      requestId: request.id,
      customerId: customer.id,
    });
    expect(stored.createdAt).toBeInstanceOf(Date);
  });

  it("stores a system event with no actor and a staff-only summary", async () => {
    const { request } = await createBaseScenario(prisma);

    const event = await recordActivity(prisma, {
      actorUserId: null,
      entityType: ActivityEntityType.QUOTATION,
      entityId: request.id,
      action: "quotation.expired",
      summary: "Quotation expired automatically.",
    });

    const stored = await prisma.activityEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.actorUserId).toBeNull();
    expect(stored.publicSummary).toBeNull();
    expect(stored.requestId).toBeNull();
    expect(stored.customerId).toBeNull();
    expect(stored.metadata).toEqual({});
  });

  it.each([
    ["a key that is not on the allowlist", { email: "alex.morgan@example.test" }],
    ["a free-text reason", { reason: "Customer said the technician was rude" }],
    ["a value that looks like an email address", { serviceName: "alex.morgan@example.test" }],
    ["a value that looks like a token", { reference: "sk_live_4eC39HqLyjWDarjtT1zdp7dc4eC39Hq" }],
    ["a value that looks like a street address", { serviceName: "214 Larkspur Lane" }],
  ])("rejects metadata with %s and stores nothing", async (_what, metadata) => {
    const { admin, request } = await createBaseScenario(prisma);

    await expect(
      recordActivity(prisma, {
        actorUserId: admin.id,
        entityType: ActivityEntityType.SERVICE_REQUEST,
        entityId: request.id,
        action: "request.noted",
        summary: "A note was added.",
        metadata: metadata as never,
      }),
    ).rejects.toBeInstanceOf(ActivityValidationError);

    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("is part of the caller's transaction: the event exists exactly when the change commits", async () => {
    const { admin, request } = await createBaseScenario(prisma);
    const input = {
      actorUserId: admin.id,
      entityType: ActivityEntityType.SERVICE_REQUEST,
      entityId: request.id,
      action: "request.cancelled",
      summary: "Request cancelled.",
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await recordActivity(tx, input);
        throw new Error("the business operation failed");
      }),
    ).rejects.toThrow("business operation failed");
    expect(await prisma.activityEvent.count()).toBe(0);

    await prisma.$transaction((tx) => recordActivity(tx, input));
    expect(await prisma.activityEvent.count()).toBe(1);
  });

  it("refuses an event that points at a customer or request that does not exist", async () => {
    const { admin, request } = await createBaseScenario(prisma);

    await expect(
      recordActivity(prisma, {
        actorUserId: admin.id,
        entityType: ActivityEntityType.SERVICE_REQUEST,
        entityId: request.id,
        action: "request.submitted",
        summary: "Request submitted.",
        customerId: "00000000-0000-4000-8000-0000000000ff",
      }),
    ).rejects.toThrow();
    expect(await prisma.activityEvent.count()).toBe(0);
  });
});
