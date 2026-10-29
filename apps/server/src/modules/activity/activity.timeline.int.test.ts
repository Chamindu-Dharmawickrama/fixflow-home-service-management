import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ActivityEvent } from "../../generated/prisma/client.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createAdmin,
  createBusinessSettings,
  createCustomer,
  createService,
  createServiceRequest,
} from "../../test/fixtures.js";
import { buildActivitySummaries } from "./activity.domain.js";
import { getTimeline, recordActivity, type RecordActivityInput } from "./activity.service.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/** The only keys a customer may ever receive. */
const CUSTOMER_EVENT_KEYS = ["actor", "createdAt", "id", "publicSummary", "toStatus"];

const INTERNAL_MARKER = "INTERNAL-ONLY-MARKER";

/** Two customers, one admin, one request each, and a history on the first request. */
async function scenario() {
  await createBusinessSettings(prisma, { businessName: "CoolBreeze Home Services" });
  const admin = await createAdmin(prisma, { name: "Morgan Reyes" });
  const alex = await createCustomer(prisma, { name: "Alex Morgan" });
  const priya = await createCustomer(prisma, { name: "Priya Shah" });
  const service = await createService(prisma);
  const alexRequest = await createServiceRequest(prisma, {
    customerId: alex.profile.id,
    serviceId: service.id,
  });
  const priyaRequest = await createServiceRequest(prisma, {
    customerId: priya.profile.id,
    serviceId: service.id,
  });

  // Each event is given its own minute, so the order never depends on how fast the inserts ran
  // (events written within one millisecond, or one transaction, share a timestamp).
  let minute = 0;
  const stamped = async (event: ActivityEvent): Promise<ActivityEvent> => {
    minute += 1;
    return prisma.activityEvent.update({
      where: { id: event.id },
      data: { createdAt: new Date(Date.UTC(2026, 9, 29, 9, minute)) },
    });
  };

  const record = async (
    input: Pick<RecordActivityInput, "action" | "summary"> & Partial<RecordActivityInput>,
  ) =>
    stamped(
      await recordActivity(prisma, {
        actorUserId: admin.id,
        entityType: "SERVICE_REQUEST",
        entityId: alexRequest.id,
        requestId: alexRequest.id,
        customerId: alex.profile.id,
        ...input,
      }),
    );

  const submitted = await record({
    actorUserId: alex.user.id,
    action: "request.submitted",
    toStatus: "SUBMITTED",
    ...buildActivitySummaries({
      actor: { kind: "customer", name: "Alex Morgan" },
      staff: "submitted request FF-2026-00001",
      customer: "sent your request FF-2026-00001",
    }),
  });
  const internalNote = await record({
    action: "request.note_added",
    summary: `Morgan Reyes added an internal note. ${INTERNAL_MARKER}`,
    metadata: { visibility: "INTERNAL" },
  });
  const sent = await record({
    entityType: "QUOTATION",
    entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    action: "quotation.sent",
    fromStatus: "DRAFT",
    toStatus: "SENT",
    metadata: { quotationReference: "QT-2026-00001", totalAmount: "108.00", currencyCode: "USD" },
    ...buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      staff: `sent quotation QT-2026-00001 to Alex Morgan (${INTERNAL_MARKER})`,
      customer: "sent you quotation QT-2026-00001",
    }),
  });
  // Another customer's history, and an event with no customer at all.
  const other = await stamped(
    await recordActivity(prisma, {
      actorUserId: admin.id,
      entityType: "SERVICE_REQUEST",
      entityId: priyaRequest.id,
      requestId: priyaRequest.id,
      customerId: priya.profile.id,
      action: "request.submitted",
      summary: "Priya Shah submitted a request.",
      publicSummary: "You sent your request FF-2026-00002.",
    }),
  );
  const unowned = await stamped(
    await recordActivity(prisma, {
      actorUserId: null,
      entityType: "SERVICE_REQUEST",
      entityId: alexRequest.id,
      requestId: alexRequest.id,
      action: "request.system_check",
      summary: "The system checked the request.",
      publicSummary: "We checked your request.",
    }),
  );

  return {
    admin,
    alex,
    priya,
    alexRequest,
    priyaRequest,
    submitted,
    internalNote,
    sent,
    other,
    unowned,
  };
}

