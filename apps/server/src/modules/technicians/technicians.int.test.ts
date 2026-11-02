import {
  type AdminTechnicianDto,
  type AdminTechnicianListResponse,
  type AssignableTechnicianDto,
  ErrorCode,
  TECHNICIAN_COLORS,
  type WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createBusinessSettings,
  createQuotation,
  createService,
  createServiceRequest,
  createTechnician,
  createWorkOrder,
} from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const BASE = "/api/v1/admin/technicians";
const one = (id: string) => `${BASE}/${id}`;
const CUSTOMER_EMAIL = "alex.morgan@example.test";
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

/**
 * The fake clock starts at 2026-03-02T09:00:00Z: 04:00 on 2 Mar in New York (EST). The clocks go
 * forward there on Sunday 8 Mar, which is the seventh day of the availability summary, and the
 * 14-day window ends as 16 Mar starts (04:00Z, EDT).
 */
const NOW = "2026-03-02T09:00:00.000Z";
const WINDOW_END = "2026-03-16T04:00:00.000Z";

async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma, { currencyCode: "USD", timeZone: "America/New_York" });
  const test = buildTestApp({ prisma, ...options });
  const admin = await createLocalAdmin(prisma);
  const customer = await createLocalCustomer(prisma, {
    email: CUSTOMER_EMAIL,
    name: "Alex Morgan",
  });
  const service = await createService(prisma, { name: "AC Diagnostic Visit" });
  return {
    ...test,
    admin,
    customer,
    service,
    adminCookie: await signInAs(test.app, admin.email),
    customerCookie: await signInAs(test.app, CUSTOMER_EMAIL),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const list = (w: World, query = "") => api(w.app).get(`${BASE}${query}`, { cookie: w.adminCookie });
const read = (w: World, id: string) => api(w.app).get(one(id), { cookie: w.adminCookie });
const create = (w: World, body: unknown) =>
  api(w.app)
    .post(BASE, { cookie: w.adminCookie })
    .send(body as object);
const edit = (w: World, id: string, body: unknown) =>
  api(w.app)
    .patch(one(id), { cookie: w.adminCookie })
    .send(body as object);
const deactivate = (w: World, id: string) =>
  api(w.app).post(`${one(id)}/deactivate`, { cookie: w.adminCookie });
const activate = (w: World, id: string) =>
  api(w.app).post(`${one(id)}/activate`, { cookie: w.adminCookie });

const dataOf = (response: { body: unknown }) =>
  (response.body as { data: AdminTechnicianDto }).data;
const listed = async (w: World, query = "") =>
  bodyOf<AdminTechnicianListResponse>(await list(w, query));

async function created(
  w: World,
  body: object = { name: "Jordan Lee" },
): Promise<AdminTechnicianDto> {
  const response = await create(w, body);
  expect(response.status).toBe(201);
  return dataOf(response);
}

function eventsFor(id: string) {
  return prisma.activityEvent.findMany({
    where: { entityType: "TECHNICIAN", entityId: id },
    orderBy: { createdAt: "asc" },
  });
}

/** A work order with its own request and quotation (the database allows one work order for each). */
async function createJob(
  w: World,
  technicianId: string | null,
  options: {
    start?: string | null;
    end?: string | null;
    status?: WorkOrderStatus;
    serviceName?: string;
  } = {},
) {
  const {
    start = null,
    end = null,
    status = "SCHEDULED",
    serviceName = "AC Diagnostic Visit",
  } = options;
  const request = await createServiceRequest(prisma, {
    customerId: w.customer.profile.id,
    serviceId: w.service.id,
  });
  const quotation = await createQuotation(prisma, {
    requestId: request.id,
    customerId: w.customer.profile.id,
    createdByUserId: w.admin.id,
    status: "ACCEPTED",
    sentAt: new Date("2026-02-20T15:00:00.000Z"),
  });
  return createWorkOrder(prisma, {
    requestId: request.id,
    quotationId: quotation.id,
    customerId: w.customer.profile.id,
    serviceId: w.service.id,
    createdByUserId: w.admin.id,
    technicianId,
    status,
    serviceNameSnapshot: serviceName,
    scheduledStart: start === null ? null : new Date(start),
    scheduledEnd: end === null ? null : new Date(end),
    ...(status === "CANCELLED" && {
      cancelledAt: new Date("2026-03-01T12:00:00.000Z"),
      cancelReason: "The customer changed their mind.",
    }),
  });
}

// ---------------------------------------------------------------------------------------------

describe("access control", () => {
  const cases = [
    ["GET", BASE],
    ["GET", `${BASE}/assignable`],
    ["GET", one(MISSING_ID)],
    ["POST", BASE],
    ["PATCH", one(MISSING_ID)],
    ["POST", `${one(MISSING_ID)}/deactivate`],
    ["POST", `${one(MISSING_ID)}/activate`],
  ] as const;

  const send = (w: World, method: (typeof cases)[number][0], path: string, cookie?: string) => {
    const client = api(w.app);
    const options = cookie === undefined ? {} : { cookie };
    return method === "GET"
      ? client.get(path, options)
      : method === "POST"
        ? client.post(path, options).send({ name: "Jordan Lee" })
        : client.patch(path, options).send({ name: "Jordan Lee" });
  };

  it.each(cases)("%s %s answers 401 to a visitor with nothing signed in", async (method, path) => {
    const w = await world();
    expectApiError(await send(w, method, path), { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it.each(cases)("%s %s answers 403 to a customer", async (method, path) => {
    const w = await world();
    expectApiError(await send(w, method, path, w.customerCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("leaves everything as it was after a customer's rejected writes", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee", phone: "(212) 555-0151" });
    const before = await prisma.technician.findMany();

    await send(w, "POST", BASE, w.customerCookie);
    await send(w, "PATCH", one(jordan.id), w.customerCookie);
    await send(w, "POST", `${one(jordan.id)}/deactivate`, w.customerCookie);

    expect(await prisma.technician.findMany()).toEqual(before);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("refuses a write sent from another origin (403) and changes nothing", async () => {
    const w = await world();
    const response = await api(w.app)
      .post(BASE, { cookie: w.adminCookie, origin: "https://evil.example.com" })
      .send({ name: "Jordan Lee" });

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await prisma.technician.count()).toBe(0);
  });

  it("is rate limited per admin on writes (429), and reading is not", async () => {
    const w = await world({ rateLimits: { adminWrite: { limit: 2, windowSeconds: 60 } } });

    expect((await create(w, { name: "Jordan Lee" })).status).toBe(201);
    expect((await create(w, { name: "Sam Okafor" })).status).toBe(201);
    expectApiError(await create(w, { name: "Taylor Brooks" }), {
      status: 429,
      code: ErrorCode.RATE_LIMITED,
    });
    expect(await prisma.technician.count()).toBe(2);
    expect((await list(w)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------

describe("creating a technician", () => {
  it("adds an active technician with the details given and answers 201", async () => {
    const w = await world();
    const response = await create(w, {
      name: "  Jordan Lee ",
      phone: "(212) 555-0151",
      email: "Jordan.Lee@CoolBreeze.test",
      specialties: ["Air conditioning", "Heat pumps"],
      notes: "Senior technician.",
      calendarColor: "teal",
    });

    expect(response.status).toBe(201);
    expect(dataOf(response)).toMatchObject({
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Air conditioning", "Heat pumps"],
      notes: "Senior technician.",
      calendarColor: "teal",
      isActive: true,
      upcomingJobCount: 0,
      nextJob: null,
      upcomingAssignments: [],
      availableActions: ["EDIT", "DEACTIVATE"],
    });
    const stored = await prisma.technician.findUniqueOrThrow({
      where: { id: dataOf(response).id },
    });
    expect(stored).toMatchObject({ name: "Jordan Lee", isActive: true, calendarColor: "teal" });
  });

  it("needs only a name, storing the rest as nothing", async () => {
    const w = await world();
    const technician = await created(w, { name: "Sam Okafor" });

    expect(technician).toMatchObject({
      phone: null,
      email: null,
      specialties: [],
      notes: null,
      isActive: true,
    });
  });

  it("stores a blank phone, email and notes as nothing", async () => {
    const w = await world();
    const technician = await created(w, { name: "Sam Okafor", phone: " ", email: "", notes: "  " });
    expect(technician).toMatchObject({ phone: null, email: null, notes: null });
  });

  it("gives a technician without a chosen colour the one the fewest others have", async () => {
    const w = await world();
    const colors = [];
    for (const name of ["Ada Kim", "Ben Ortiz", "Cleo Park"]) {
      colors.push((await created(w, { name })).calendarColor);
    }
    expect(colors).toEqual(TECHNICIAN_COLORS.slice(0, 3));
  });

  it("keeps a chosen colour even if another technician has it", async () => {
    const w = await world();
    await created(w, { name: "Ada Kim", calendarColor: "rose" });
    expect((await created(w, { name: "Ben Ortiz", calendarColor: "rose" })).calendarColor).toBe(
      "rose",
    );
  });

  it("records who added them, as a staff-only event with no contact details", async () => {
    const w = await world();
    const technician = await created(w, {
      name: "Jordan Lee",
      email: "jordan.lee@coolbreeze.test",
      phone: "(212) 555-0151",
      notes: "A private note.",
    });

    const [event, ...others] = await eventsFor(technician.id);
    expect(others).toEqual([]);
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "TECHNICIAN",
      action: "technician.created",
      fromStatus: null,
      toStatus: "ACTIVE",
      publicSummary: null,
      metadata: { isActive: true },
    });
    expect(event?.summary).toBe(`${w.admin.name} added the technician "Jordan Lee".`);
    const everything = JSON.stringify(event);
    for (const secret of ["jordan.lee@coolbreeze.test", "555-0151", "A private note"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it.each([
    ["no name", {}, "name", "Enter the name."],
    ["a one-letter name", { name: "J" }, "name", "The name must be at least 2 characters."],
    [
      "a 101-character name",
      { name: "x".repeat(101) },
      "name",
      "The name must be 100 characters or fewer.",
    ],
    [
      "a phone number with letters",
      { name: "Jordan Lee", phone: "call me" },
      "phone",
      "Enter a phone number with 7 to 15 digits",
    ],
    [
      "an email address without a domain",
      { name: "Jordan Lee", email: "jordan@" },
      "email",
      "Enter a valid email address, like name@example.com.",
    ],
    [
      "nine specialties",
      { name: "Jordan Lee", specialties: Array.from({ length: 9 }, (_, i) => `Tag ${String(i)}`) },
      "specialties",
      "Add no more than 8 specialties.",
    ],
    [
      "a 41-character specialty",
      { name: "Jordan Lee", specialties: ["x".repeat(41)] },
      "specialties.0",
      "The specialty must be 40 characters or fewer.",
    ],
    [
      "notes over 1000 characters",
      { name: "Jordan Lee", notes: "x".repeat(1001) },
      "notes",
      "The notes must be 1000 characters or fewer.",
    ],
    [
      "a colour that is not on the palette",
      { name: "Jordan Lee", calendarColor: "#ff0000" },
      "calendarColor",
      "Choose one of the available colours.",
    ],
  ])(
    "refuses %s with 422 and the message beside the field",
    async (_what, body, field, message) => {
      const w = await world();
      const response = await create(w, body);

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors?.[field]).toContain(message);
      expect(await prisma.technician.count()).toBe(0);
      expect(await prisma.activityEvent.count()).toBe(0);
    },
  );

  it("refuses keys it does not take: the active flag, an id, a timestamp", async () => {
    const w = await world();
    for (const extra of [{ isActive: false }, { id: MISSING_ID }, { createdAt: NOW }]) {
      expectApiError(await create(w, { name: "Jordan Lee", ...extra }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
    expect(await prisma.technician.count()).toBe(0);
  });

  it("accepts the limits themselves: a 2-character name, 8 tags, 40-character tags, 1000 characters of notes", async () => {
    const w = await world();
    const technician = await created(w, {
      name: "Jo",
      specialties: Array.from({ length: 8 }, (_, i) => `${String(i)}${"x".repeat(39)}`),
      notes: "n".repeat(1000),
    });
    expect(technician.specialties).toHaveLength(8);
    expect(technician.notes).toHaveLength(1000);
  });
});

// ---------------------------------------------------------------------------------------------

describe("editing a technician", () => {
  it("changes only the fields sent, leaving the rest", async () => {
    const w = await world();
    const jordan = await created(w, {
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Air conditioning"],
      notes: "Senior technician.",
      calendarColor: "blue",
    });

    const response = await edit(w, jordan.id, { specialties: ["Air conditioning", "Heat pumps"] });

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Air conditioning", "Heat pumps"],
      notes: "Senior technician.",
      calendarColor: "blue",
    });
  });

  it("clears a phone number, an email and notes with null or blank text", async () => {
    const w = await world();
    const jordan = await created(w, {
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      notes: "Senior technician.",
    });

    const response = await edit(w, jordan.id, { phone: null, email: "", notes: "  " });

    expect(dataOf(response)).toMatchObject({ phone: null, email: null, notes: null });
  });

  it("changes the name, the colour and the specialties together, and records what changed", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee", calendarColor: "blue" });

    await edit(w, jordan.id, {
      name: "Jordan Q. Lee",
      calendarColor: "green",
      specialties: ["Heat pumps"],
    });

    const events = await eventsFor(jordan.id);
    expect(events.map((event) => event.action)).toEqual([
      "technician.created",
      "technician.updated",
    ]);
    expect(events[1]).toMatchObject({
      actorUserId: w.admin.id,
      publicSummary: null,
      metadata: { changedFields: ["name", "specialties", "calendarColor"] },
    });
    expect(events[1]?.summary).toBe(
      `${w.admin.name} updated the technician "Jordan Q. Lee" (changed: name, specialties, calendarColor).`,
    );
  });

  it("does not put what was typed into the history: names of fields only", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });

    await edit(w, jordan.id, {
      email: "jordan.lee@coolbreeze.test",
      phone: "(212) 555-0151",
      notes: "A private note.",
    });

    const event = (await eventsFor(jordan.id))[1];
    const everything = JSON.stringify(event);
    for (const secret of ["jordan.lee@coolbreeze.test", "555-0151", "A private note"]) {
      expect(everything).not.toContain(secret);
    }
    expect(event?.metadata).toEqual({ changedFields: ["phone", "email", "notes"] });
  });

  it("writes nothing and records nothing when nothing would change", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee", specialties: ["Heat pumps"] });
    const before = await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } });

    // The same values, only spaced differently: after trimming there is nothing to change.
    const response = await edit(w, jordan.id, {
      name: " Jordan Lee ",
      specialties: ["Heat pumps"],
    });

    expect(response.status).toBe(200);
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toEqual(before);
    expect(await eventsFor(jordan.id)).toHaveLength(1);
  });

  it("lets an inactive technician be edited", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });
    await deactivate(w, jordan.id);

    const response = await edit(w, jordan.id, { notes: "On leave until April." });

    expect(dataOf(response)).toMatchObject({ isActive: false, notes: "On leave until April." });
  });

  it("refuses the active flag (422): a technician is switched with activate and deactivate", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });

    for (const body of [{ isActive: false }, { name: "Jordan Q. Lee", isActive: false }]) {
      expectApiError(await edit(w, jordan.id, body), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toMatchObject({
      name: "Jordan Lee",
      isActive: true,
    });
  });

  it.each([
    ["an empty change", {}, "_"],
    ["a short name", { name: "J" }, "name"],
    ["a bad phone", { phone: "12" }, "phone"],
    ["a colour off the palette", { calendarColor: "chartreuse" }, "calendarColor"],
  ])("refuses %s with 422 and leaves the technician as it was", async (_what, body, field) => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee", phone: "(212) 555-0151" });
    const before = await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } });

    const error = expectApiError(await edit(w, jordan.id, body), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });

    expect(error.fieldErrors).toHaveProperty(field);
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toEqual(before);
    expect(await eventsFor(jordan.id)).toHaveLength(1);
  });

  it("answers 404 for a technician that does not exist and 422 for an id that is not one", async () => {
    const w = await world();
    expectApiError(await edit(w, MISSING_ID, { name: "Jordan Lee" }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await edit(w, "assignable", { name: "Jordan Lee" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("deactivating and reactivating", () => {
  it("makes a technician inactive, answers with them, and records who did it", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });

    const response = await deactivate(w, jordan.id);

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({
      id: jordan.id,
      isActive: false,
      availableActions: ["EDIT", "ACTIVATE"],
    });
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toMatchObject({
      isActive: false,
    });
    const event = (await eventsFor(jordan.id)).at(-1);
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      action: "technician.deactivated",
      fromStatus: "ACTIVE",
      toStatus: "INACTIVE",
      publicSummary: null,
      metadata: { isActive: false },
    });
    expect(event?.summary).toBe(
      `${w.admin.name} deactivated the technician "Jordan Lee" (no upcoming jobs are assigned).`,
    );
  });

  it("brings an inactive technician back and records it", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });
    await deactivate(w, jordan.id);

    const response = await activate(w, jordan.id);

    expect(dataOf(response)).toMatchObject({
      isActive: true,
      availableActions: ["EDIT", "DEACTIVATE"],
    });
    const event = (await eventsFor(jordan.id)).at(-1);
    expect(event).toMatchObject({
      action: "technician.activated",
      fromStatus: "INACTIVE",
      toStatus: "ACTIVE",
      metadata: { isActive: true },
    });
    expect(event?.summary).toBe(`${w.admin.name} reactivated the technician "Jordan Lee".`);
  });

  it("is idempotent: deactivating twice answers 200 both times and records the change once", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });

    const first = await deactivate(w, jordan.id);
    const stored = await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } });
    const second = await deactivate(w, jordan.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dataOf(second)).toMatchObject({ isActive: false });
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toEqual(stored);
    expect(
      (await eventsFor(jordan.id)).filter((event) => event.action === "technician.deactivated"),
    ).toHaveLength(1);
  });

  it("is idempotent the other way: activating an active technician changes and records nothing", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });
    const stored = await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } });

    const response = await activate(w, jordan.id);

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({ isActive: true });
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toEqual(stored);
    expect(await eventsFor(jordan.id)).toHaveLength(1);
  });

  it("records one change when the same deactivation arrives twice at once", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });

    const answers = await Promise.all([deactivate(w, jordan.id), deactivate(w, jordan.id)]);

    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(
      (await eventsFor(jordan.id)).filter((event) => event.action === "technician.deactivated"),
    ).toHaveLength(1);
    expect(await prisma.technician.findUniqueOrThrow({ where: { id: jordan.id } })).toMatchObject({
      isActive: false,
    });
  });

  it("answers 404 for a technician that does not exist, on both", async () => {
    const w = await world();
    expectApiError(await deactivate(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(await activate(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("tells how many upcoming jobs stay with a deactivated technician, and leaves those jobs alone (FR-060)", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });
    await createJob(w, jordan.id, {
      start: "2026-03-04T14:00:00.000Z",
      end: "2026-03-04T15:00:00.000Z",
    });
    await createJob(w, jordan.id, {
      start: "2026-03-05T14:00:00.000Z",
      end: "2026-03-05T17:00:00.000Z",
      status: "IN_PROGRESS",
    });
    // Not upcoming: finished.
    await createJob(w, jordan.id, {
      start: "2026-03-01T14:00:00.000Z",
      end: "2026-03-01T16:00:00.000Z",
      status: "COMPLETED",
    });
    const jobsBefore = await prisma.workOrder.findMany({ orderBy: { reference: "asc" } });

    const response = await deactivate(w, jordan.id);

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({ isActive: false, upcomingJobCount: 3 });
    expect(dataOf(response).upcomingAssignments).toHaveLength(3);
    // The jobs are exactly as they were: same technician, status and times, not even re-saved.
    expect(await prisma.workOrder.findMany({ orderBy: { reference: "asc" } })).toEqual(jobsBefore);
    const event = (await eventsFor(jordan.id)).at(-1);
    expect(event?.summary).toBe(
      `${w.admin.name} deactivated the technician "Jordan Lee" (3 upcoming jobs stay assigned).`,
    );
  });

  it("still lists a deactivated technician's jobs when they are read, and after reactivation too", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });

    await deactivate(w, jordan.id);
    expect(dataOf(await read(w, jordan.id)).upcomingAssignments).toHaveLength(1);

    await activate(w, jordan.id);
    expect(dataOf(await read(w, jordan.id)).upcomingAssignments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the assignable technicians (FR-061)", () => {
  const assignable = async (w: World) =>
    bodyOf<{ data: AssignableTechnicianDto[] }>(
      await api(w.app).get(`${BASE}/assignable`, { cookie: w.adminCookie }),
    ).data;

  it("is empty when there are no technicians", async () => {
    const w = await world();
    expect(await assignable(w)).toEqual([]);
  });

  it("lists active technicians only, A to Z, with just enough to choose one", async () => {
    const w = await world();
    await createTechnician(prisma, {
      name: "Taylor Brooks",
      specialties: ["Deep cleaning"],
      calendarColor: "amber",
      isActive: false,
    });
    await createTechnician(prisma, {
      name: "Sam Okafor",
      specialties: ["Dryers"],
      calendarColor: "green",
    });
    const jordan = await createTechnician(prisma, {
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      notes: "A private note.",
      specialties: ["Heat pumps"],
      calendarColor: "blue",
    });

    const response = await api(w.app).get(`${BASE}/assignable`, { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: AssignableTechnicianDto[] }>(response).data).toEqual([
      { id: jordan.id, name: "Jordan Lee", specialties: ["Heat pumps"], calendarColor: "blue" },
      expect.objectContaining({ name: "Sam Okafor" }),
    ]);
    const everything = JSON.stringify(response.body);
    for (const left of ["Taylor Brooks", "555-0151", "A private note", "coolbreeze.test"]) {
      expect(everything).not.toContain(left);
    }
  });

  it("follows a deactivation and a reactivation at once", async () => {
    const w = await world();
    const jordan = await created(w, { name: "Jordan Lee" });
    await created(w, { name: "Sam Okafor" });
    expect((await assignable(w)).map((technician) => technician.name)).toEqual([
      "Jordan Lee",
      "Sam Okafor",
    ]);

    await deactivate(w, jordan.id);
    expect((await assignable(w)).map((technician) => technician.name)).toEqual(["Sam Okafor"]);

    await activate(w, jordan.id);
    expect((await assignable(w)).map((technician) => technician.name)).toEqual([
      "Jordan Lee",
      "Sam Okafor",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the list", () => {
  async function team() {
    const w = await world();
    const jordan = await createTechnician(prisma, {
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Air conditioning", "Heat pumps"],
      notes: "A private note.",
      calendarColor: "blue",
    });
    const sam = await createTechnician(prisma, {
      name: "Sam Okafor",
      phone: "(212) 555-0162",
      email: "sam.okafor@coolbreeze.test",
      specialties: ["Washing machines", "Dryers"],
      calendarColor: "green",
    });
    const taylor = await createTechnician(prisma, {
      name: "Taylor Brooks",
      phone: "(646) 555-0173",
      specialties: ["Deep cleaning"],
      calendarColor: "amber",
      isActive: false,
    });
    return { w, jordan, sam, taylor };
  }

  const namesOf = (response: AdminTechnicianListResponse) => response.data.map((item) => item.name);

  it("is the standard envelope, A to Z, with everyone by default", async () => {
    const { w, jordan } = await team();

    const response = await list(w);

    expect(response.status).toBe(200);
    const body = bodyOf<AdminTechnicianListResponse>(response);
    expect(namesOf(body)).toEqual(["Jordan Lee", "Sam Okafor", "Taylor Brooks"]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
    expect(body.data[0]).toEqual({
      id: jordan.id,
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Air conditioning", "Heat pumps"],
      calendarColor: "blue",
      isActive: true,
      upcomingJobCount: 0,
      nextJob: null,
      availableActions: ["EDIT", "DEACTIVATE"],
    });
  });

  it("keeps internal notes out of the list", async () => {
    const { w } = await team();
    const response = await list(w);
    expect(JSON.stringify(response.body)).not.toContain("A private note");
  });

  it("filters by state with active=true, false or all", async () => {
    const { w } = await team();

    expect(namesOf(await listed(w, "?active=true"))).toEqual(["Jordan Lee", "Sam Okafor"]);
    expect(namesOf(await listed(w, "?active=false"))).toEqual(["Taylor Brooks"]);
    expect(namesOf(await listed(w, "?active=all"))).toEqual([
      "Jordan Lee",
      "Sam Okafor",
      "Taylor Brooks",
    ]);
  });

  it("counts each tab, whatever filter or search is applied (they say what choosing a tab shows)", async () => {
    const { w } = await team();

    for (const query of ["", "?active=false", "?q=jordan", "?active=true&q=zzz"]) {
      expect((await listed(w, query)).meta.counts, query).toEqual({
        all: 3,
        active: 2,
        inactive: 1,
      });
    }
  });

  it("suggests the colour the fewest technicians have", async () => {
    const { w } = await team();
    // Blue, green and amber are taken once each; the next in the palette is purple.
    expect((await listed(w)).meta.suggestedColor).toBe("purple");
  });

  it("sorts Z to A and pages through the list", async () => {
    const { w } = await team();

    expect(namesOf(await listed(w, "?order=desc"))).toEqual([
      "Taylor Brooks",
      "Sam Okafor",
      "Jordan Lee",
    ]);
    const second = await listed(w, "?pageSize=2&page=2");
    expect(namesOf(second)).toEqual(["Taylor Brooks"]);
    expect(second.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  describe("search", () => {
    it.each([
      ["a name, ignoring case", "?q=JORDAN", ["Jordan Lee"]],
      ["part of a name", "?q=okaf", ["Sam Okafor"]],
      ["an email address", "?q=sam.okafor@", ["Sam Okafor"]],
      ["a specialty, ignoring case", "?q=heat%20PUMPS", ["Jordan Lee"]],
      ["part of a specialty", "?q=clean", ["Taylor Brooks"]],
      ["a phone number by its digits", "?q=212-555", ["Jordan Lee", "Sam Okafor"]],
      ["a phone number with its brackets", "?q=(646)%20555", ["Taylor Brooks"]],
      ["runs of spaces as one", "?q=Jordan%20%20%20Lee", ["Jordan Lee"]],
      ["nothing, when blank", "?q=%20%20", ["Jordan Lee", "Sam Okafor", "Taylor Brooks"]],
      ["nobody, when nobody fits", "?q=zzzz", []],
    ])("finds %s", async (_what, query, names) => {
      const { w } = await team();
      const body = await listed(w, query);
      expect(namesOf(body)).toEqual(names);
      expect(body.pagination.totalItems).toBe(names.length);
    });

    it("takes % and _ as plain characters, not as wildcards", async () => {
      const { w } = await team();
      expect(namesOf(await listed(w, "?q=%25"))).toEqual([]);
      expect(namesOf(await listed(w, "?q=_"))).toEqual([]);
      expect(namesOf(await listed(w, "?q=J_rdan"))).toEqual([]);
    });

    it("combines with the state filter", async () => {
      const { w } = await team();
      expect(namesOf(await listed(w, "?q=555&active=false"))).toEqual(["Taylor Brooks"]);
      expect(namesOf(await listed(w, "?q=555&active=true"))).toEqual(["Jordan Lee", "Sam Okafor"]);
    });

    it("does not let a quote or a SQL fragment change the query", async () => {
      const { w } = await team();
      const response = await list(w, `?q=${encodeURIComponent("'; DROP TABLE technicians; --")}`);
      expect(response.status).toBe(200);
      expect(await prisma.technician.count()).toBe(3);
    });
  });

  it.each([
    ["an unknown sort field", "?sort=phone"],
    ["a bad order", "?order=sideways"],
    ["a page size over 100", "?pageSize=101"],
    ["a filter that is not true, false or all", "?active=yes"],
    ["a search over 100 characters", `?q=${"x".repeat(101)}`],
  ])("refuses %s with 422", async (_what, query) => {
    const { w } = await team();
    expectApiError(await list(w, query), { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });
});

// ---------------------------------------------------------------------------------------------

describe("upcoming assignments and the 7-day hours, from the real work orders (FR-062)", () => {
  it("has nothing upcoming and no hours booked until there are jobs", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });

    const dto = dataOf(await read(w, jordan.id));

    expect(dto.upcomingJobCount).toBe(0);
    expect(dto.nextJob).toBeNull();
    expect(dto.upcomingAssignments).toEqual([]);
    expect(dto.availability).toEqual([
      { date: "2026-03-02", scheduledMinutes: 0 },
      { date: "2026-03-03", scheduledMinutes: 0 },
      { date: "2026-03-04", scheduledMinutes: 0 },
      { date: "2026-03-05", scheduledMinutes: 0 },
      { date: "2026-03-06", scheduledMinutes: 0 },
      { date: "2026-03-07", scheduledMinutes: 0 },
      { date: "2026-03-08", scheduledMinutes: 0 },
    ]);
  });

  it("lists scheduled and in-progress jobs soonest first, with reference, customer, service, times and status", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const later = await createJob(w, jordan.id, {
      start: "2026-03-04T15:00:00.000Z",
      end: "2026-03-04T17:00:00.000Z",
      serviceName: "Washing Machine Repair",
    });
    const sooner = await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T15:30:00.000Z",
      status: "IN_PROGRESS",
    });

    const dto = dataOf(await read(w, jordan.id));

    expect(dto.upcomingAssignments).toEqual([
      {
        reference: sooner.reference,
        customerName: "Alex Morgan",
        serviceName: "AC Diagnostic Visit",
        scheduledStart: "2026-03-03T14:00:00.000Z",
        scheduledEnd: "2026-03-03T15:30:00.000Z",
        status: "IN_PROGRESS",
      },
      {
        reference: later.reference,
        customerName: "Alex Morgan",
        serviceName: "Washing Machine Repair",
        scheduledStart: "2026-03-04T15:00:00.000Z",
        scheduledEnd: "2026-03-04T17:00:00.000Z",
        status: "SCHEDULED",
      },
    ]);
    expect(dto.upcomingJobCount).toBe(2);
    expect(dto.nextJob).toEqual({
      reference: sooner.reference,
      scheduledStart: "2026-03-03T14:00:00.000Z",
    });
  });

  it("counts only jobs that hold the technician's time: not completed, cancelled, unscheduled or awaiting a new time", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const times = { start: "2026-03-03T14:00:00.000Z", end: "2026-03-03T16:00:00.000Z" };
    const counted = await createJob(w, jordan.id, { ...times, status: "SCHEDULED" });
    for (const status of ["COMPLETED", "CANCELLED", "NEEDS_RESCHEDULING"] as const) {
      await createJob(w, jordan.id, { ...times, status });
    }
    await createJob(w, jordan.id, { status: "PENDING_SCHEDULING" });

    const dto = dataOf(await read(w, jordan.id));

    expect(dto.upcomingAssignments.map((job) => job.reference)).toEqual([counted.reference]);
    expect(dto.upcomingJobCount).toBe(1);
    expect(dto.availability.map((day) => day.scheduledMinutes)).toEqual([0, 120, 0, 0, 0, 0, 0]);
  });

  it("shows a technician only their own jobs", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const sam = await createTechnician(prisma, { name: "Sam Okafor" });
    const mine = await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });
    await createJob(w, sam.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });
    await createJob(w, null, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });

    const dto = dataOf(await read(w, jordan.id));

    expect(dto.upcomingAssignments.map((job) => job.reference)).toEqual([mine.reference]);
    expect(dto.availability[1]?.scheduledMinutes).toBe(120);
  });

  describe("the edges of the window, judged on the business's calendar", () => {
    async function at(start: string, end: string, status: WorkOrderStatus = "SCHEDULED") {
      const w = await world();
      const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
      const job = await createJob(w, jordan.id, { start, end, status });
      return { w, jordan, job };
    }

    it("counts a job under way right now (it has begun, not ended)", async () => {
      const { w, jordan, job } = await at(
        "2026-03-02T08:00:00.000Z",
        "2026-03-02T10:00:00.000Z",
        "IN_PROGRESS",
      );
      expect(dataOf(await read(w, jordan.id)).upcomingAssignments.map((j) => j.reference)).toEqual([
        job.reference,
      ]);
      // The list and the deactivation's count (SQL) agree with the detail (code).
      expect((await listed(w)).data[0]).toMatchObject({
        upcomingJobCount: 1,
        nextJob: { reference: job.reference },
      });
      await deactivate(w, jordan.id);
      expect((await eventsFor(jordan.id)).at(-1)?.summary).toContain(
        "(1 upcoming job stays assigned)",
      );
    });

    it("does not count a job that has ended, though its hours still fill today", async () => {
      const { w, jordan } = await at("2026-03-02T06:00:00.000Z", "2026-03-02T08:00:00.000Z");
      const dto = dataOf(await read(w, jordan.id));
      expect(dto.upcomingAssignments).toEqual([]);
      expect(dto.availability[0]).toEqual({ date: "2026-03-02", scheduledMinutes: 120 });
    });

    it("does not count a job that ends at the very instant of now", async () => {
      const { w, jordan } = await at("2026-03-02T07:00:00.000Z", NOW);

      // The detail applies the rule in code; the list and the deactivation's count apply it in SQL.
      // All three must agree at the edge.
      expect(dataOf(await read(w, jordan.id)).upcomingJobCount).toBe(0);
      expect((await listed(w)).data[0]?.upcomingJobCount).toBe(0);
      await deactivate(w, jordan.id);
      expect((await eventsFor(jordan.id)).at(-1)?.summary).toContain(
        "(no upcoming jobs are assigned)",
      );
    });

    it("counts a job that starts in the last millisecond of the 14th day and not one that starts at the end of it", async () => {
      const last = await at("2026-03-16T03:59:59.999Z", "2026-03-16T08:00:00.000Z");
      expect(dataOf(await read(last.w, last.jordan.id)).upcomingJobCount).toBe(1);
      expect((await listed(last.w)).data[0]?.upcomingJobCount).toBe(1);
    });

    it("leaves out a job that starts exactly when the window ends", async () => {
      const first = await at(WINDOW_END, "2026-03-16T08:00:00.000Z");
      expect(dataOf(await read(first.w, first.jordan.id)).upcomingJobCount).toBe(0);
      expect((await listed(first.w)).data[0]?.upcomingJobCount).toBe(0);
    });

    it("reads today on the business's calendar late in the evening, when UTC is already tomorrow", async () => {
      const w = await world();
      const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
      // 22:30 on 2 Mar in New York is 03:30Z on 3 Mar.
      w.clock.set("2026-03-03T03:30:00.000Z");
      await createJob(w, jordan.id, {
        start: "2026-03-03T04:00:00.000Z",
        end: "2026-03-03T06:00:00.000Z",
      });

      const dto = dataOf(await read(w, jordan.id));

      expect(dto.availability.map((day) => day.date).slice(0, 2)).toEqual([
        "2026-03-02",
        "2026-03-03",
      ]);
      // 23:00 to 01:00 in New York: an hour on each of the two days.
      expect(dto.availability.slice(0, 2).map((day) => day.scheduledMinutes)).toEqual([60, 60]);
    });
  });

  describe("the hours booked on each of the next seven days", () => {
    it("adds up a day's jobs and splits one that crosses the business's midnight", async () => {
      const w = await world();
      const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
      // Today: 150 + 60 minutes.
      await createJob(w, jordan.id, {
        start: "2026-03-02T14:00:00.000Z",
        end: "2026-03-02T16:30:00.000Z",
      });
      await createJob(w, jordan.id, {
        start: "2026-03-02T18:00:00.000Z",
        end: "2026-03-02T19:00:00.000Z",
      });
      // 22:00 on 3 Mar to 02:00 on 4 Mar in New York: two hours on each day.
      await createJob(w, jordan.id, {
        start: "2026-03-04T03:00:00.000Z",
        end: "2026-03-04T07:00:00.000Z",
      });

      const { availability } = dataOf(await read(w, jordan.id));

      expect(availability.map((day) => day.scheduledMinutes)).toEqual([210, 120, 120, 0, 0, 0, 0]);
    });

    it("measures the day the clocks go forward by its real 23 hours", async () => {
      const w = await world();
      const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
      // All of Sunday 8 Mar in New York: 05:00Z to 04:00Z the next day, in two jobs of 12 and 11 hours.
      await createJob(w, jordan.id, {
        start: "2026-03-08T05:00:00.000Z",
        end: "2026-03-08T17:00:00.000Z",
      });
      await createJob(w, jordan.id, {
        start: "2026-03-08T17:00:00.000Z",
        end: "2026-03-09T04:00:00.000Z",
      });

      const { availability } = dataOf(await read(w, jordan.id));

      expect(availability[6]).toEqual({ date: "2026-03-08", scheduledMinutes: 23 * 60 });
      expect(availability.slice(0, 6).every((day) => day.scheduledMinutes === 0)).toBe(true);
    });

    it("leaves a job on the eighth day out of the summary but in the upcoming list", async () => {
      const w = await world();
      const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
      await createJob(w, jordan.id, {
        start: "2026-03-10T15:00:00.000Z",
        end: "2026-03-10T17:00:00.000Z",
      });

      const dto = dataOf(await read(w, jordan.id));

      expect(dto.availability.every((day) => day.scheduledMinutes === 0)).toBe(true);
      expect(dto.upcomingJobCount).toBe(1);
    });
  });

  it("gives the list the count and the next job the detail shows", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const sam = await createTechnician(prisma, { name: "Sam Okafor" });
    await createTechnician(prisma, { name: "Taylor Brooks" });
    const first = await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });
    await createJob(w, jordan.id, {
      start: "2026-03-05T14:00:00.000Z",
      end: "2026-03-05T16:00:00.000Z",
    });
    await createJob(w, jordan.id, {
      start: "2026-03-06T14:00:00.000Z",
      end: "2026-03-06T16:00:00.000Z",
      status: "CANCELLED",
    });
    const only = await createJob(w, sam.id, {
      start: "2026-03-10T14:00:00.000Z",
      end: "2026-03-10T16:00:00.000Z",
    });

    const { data } = await listed(w);

    expect(
      data.map((item) => [item.name, item.upcomingJobCount, item.nextJob?.reference ?? null]),
    ).toEqual([
      ["Jordan Lee", 2, first.reference],
      ["Sam Okafor", 1, only.reference],
      ["Taylor Brooks", 0, null],
    ]);
    expect(data[0]?.nextJob?.scheduledStart).toBe("2026-03-03T14:00:00.000Z");
    for (const item of data) {
      const detail = dataOf(await read(w, item.id));
      expect(detail.upcomingJobCount, item.name).toBe(item.upcomingJobCount);
      expect(detail.nextJob, item.name).toEqual(item.nextJob);
    }
  });

  it("breaks a tie between two jobs that start together the same way every time", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const times = { start: "2026-03-03T14:00:00.000Z", end: "2026-03-03T16:00:00.000Z" };
    await createJob(w, jordan.id, times);
    await createJob(w, jordan.id, times);

    const first = dataOf(await read(w, jordan.id)).upcomingAssignments.map((job) => job.reference);
    const again = dataOf(await read(w, jordan.id)).upcomingAssignments.map((job) => job.reference);
    expect(first).toEqual(again);
    expect(first).toHaveLength(2);
  });

  it("keeps the customer's contact details, the address and the job's internal notes out of an assignment", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    const job = await createJob(w, jordan.id, {
      start: "2026-03-03T14:00:00.000Z",
      end: "2026-03-03T16:00:00.000Z",
    });
    await prisma.workOrder.update({
      where: { id: job.id },
      data: {
        internalCompletionNote: "Customer was rude about the invoice.",
        accessNotesSnapshot: "Gate code 4455",
      },
    });

    const response = await read(w, jordan.id);
    const [assignment] = dataOf(response).upcomingAssignments;

    expect(Object.keys(assignment ?? {}).sort()).toEqual([
      "customerName",
      "reference",
      "scheduledEnd",
      "scheduledStart",
      "serviceName",
      "status",
    ]);
    const everything = JSON.stringify(response.body);
    for (const left of [
      CUSTOMER_EMAIL,
      "214 Larkspur Lane",
      "was rude",
      "Gate code",
      "(212) 555-0100",
    ]) {
      expect(everything).not.toContain(left);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe("reading one technician", () => {
  it("returns the details with the internal notes (this is the admin's shape)", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, {
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Heat pumps"],
      notes: "Senior technician.",
      calendarColor: "teal",
    });

    const response = await read(w, jordan.id);

    expect(response.status).toBe(200);
    expect(Object.keys(dataOf(response)).sort()).toEqual([
      "availability",
      "availableActions",
      "calendarColor",
      "createdAt",
      "email",
      "id",
      "isActive",
      "name",
      "nextJob",
      "notes",
      "phone",
      "specialties",
      "upcomingAssignments",
      "upcomingJobCount",
      "updatedAt",
    ]);
    expect(dataOf(response)).toMatchObject({
      id: jordan.id,
      notes: "Senior technician.",
      calendarColor: "teal",
    });
  });

  it("answers 404 for a technician that does not exist and 422 for an id that is not one", async () => {
    const w = await world();
    expectApiError(await read(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(await read(w, "not-an-id"), { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("is never cached", async () => {
    const w = await world();
    const jordan = await createTechnician(prisma, { name: "Jordan Lee" });
    expect((await read(w, jordan.id)).headers["cache-control"]).toBe("no-store");
  });
});
