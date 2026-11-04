import {
  type CustomerWorkOrderDto,
  type CustomerWorkOrderListItemDto,
  type CustomerWorkOrderListResponse,
  ErrorCode,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import { dataOf } from "../../test/quotation-world.js";
import {
  ADMIN_WORK_ORDERS,
  at,
  insertJob,
  newJob,
  schedule,
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

const S = WorkOrderStatus;
const A = WorkOrderAction;
/** A response's JSON body, typed `unknown` (supertest types it `any`). */
const jsonOf = (response: { body: unknown }): unknown => response.body;
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
const MINE = "/api/v1/work-orders/me";
const ONE = (id: string) => `/api/v1/work-orders/${id}`;

const COMPLETION_NOTE =
  "Replaced the run capacitor and re-gassed the system. The unit now cools to 68 degrees.";
const INTERNAL_NOTE = "INTERNAL-NOTE: upsell a surge protector; Mr Morgan is slow to pay.";
const INTERNAL_REASON = "INTERNAL-REASON: the part is backordered and the customer wants a refund.";
const STAFF_ONLY_EVENT = "INTERNAL-EVENT: the technician reported a hostile dog at the gate.";

function mine(w: WorkOrderWorld, query = "", cookie = w.alexCookie) {
  return w.client.get(`${MINE}${query === "" ? "" : `?${query}`}`, { cookie });
}

async function listOf(w: WorkOrderWorld, query = "", cookie = w.alexCookie) {
  const response = await mine(w, query, cookie);
  expect(response.status).toBe(200);
  return response.body as CustomerWorkOrderListResponse;
}

function transition(w: WorkOrderWorld, id: string, body: object) {
  return w.client
    .post(`${ADMIN_WORK_ORDERS}/${id}/transitions`, { cookie: w.adminCookie })
    .send(body);
}

/** A staff-only event on a job: it has no public summary, so no customer may ever read it. */
function addStaffOnlyEvent(w: WorkOrderWorld, job: { id: string; requestId: string }) {
  return prisma.activityEvent.create({
    data: {
      actorUserId: w.admin.id,
      entityType: "WORK_ORDER",
      entityId: job.id,
      requestId: job.requestId,
      customerId: w.alex.profile.id,
      action: "work_order.reassigned",
      summary: STAFF_ONLY_EVENT,
      publicSummary: null,
      metadata: {},
    },
  });
}

describe("GET /work-orders/me", () => {
  it("answers 401 without a session and 403 to an admin", async () => {
    const w = await workOrderWorld(prisma);
    expectApiError(await w.client.get(MINE), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await mine(w, "", w.adminCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("is empty for a customer with no jobs", async () => {
    const w = await workOrderWorld(prisma);
    const list = await listOf(w);
    expect(list.data).toEqual([]);
    expect(list.pagination).toMatchObject({ page: 1, totalItems: 0, totalPages: 0 });
  });

  it("lists only the signed-in customer's jobs, whoever asks and whatever the query says", async () => {
    const w = await workOrderWorld(prisma);
    const alexJob = await insertJob(w, { owner: "alex" });
    const priyaJob = await insertJob(w, { owner: "priya" });

    const alex = await listOf(w);
    const priya = await listOf(w, "", w.priyaCookie);
    expect(alex.data.map((item) => item.id)).toEqual([alexJob.id]);
    expect(priya.data.map((item) => item.id)).toEqual([priyaJob.id]);

    // The owner is the session's, never a parameter: these are not even read.
    const spoofed = await listOf(w, `customerId=${w.priya.profile.id}&userId=${w.priya.user.id}`);
    expect(spoofed.data.map((item) => item.id)).toEqual([alexJob.id]);
  });

  it("puts a booked visit first (soonest first), then jobs waiting for a time, then finished and cancelled jobs", async () => {
    const w = await workOrderWorld(prisma);
    const later = await insertJob(w, {
      status: S.SCHEDULED,
      technicianId: w.jordan.id,
      start: at("2026-03-05", "10:00"),
      end: at("2026-03-05", "12:00"),
    });
    const underway = await insertJob(w, {
      status: S.IN_PROGRESS,
      technicianId: w.jordan.id,
      start: at("2026-03-03", "10:00"),
      end: at("2026-03-03", "12:00"),
    });
    // The old appointment of a job that needs a new time is the earliest of all; it must not count.
    const needsTime = await insertJob(w, {
      status: S.NEEDS_RESCHEDULING,
      technicianId: w.jordan.id,
      start: at("2026-03-01", "10:00"),
      end: at("2026-03-01", "12:00"),
      createdAt: new Date("2026-02-20T10:00:00.000Z"),
    });
    const pending = await insertJob(w, {
      status: S.PENDING_SCHEDULING,
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
    });
    const doneRecently = await insertJob(w, {
      status: S.COMPLETED,
      technicianId: w.jordan.id,
      start: at("2026-02-27", "10:00"),
      end: at("2026-02-27", "12:00"),
    });
    const doneEarlier = await insertJob(w, {
      status: S.COMPLETED,
      technicianId: w.jordan.id,
      start: at("2026-02-10", "10:00"),
      end: at("2026-02-10", "12:00"),
    });
    const cancelledNeverBooked = await insertJob(w, { status: S.CANCELLED });

    const list = await listOf(w);

    expect(list.data.map((item) => item.id)).toEqual([
      underway.id,
      later.id,
      needsTime.id,
      pending.id,
      doneRecently.id,
      doneEarlier.id,
      cancelledNeverBooked.id,
    ]);
    expect(list.pagination.totalItems).toBe(7);
  });

  it("never repeats or loses a row across pages, including where one stretch ends and the next begins", async () => {
    const w = await workOrderWorld(prisma);
    const statuses = [
      S.SCHEDULED,
      S.SCHEDULED,
      S.IN_PROGRESS,
      S.NEEDS_RESCHEDULING,
      S.PENDING_SCHEDULING,
      S.PENDING_SCHEDULING,
      S.COMPLETED,
      S.COMPLETED,
      S.CANCELLED,
    ];
    let day = 10;
    for (const status of statuses) {
      day += 1;
      const booked = status === S.SCHEDULED || status === S.IN_PROGRESS || status === S.COMPLETED;
      await insertJob(w, {
        status,
        ...(booked && {
          technicianId: w.jordan.id,
          start: at(`2026-03-${day}`, "10:00"),
          end: at(`2026-03-${day}`, "12:00"),
        }),
        createdAt: new Date(`2026-02-${day}T10:00:00.000Z`),
      });
    }

    const whole = await listOf(w, "pageSize=100");
    expect(whole.data).toHaveLength(9);
    for (const pageSize of [1, 2, 3, 4, 5]) {
      const seen: string[] = [];
      const pages = Math.ceil(9 / pageSize);
      for (let page = 1; page <= pages; page += 1) {
        const list = await listOf(w, `page=${page}&pageSize=${pageSize}`);
        expect(list.pagination).toMatchObject({ page, pageSize, totalItems: 9, totalPages: pages });
        seen.push(...list.data.map((item) => item.id));
      }
      expect(seen, `pageSize ${pageSize}`).toEqual(whole.data.map((item) => item.id));
    }
    expect((await listOf(w, "page=99")).data).toEqual([]);
  });

  it("lists one section when asked: what is coming, or what is over", async () => {
    const w = await workOrderWorld(prisma);
    const booked = await insertJob(w, {
      status: S.SCHEDULED,
      technicianId: w.jordan.id,
      start: at("2026-03-03", "10:00"),
      end: at("2026-03-03", "12:00"),
    });
    const pending = await insertJob(w, { status: S.PENDING_SCHEDULING });
    const done = await insertJob(w, { status: S.COMPLETED });
    const cancelled = await insertJob(w, { status: S.CANCELLED });

    const upcoming = await listOf(w, "group=upcoming");
    const past = await listOf(w, "group=past");

    expect(upcoming.data.map((item) => item.id)).toEqual([booked.id, pending.id]);
    expect(upcoming.pagination.totalItems).toBe(2);
    expect(past.data.map((item) => item.id).sort()).toEqual([cancelled.id, done.id].sort());
    expect(past.pagination.totalItems).toBe(2);

    const secondUpcoming = await listOf(w, "group=upcoming&pageSize=1&page=2");
    expect(secondUpcoming.data.map((item) => item.id)).toEqual([pending.id]);
  });

  it("is a card with the date, the service, the status and the technician's first name, and nothing else", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));

    const [item] = (await listOf(w)).data;

    expect(item).toEqual({
      id: job.id,
      reference: job.reference,
      status: S.SCHEDULED,
      statusLabel: "Scheduled",
      serviceName: "AC Repair",
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technician: { displayName: "Jordan" },
      completedAt: null,
    });
    const json = JSON.stringify(await listOf(w));
    for (const secret of ["Lee", "555-0151", "jordan.lee@", technicianId(w), "Larkspur Lane job"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("shows no time and no technician for a job that needs a new time or was cancelled", async () => {
    const w = await workOrderWorld(prisma);
    const slot = {
      technicianId: w.jordan.id,
      start: at("2026-03-03", "10:00"),
      end: at("2026-03-03", "12:00"),
    };
    await insertJob(w, { status: S.NEEDS_RESCHEDULING, ...slot });
    await insertJob(w, { status: S.CANCELLED, ...slot });

    const { data } = await listOf(w);

    expect(data).toHaveLength(2);
    for (const item of data) {
      expect(item).toMatchObject({ scheduledStart: null, scheduledEnd: null, technician: null });
    }
  });

  it("answers 422 to a page size over 100 and to an unknown section", async () => {
    const w = await workOrderWorld(prisma);
    expectApiError(await mine(w, "pageSize=101"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await mine(w, "group=soon"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

/**
 * The customer's notifications as the API serves them. It fails if the answer is not a real,
 * non-empty list, so a check that "nothing leaks into the notifications" cannot pass by reading nothing.
 */
async function customersNotifications(w: WorkOrderWorld) {
  const response = await w.client.get("/api/v1/notifications/me", { cookie: w.alexCookie });
  expect(response.status).toBe(200);
  expect((response.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
  return jsonOf(response);
}

function technicianId(w: WorkOrderWorld): string {
  return w.jordan.id;
}

describe("GET /work-orders/:id (G.3)", () => {
  it("returns the customer's shape: schedule, status, address, links and timeline", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));

    const response = await w.client.get(ONE(job.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const dto = dataOf<CustomerWorkOrderDto>(response);
    expect(dto).toMatchObject({
      id: job.id,
      reference: job.reference,
      status: S.SCHEDULED,
      statusLabel: "Scheduled",
      statusExplanation:
        "Your visit is booked for the time shown below. We will tell you if anything changes.",
      serviceName: "AC Repair",
      timeZone: "America/New_York",
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technician: { displayName: "Jordan" },
      previouslyScheduled: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      completionNote: null,
      invoice: null,
      request: { id: job.request.id, reference: job.request.reference },
      quotation: { id: job.quotation.id, reference: job.quotation.reference },
    });
    expect(dto.scopeDescription).toContain(job.scopeDescription.split("\n")[0]);
    expect(typeof dto.address.city).toBe("string");
    expect(typeof dto.address.postalCode).toBe("string");
    expect(dto.timeline.map((event) => event.publicSummary)).toEqual([
      `We created job ${job.reference} for your request.`,
      "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    ]);
  });

  it("has exactly the documented fields, and none an admin's view has", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const dto = dataOf<CustomerWorkOrderDto>(
      await w.client.get(ONE(job.id), { cookie: w.alexCookie }),
    );

    expect(Object.keys(dto).sort()).toEqual(
      [
        "address",
        "cancelledAt",
        "completedAt",
        "completionNote",
        "id",
        "invoice",
        "previouslyScheduled",
        "quotation",
        "reference",
        "request",
        "scheduledEnd",
        "scheduledStart",
        "scopeDescription",
        "serviceName",
        "startedAt",
        "status",
        "statusExplanation",
        "statusLabel",
        "technician",
        "timeZone",
        "timeline",
      ].sort(),
    );
    for (const adminOnly of [
      "internalCompletionNote",
      "cancelReason",
      "customer",
      "createdBy",
      "availableActions",
      "serviceId",
      "createdAt",
      "updatedAt",
    ]) {
      expect(dto, adminOnly).not.toHaveProperty(adminOnly);
    }
  });

  it("answers 404 to another customer exactly as to an id that does not exist", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w, "alex");

    const stranger = await w.client.get(ONE(job.id), { cookie: w.priyaCookie });
    const missing = await w.client.get(ONE(MISSING_ID), { cookie: w.priyaCookie });

    const strangerError = expectApiError(stranger, { status: 404, code: ErrorCode.NOT_FOUND });
    const missingError = expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
    expect(strangerError.message).toBe(missingError.message);
    expect(JSON.stringify(stranger.body)).not.toContain(job.reference);
  });

  it("does not open by reference, and answers 422 to something that is not an id", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    expectApiError(await w.client.get(ONE(job.reference), { cookie: w.alexCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await w.client.get(ONE("not-an-id"), { cookie: w.alexCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("answers 401 without a session", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    expectApiError(await w.client.get(ONE(job.id)), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it("gives an admin the same customer shape, as a preview, and a 404 for an id that does not exist", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);

    const preview = await w.client.get(ONE(job.id), { cookie: w.adminCookie });
    const asOwner = await w.client.get(ONE(job.id), { cookie: w.alexCookie });

    expect(preview.status).toBe(200);
    expect(Object.keys(dataOf<object>(preview)).sort()).toEqual(
      Object.keys(dataOf<object>(asOwner)).sort(),
    );
    expect(dataOf(preview)).not.toHaveProperty("internalCompletionNote");
    expectApiError(await w.client.get(ONE(MISSING_ID), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("gives a customer no way to change a job", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    for (const response of [
      await w.client.post(`${ONE(job.id)}/transitions`, { cookie: w.alexCookie }).send({
        action: A.CANCEL,
        expectedStatus: S.PENDING_SCHEDULING,
        reason: "Changed my mind.",
      }),
      await w.client.patch(ONE(job.id), { cookie: w.alexCookie }).send({ status: S.CANCELLED }),
      await w.client.delete(ONE(job.id), { cookie: w.alexCookie }),
    ]) {
      expect(response.status).toBe(404);
    }
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe(S.PENDING_SCHEDULING);
  });
});

describe("what each status tells the customer (G.3, spec 5.3)", () => {
  async function dtoFor(w: WorkOrderWorld, status: WorkOrderStatus) {
    const booked = status === S.SCHEDULED || status === S.IN_PROGRESS || status === S.COMPLETED;
    const stale = status === S.NEEDS_RESCHEDULING || status === S.CANCELLED;
    const job = await insertJob(w, {
      status,
      ...((booked || stale) && {
        technicianId: w.jordan.id,
        start: at("2026-03-03", "10:00"),
        end: at("2026-03-03", "12:00"),
      }),
    });
    if (status === S.COMPLETED) {
      await prisma.workOrder.update({
        where: { id: job.id },
        data: { completionNote: COMPLETION_NOTE, internalCompletionNote: INTERNAL_NOTE },
      });
    }
    return dataOf<CustomerWorkOrderDto>(await w.client.get(ONE(job.id), { cookie: w.alexCookie }));
  }

  it.each([
    [S.PENDING_SCHEDULING, /not booked a time/],
    [S.SCHEDULED, /booked for the time shown/],
    [S.IN_PROGRESS, /Your technician has started work/],
    [S.COMPLETED, /The work is finished/],
    [S.CANCELLED, /cancelled, so no visit will take place/],
    [S.NEEDS_RESCHEDULING, /find a new time/],
  ])("explains a %s job in plain words", async (status, words) => {
    const w = await workOrderWorld(prisma);
    const dto = await dtoFor(w, status);
    expect(dto.statusExplanation).toMatch(words);
    expect(dto.statusLabel.length).toBeGreaterThan(0);
  });

  it("shows the time and technician of a standing visit, and history only for one given up", async () => {
    const w = await workOrderWorld(prisma);
    for (const status of [S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED]) {
      const dto = await dtoFor(w, status);
      expect(dto, status).toMatchObject({
        scheduledStart: "2026-03-03T15:00:00.000Z",
        technician: { displayName: "Jordan" },
        previouslyScheduled: null,
      });
    }
    for (const status of [S.NEEDS_RESCHEDULING, S.CANCELLED]) {
      const dto = await dtoFor(w, status);
      expect(dto, status).toMatchObject({
        scheduledStart: null,
        scheduledEnd: null,
        technician: null,
        previouslyScheduled: {
          start: "2026-03-03T15:00:00.000Z",
          end: "2026-03-03T17:00:00.000Z",
        },
      });
    }
  });

  it("shows the completion summary, and never the internal note, once the job is complete", async () => {
    const w = await workOrderWorld(prisma);
    const dto = await dtoFor(w, S.COMPLETED);
    expect(dto.completionNote).toBe(COMPLETION_NOTE);
    expect(dto.completedAt).not.toBeNull();
    expect(JSON.stringify(dto)).not.toContain("INTERNAL-NOTE");
  });
});

describe("the customer never reads an internal note or a staff-only event (BR-19, G.3)", () => {
  it("keeps both out of /work-orders/:id, /work-orders/me, the request and the notifications", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));
    await addStaffOnlyEvent(w, { id: job.id, requestId: job.request.id });
    expect(
      (await transition(w, job.id, { action: A.START, expectedStatus: S.SCHEDULED })).status,
    ).toBe(200);
    expect(
      (
        await transition(w, job.id, {
          action: A.COMPLETE,
          expectedStatus: S.IN_PROGRESS,
          completionNote: COMPLETION_NOTE,
          internalNote: INTERNAL_NOTE,
        })
      ).status,
    ).toBe(200);

    // The notes are in the database (this is not a test of an empty row) ...
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.internalCompletionNote).toBe(INTERNAL_NOTE);
    expect(await prisma.activityEvent.count({ where: { summary: STAFF_ONLY_EVENT } })).toBe(1);

    // ... and in the admin's view ...
    const admin = await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, { cookie: w.adminCookie });
    expect(JSON.stringify(admin.body)).toContain("INTERNAL-NOTE");
    expect(JSON.stringify(admin.body)).toContain("INTERNAL-EVENT");

    // ... but nowhere a customer can read.
    await w.deps.emailDispatcher.idle();
    const customerSees = JSON.stringify({
      job: jsonOf(await w.client.get(ONE(job.id), { cookie: w.alexCookie })),
      list: jsonOf(await mine(w)),
      listPast: jsonOf(await mine(w, "group=past")),
      request: jsonOf(
        await w.client.get(`/api/v1/requests/${job.request.id}`, { cookie: w.alexCookie }),
      ),
      notifications: await customersNotifications(w),
      emails: w.emails.sent.filter((mail) => mail.to === "alex.morgan@example.test"),
    });
    for (const secret of ["INTERNAL-NOTE", "INTERNAL-EVENT", "surge protector", "hostile dog"]) {
      expect(customerSees, secret).not.toContain(secret);
    }
    // What the customer is meant to read is there.
    expect(customerSees).toContain(COMPLETION_NOTE);
  });

  it("keeps a cancellation's reason out of everything the customer reads", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const cancelled = await transition(w, job.id, {
      action: A.CANCEL,
      expectedStatus: S.PENDING_SCHEDULING,
      reason: INTERNAL_REASON,
    });
    expect(cancelled.status).toBe(200);
    await w.deps.emailDispatcher.idle();

    const customerSees = JSON.stringify({
      job: jsonOf(await w.client.get(ONE(job.id), { cookie: w.alexCookie })),
      list: jsonOf(await mine(w)),
      request: jsonOf(
        await w.client.get(`/api/v1/requests/${job.request.id}`, { cookie: w.alexCookie }),
      ),
      notifications: await customersNotifications(w),
      emails: w.emails.sent.filter((mail) => mail.to === "alex.morgan@example.test"),
    });
    for (const secret of ["INTERNAL-REASON", "backordered", "refund"]) {
      expect(customerSees, secret).not.toContain(secret);
    }
    expect(customerSees).toContain("We cancelled your job.");
  });

  it("shows another customer's job and timeline to nobody but its owner", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w, "alex");
    await schedule(w, job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));

    const priyaSees = JSON.stringify({
      list: jsonOf(await mine(w, "", w.priyaCookie)),
      job: jsonOf(await w.client.get(ONE(job.id), { cookie: w.priyaCookie })),
    });

    expect(priyaSees).not.toContain(job.reference);
    expect(priyaSees).not.toContain("Alex");
    expect(priyaSees).not.toContain("Larkspur");
  });
});

describe("the customer's job list agrees with the admin's changes", () => {
  it("follows a job from pending to done, as the customer would see it", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const statusOf = async () => (await listOf(w)).data[0]?.status;
    const itemOf = async (): Promise<CustomerWorkOrderListItemDto | undefined> =>
      (await listOf(w)).data[0];

    expect(await statusOf()).toBe(S.PENDING_SCHEDULING);
    await schedule(w, job, w.jordan.id, at("2026-03-03", "10:00"), at("2026-03-03", "12:00"));
    expect(await statusOf()).toBe(S.SCHEDULED);

    await transition(w, job.id, { action: A.START, expectedStatus: S.SCHEDULED });
    expect(await itemOf()).toMatchObject({
      status: S.IN_PROGRESS,
      technician: { displayName: "Jordan" },
    });

    await transition(w, job.id, {
      action: A.MARK_NEEDS_RESCHEDULING,
      expectedStatus: S.IN_PROGRESS,
      reason: INTERNAL_REASON,
    });
    expect(await itemOf()).toMatchObject({
      status: S.NEEDS_RESCHEDULING,
      scheduledStart: null,
      technician: null,
    });

    await schedule(
      w,
      { id: job.id, status: S.NEEDS_RESCHEDULING },
      w.sam.id,
      at("2026-03-04", "09:00"),
      at("2026-03-04", "11:00"),
    );
    expect(await itemOf()).toMatchObject({
      status: S.SCHEDULED,
      scheduledStart: "2026-03-04T14:00:00.000Z",
      technician: { displayName: "Sam" },
    });
  });
});