describe("getTimeline for the customer audience (D-29, D-41)", () => {
  it("returns only the customer's own events that carry a public summary", async () => {
    const s = await scenario();

    const timeline = await getTimeline(
      prisma,
      { requestId: s.alexRequest.id },
      "customer",
      s.alex.profile.id,
    );

    expect(timeline.map((event) => event.id)).toEqual([s.submitted.id, s.sent.id]);
  });

  it("returns exactly the allowlisted keys, and no internal summary, metadata or staff identity", async () => {
    const s = await scenario();

    const timeline = await getTimeline(
      prisma,
      { requestId: s.alexRequest.id },
      "customer",
      s.alex.profile.id,
    );

    expect(timeline).toHaveLength(2);
    for (const event of timeline) {
      expect(Object.keys(event).sort()).toEqual(CUSTOMER_EVENT_KEYS);
    }
    const json = JSON.stringify(timeline);
    expect(json).not.toContain(INTERNAL_MARKER);
    expect(json).not.toContain("internal note");
    expect(json).not.toContain("Morgan Reyes");
    expect(json).not.toContain(s.admin.id);
    expect(json).not.toContain(s.alex.profile.id);
    expect(json).not.toContain("metadata");
    expect(json).not.toContain("quotationReference");
    expect(json).not.toContain("108.00");
  });

  it("excludes internal events, other customers' events and events with no customer", async () => {
    const s = await scenario();

    const ids = (
      await getTimeline(prisma, { requestId: s.alexRequest.id }, "customer", s.alex.profile.id)
    ).map((event) => event.id);

    expect(ids).not.toContain(s.internalNote.id);
    expect(ids).not.toContain(s.other.id);
    expect(ids).not.toContain(s.unowned.id);
  });

  it("shows another customer nothing from this request, even knowing its id", async () => {
    const s = await scenario();

    expect(
      await getTimeline(prisma, { requestId: s.alexRequest.id }, "customer", s.priya.profile.id),
    ).toEqual([]);
    expect(
      await getTimeline(
        prisma,
        { entityType: "QUOTATION", entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        "customer",
        s.priya.profile.id,
      ),
    ).toEqual([]);
  });

  it("says 'You' for the customer's own action and the business name for staff actions", async () => {
    const s = await scenario();

    const timeline = await getTimeline(
      prisma,
      { requestId: s.alexRequest.id },
      "customer",
      s.alex.profile.id,
    );

    expect(timeline.map((event) => event.actor)).toEqual(["You", "CoolBreeze Home Services"]);
    expect(timeline.map((event) => event.publicSummary)).toEqual([
      "You sent your request FF-2026-00001.",
      "We sent you quotation QT-2026-00001.",
    ]);
    expect(timeline.map((event) => event.toStatus)).toEqual(["SUBMITTED", "SENT"]);
  });

  it("can be scoped to one record instead of a whole request", async () => {
    const s = await scenario();

    const timeline = await getTimeline(
      prisma,
      { entityType: "QUOTATION", entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      "customer",
      s.alex.profile.id,
    );

    expect(timeline.map((event) => event.id)).toEqual([s.sent.id]);
  });

  it("refuses to run without a customer rather than show everyone's history", async () => {
    const s = await scenario();

    await expect(
      getTimeline(prisma, { requestId: s.alexRequest.id }, "customer", ""),
    ).rejects.toThrow(/needs the customer's id/);
    await expect(
      getTimeline(
        prisma,
        { requestId: s.alexRequest.id },
        "customer",
        undefined as unknown as string,
      ),
    ).rejects.toThrow(/needs the customer's id/);
  });

  it("returns nothing for a customer id that does not exist", async () => {
    const s = await scenario();

    expect(
      await getTimeline(
        prisma,
        { requestId: s.alexRequest.id },
        "customer",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    ).toEqual([]);
  });

  it("falls back to a neutral name when the business settings are missing", async () => {
    const s = await scenario();
    await prisma.businessSettings.deleteMany();

    const timeline = await getTimeline(
      prisma,
      { requestId: s.alexRequest.id },
      "customer",
      s.alex.profile.id,
    );

    expect(timeline.map((event) => event.actor)).toEqual(["You", "Our team"]);
  });
});

describe("getTimeline for the admin audience", () => {
  it("returns every event on the request, internal ones included, with internal summaries and actor names", async () => {
    const s = await scenario();

    const timeline = await getTimeline(prisma, { requestId: s.alexRequest.id }, "admin");

    expect(timeline.map((event) => event.id)).toEqual([
      s.submitted.id,
      s.internalNote.id,
      s.sent.id,
      s.unowned.id,
    ]);
    const note = timeline.find((event) => event.id === s.internalNote.id);
    expect(note).toMatchObject({
      action: "request.note_added",
      customerVisible: false,
      publicSummary: null,
      actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    });
    expect(note?.summary).toContain(INTERNAL_MARKER);
    expect(note?.metadata).toEqual({ visibility: "INTERNAL" });
  });

  it("marks what the customer sees, shows the customer's own actions by name and system events with no actor", async () => {
    const s = await scenario();

    const timeline = await getTimeline(prisma, { requestId: s.alexRequest.id }, "admin");

    expect(timeline.map((event) => event.customerVisible)).toEqual([true, false, true, true]);
    expect(timeline[0]?.actor).toEqual({ name: "Alex Morgan", role: "CUSTOMER" });
    expect(timeline[2]?.metadata).toMatchObject({
      quotationReference: "QT-2026-00001",
      totalAmount: "108.00",
    });
    expect(timeline[3]?.actor).toBeNull();
  });

  it("does not include another request's events", async () => {
    const s = await scenario();

    const timeline = await getTimeline(prisma, { requestId: s.alexRequest.id }, "admin");

    expect(timeline.map((event) => event.id)).not.toContain(s.other.id);
  });

  it("orders oldest first by default and newest first on request", async () => {
    const s = await scenario();

    const oldestFirst = await getTimeline(prisma, { requestId: s.alexRequest.id }, "admin");
    const newestFirst = await getTimeline(
      prisma,
      { requestId: s.alexRequest.id, order: "desc" },
      "admin",
    );

    const times = oldestFirst.map((event) => event.createdAt);
    expect([...times].sort()).toEqual(times);
    expect(newestFirst.map((event) => event.id)).toEqual(
      oldestFirst.map((event) => event.id).reverse(),
    );
  });

  it("returns an empty list for a request with no history", async () => {
    await scenario();

    expect(
      await getTimeline(prisma, { requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "admin"),
    ).toEqual([]);
  });
});
