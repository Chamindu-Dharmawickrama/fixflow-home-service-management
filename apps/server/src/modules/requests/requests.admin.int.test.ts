import {
  type AdminRequestDto,
  type AdminRequestListResponse,
  type AdminRequestNoteDto,
  type CustomerRequestDto,
  ErrorCode,
  REQUEST_STATUS_ACTIONS,
  RequestAction,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../lib/db.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createBusinessSettings,
  createInvoice,
  createQuotation,
  createService,
  createServiceRequest,
  createWorkOrder,
} from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";
import { canTransition, RequestTrigger, STALE_REQUEST_MESSAGE } from "./requests.domain.js";
import {
  markAccepted,
  markConvertedToJob,
  markDeclined,
  markQuoted,
  revertToUnderReview,
  transitionRequest,
} from "./requests.transitions.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";
const ADMIN_REQUESTS = "/api/v1/admin/requests";
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";
const STATUSES = Object.values(ServiceRequestStatus);
/** The actions of the status endpoint: Create quotation (T14) is not a status change and is not among them. */
const ACTIONS = REQUEST_STATUS_ACTIONS;

const detailPath = (id: string) => `${ADMIN_REQUESTS}/${id}`;
const statusPath = (id: string) => `${ADMIN_REQUESTS}/${id}/status`;
const notesPath = (id: string) => `${ADMIN_REQUESTS}/${id}/notes`;

const INTERNAL_REASON = "Customer is on the do-not-serve list after the March dispute.";
const INTERNAL_NOTE = "Quote high: the last job here ended in an argument.";
const CUSTOMER_MESSAGE = "We do not cover your street yet, sorry for the trouble.";

/** Two customers, an admin, two services, everyone signed in. */
async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  const admin = await createLocalAdmin(prisma);
  await prisma.user.update({ where: { id: admin.id }, data: { name: "Morgan Reyes" } });
  const service = await createService(prisma, { name: "AC Repair", slug: "ac-repair" });
  const cleaning = await createService(prisma, {
    name: "Home Deep Cleaning",
    slug: "deep-cleaning",
  });
  return {
    ...test,
    client: api(test.app),
    alex,
    priya,
    admin,
    service,
    cleaning,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
}

type World = Awaited<ReturnType<typeof world>>;

let sequence = 0;

/** A request inserted directly, so a test can choose its status, time and customer. */
function makeRequest(
  w: World,
  overrides: Partial<Parameters<typeof createServiceRequest>[1]> & {
    owner?: "alex" | "priya";
  } = {},
) {
  sequence += 1;
  const { owner = "alex", ...rest } = overrides;
  return createServiceRequest(prisma, {
    customerId: w[owner].profile.id,
    serviceId: w.service.id,
    serviceNameSnapshot: "AC Repair",
    reference: `FF-2026-9${String(sequence).padStart(4, "0")}`,
    ...rest,
  });
}

function patchStatus(w: World, id: string, body: Record<string, unknown>, cookie = w.adminCookie) {
  return w.client.patch(statusPath(id), { cookie }).send(body);
}

function postNote(w: World, id: string, body: Record<string, unknown>, cookie = w.adminCookie) {
  return w.client.post(notesPath(id), { cookie }).send(body);
}

const listOf = (response: { body: unknown }) => response.body as AdminRequestListResponse;
const requestOf = (response: { body: unknown }) =>
  (response.body as { data: AdminRequestDto }).data;

/** Everything a status change or a note may create or touch, to prove a refusal left nothing behind. */
async function footprint(w: Pick<World, "emails">) {
  const [events, notes, notifications, deliveries] = await Promise.all([
    prisma.activityEvent.count(),
    prisma.requestNote.count(),
    prisma.notification.count(),
    prisma.emailDeliveryLog.count(),
  ]);
  return { events, notes, notifications, deliveries, sent: w.emails.sent.length };
}

async function rowOf(id: string): Promise<string> {
  return JSON.stringify(await prisma.serviceRequest.findUniqueOrThrow({ where: { id } }));
}

describe("authentication and roles", () => {
  it("answers 401 to every endpoint without a session", async () => {
    const { app } = buildTestApp({ prisma });
    const client = api(app);

    for (const response of [
      await client.get(ADMIN_REQUESTS),
      await client.get(detailPath(MISSING_ID)),
      await client.patch(statusPath(MISSING_ID)).send({}),
      await client.post(notesPath(MISSING_ID)).send({}),
    ]) {
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
  });

  it("answers a customer 403 on every endpoint and changes nothing (G.1)", async () => {
    const w = await world();
    const request = await makeRequest(w);
    const before = { row: await rowOf(request.id), footprint: await footprint(w) };

    const responses = [
      await w.client.get(ADMIN_REQUESTS, { cookie: w.alexCookie }),
      await w.client.get(detailPath(request.id), { cookie: w.alexCookie }),
      await patchStatus(
        w,
        request.id,
        { action: "CANCEL", expectedStatus: "SUBMITTED", reason: INTERNAL_REASON },
        w.alexCookie,
      ),
      await postNote(
        w,
        request.id,
        { body: "Hello", visibility: "CUSTOMER_VISIBLE" },
        w.alexCookie,
      ),
    ];

    for (const response of responses) {
      expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
    }
    expect(await rowOf(request.id)).toBe(before.row);
    expect(await footprint(w)).toEqual(before.footprint);
  });

  it("answers an admin who has left the allowlist 403", async () => {
    const w = await world();
    const request = await makeRequest(w);
    const former = await createLocalAdmin(prisma, { email: "former.admin@demo.fixflow.test" });
    const cookie = await signInAs(w.app, former.email);

    expectApiError(await w.client.get(ADMIN_REQUESTS, { cookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(
      await patchStatus(
        w,
        request.id,
        { action: "START_REVIEW", expectedStatus: "SUBMITTED" },
        cookie,
      ),
      { status: 403, code: ErrorCode.FORBIDDEN },
    );
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("SUBMITTED");
  });

  it("refuses a write from another origin (CSRF) and changes nothing", async () => {
    const w = await world();
    const request = await makeRequest(w);
    const before = await rowOf(request.id);

    const status = await w.client
      .patch(statusPath(request.id), { cookie: w.adminCookie, origin: "https://evil.example.com" })
      .send({ action: "START_REVIEW", expectedStatus: "SUBMITTED" });
    const note = await w.client
      .post(notesPath(request.id), { cookie: w.adminCookie, origin: null })
      .send({ body: "Hello", visibility: "INTERNAL" });

    expectApiError(status, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expectApiError(note, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await rowOf(request.id)).toBe(before);
    expect(await prisma.requestNote.count()).toBe(0);
  });

  it("limits admin writes per admin (429 with Retry-After) and not reads", async () => {
    const w = await world({ rateLimits: { adminWrite: { limit: 2, windowSeconds: 60 } } });
    const request = await makeRequest(w);

    await postNote(w, request.id, { body: "One", visibility: "INTERNAL" });
    await postNote(w, request.id, { body: "Two", visibility: "INTERNAL" });
    const third = await postNote(w, request.id, { body: "Three", visibility: "INTERNAL" });
    const status = await patchStatus(w, request.id, {
      action: "START_REVIEW",
      expectedStatus: "SUBMITTED",
    });
    const read = await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie });

    expectApiError(third, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expectApiError(status, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(await prisma.requestNote.count()).toBe(2);
    expect(read.status).toBe(200);
  });
});

describe("GET /admin/requests: the queue (FR-023, G.1)", () => {
  it("lists every customer's requests, newest submitted first, with the queue's fields", async () => {
    const w = await world();
    const older = await makeRequest(w, { submittedAt: new Date("2026-02-01T10:00:00.000Z") });
    const newer = await makeRequest(w, {
      owner: "priya",
      submittedAt: new Date("2026-02-02T10:00:00.000Z"),
      addressCity: "Lakeside",
    });

    const response = await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    const page = listOf(response);
    expect(page.data.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(page.data[0]).toEqual({
      id: newer.id,
      reference: newer.reference,
      status: "SUBMITTED",
      statusLabel: "Submitted",
      isNew: true,
      serviceName: "AC Repair",
      customerName: "Priya Shah",
      city: "Lakeside",
      preferredDate: "2026-11-10",
      preferredWindow: "MORNING",
      submittedAt: "2026-02-02T10:00:00.000Z",
      updatedAt: expect.any(String) as unknown,
    });
    expect(page.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 2, totalPages: 1 });
  });

  it("is an empty page with zero counts when there are no requests", async () => {
    const w = await world();

    const page = listOf(await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie }));

    expect(page.data).toEqual([]);
    expect(page.pagination.totalItems).toBe(0);
    expect(page.meta.totalForFilters).toBe(0);
    expect(Object.keys(page.meta.statusCounts).sort()).toEqual([...STATUSES].sort());
    expect(Object.values(page.meta.statusCounts).every((count) => count === 0)).toBe(true);
  });

  it("flags only SUBMITTED requests as new", async () => {
    const w = await world();
    for (const status of STATUSES) await makeRequest(w, { status });

    const page = listOf(
      await w.client.get(`${ADMIN_REQUESTS}?pageSize=100`, { cookie: w.adminCookie }),
    );

    for (const item of page.data) {
      expect(item.isNew, item.status).toBe(item.status === "SUBMITTED");
    }
  });

  it("pages in twenties by default, up to 100, and says how many there are", async () => {
    const w = await world();
    for (let index = 0; index < 25; index += 1) {
      await makeRequest(w, { submittedAt: new Date(Date.UTC(2026, 0, 1, 10, index)) });
    }

    const first = listOf(await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie }));
    const second = listOf(
      await w.client.get(`${ADMIN_REQUESTS}?page=2`, { cookie: w.adminCookie }),
    );
    const small = listOf(
      await w.client.get(`${ADMIN_REQUESTS}?pageSize=10&page=3`, { cookie: w.adminCookie }),
    );

    expect(first.data).toHaveLength(20);
    expect(second.data).toHaveLength(5);
    expect(first.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 25, totalPages: 2 });
    expect(small.data).toHaveLength(5);
    expect(small.pagination).toEqual({ page: 3, pageSize: 10, totalItems: 25, totalPages: 3 });
    const ids = [...first.data, ...second.data].map((item) => item.id);
    expect(new Set(ids).size).toBe(25);
  });

  describe("invalid queries are 422 (G.1)", () => {
    it.each([
      ["a sort field that is not offered", "?sort=customerName"],
      ["a page size above 100", "?pageSize=101"],
      ["a page below 1", "?page=0"],
      ["an order that is not asc or desc", "?order=sideways"],
      ["an unknown status", "?status=OPEN"],
      ["one unknown status among known ones", "?status=SUBMITTED&status=OPEN"],
      ["a service id that is not an id", "?serviceId=ac-repair"],
      ["a customer id that is not an id", "?customerId=alex"],
      ["a date that does not exist", "?submittedFrom=2026-02-30"],
      ["a date in the wrong format", "?submittedTo=10/03/2026"],
      ["a range that ends before it starts", "?submittedFrom=2026-03-10&submittedTo=2026-03-09"],
      ["a search longer than 100 characters", `?q=${"x".repeat(101)}`],
    ])("refuses %s", async (_name, query) => {
      const w = await world();

      const response = await w.client.get(`${ADMIN_REQUESTS}${query}`, { cookie: w.adminCookie });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {}).length).toBeGreaterThan(0);
    });
  });

  describe("search (q): reference, customer name or email, case-insensitive", () => {
    it("finds by a part of the reference, in either case", async () => {
      const w = await world();
      const target = await makeRequest(w, { reference: "FF-2026-00431" });
      await makeRequest(w, { reference: "FF-2026-00432" });

      const lower = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=ff-2026-00431`, { cookie: w.adminCookie }),
      );
      const part = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=0431`, { cookie: w.adminCookie }),
      );

      expect(lower.data.map((item) => item.id)).toEqual([target.id]);
      expect(part.data.map((item) => item.id)).toEqual([target.id]);
    });

    it("finds by customer name and by customer email, in any case", async () => {
      const w = await world();
      const alexs = await makeRequest(w, { owner: "alex" });
      const priyas = await makeRequest(w, { owner: "priya" });

      const byName = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=ALEX%20mor`, { cookie: w.adminCookie }),
      );
      const byEmail = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=Priya.Shah%40EXAMPLE`, { cookie: w.adminCookie }),
      );

      expect(byName.data.map((item) => item.id)).toEqual([alexs.id]);
      expect(byEmail.data.map((item) => item.id)).toEqual([priyas.id]);
    });

    it("treats % and _ as the characters they are, not as wildcards", async () => {
      const w = await world();
      await makeRequest(w);

      const percent = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=%25`, { cookie: w.adminCookie }),
      );
      const underscore = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=_`, { cookie: w.adminCookie }),
      );

      expect(percent.data).toHaveLength(0);
      expect(underscore.data).toHaveLength(0);
    });

    it("does not search the description, the address or the notes", async () => {
      const w = await world();
      const request = await makeRequest(w, { description: "The compressor makes a zebra noise." });
      await prisma.requestNote.create({
        data: {
          requestId: request.id,
          authorUserId: w.admin.id,
          body: "Quote high, giraffe incident.",
          visibility: "INTERNAL",
        },
      });

      for (const text of ["zebra", "giraffe", "Larkspur"]) {
        const page = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?q=${text}`, { cookie: w.adminCookie }),
        );
        expect(page.data, text).toHaveLength(0);
      }
    });

    it("treats a blank search as no search", async () => {
      const w = await world();
      await makeRequest(w);

      const page = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=%20%20`, { cookie: w.adminCookie }),
      );

      expect(page.data).toHaveLength(1);
    });
  });

  describe("filters", () => {
    it("filters by one status, by several (repeated or comma-separated) and by none", async () => {
      const w = await world();
      await makeRequest(w, { status: "SUBMITTED" });
      await makeRequest(w, { status: "QUOTED" });
      await makeRequest(w, { status: "CANCELLED" });

      const one = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?status=QUOTED`, { cookie: w.adminCookie }),
      );
      const repeated = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?status=QUOTED&status=CANCELLED`, {
          cookie: w.adminCookie,
        }),
      );
      const commas = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?status=SUBMITTED,QUOTED`, { cookie: w.adminCookie }),
      );
      const all = listOf(await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie }));

      expect(one.data.map((item) => item.status)).toEqual(["QUOTED"]);
      expect(repeated.data.map((item) => item.status).sort()).toEqual(["CANCELLED", "QUOTED"]);
      expect(commas.data.map((item) => item.status).sort()).toEqual(["QUOTED", "SUBMITTED"]);
      expect(all.data).toHaveLength(3);
    });

    it("filters by service and by customer, and by both together", async () => {
      const w = await world();
      const alexAc = await makeRequest(w, { owner: "alex" });
      const alexClean = await makeRequest(w, {
        owner: "alex",
        serviceId: w.cleaning.id,
        serviceNameSnapshot: "Home Deep Cleaning",
      });
      const priyaAc = await makeRequest(w, { owner: "priya" });

      const ac = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?serviceId=${w.service.id}`, {
          cookie: w.adminCookie,
        }),
      );
      const alexOnly = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?customerId=${w.alex.profile.id}`, {
          cookie: w.adminCookie,
        }),
      );
      const both = listOf(
        await w.client.get(
          `${ADMIN_REQUESTS}?customerId=${w.alex.profile.id}&serviceId=${w.cleaning.id}`,
          { cookie: w.adminCookie },
        ),
      );

      expect(ac.data.map((item) => item.id).sort()).toEqual([alexAc.id, priyaAc.id].sort());
      expect(alexOnly.data.map((item) => item.id).sort()).toEqual([alexAc.id, alexClean.id].sort());
      expect(both.data.map((item) => item.id)).toEqual([alexClean.id]);
    });

    it("returns nothing for a service or customer that has no requests, not an error", async () => {
      const w = await world();
      await makeRequest(w);

      const page = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?serviceId=${MISSING_ID}`, { cookie: w.adminCookie }),
      );

      expect(page.data).toEqual([]);
    });

    describe("submitted dates are days on the business's calendar (New York), inclusive", () => {
      it("includes the first and the last second of the days asked for, and nothing outside them", async () => {
        const w = await world();
        // 7 March 23:59:59 EST, 8 March 00:00:00 EST (05:00 UTC), 8 March 23:59:59 EDT (the day is 23 hours long), 9 March 00:00 EDT.
        const beforeFrom = await makeRequest(w, {
          submittedAt: new Date("2026-03-08T04:59:59.000Z"),
        });
        const firstSecond = await makeRequest(w, {
          submittedAt: new Date("2026-03-08T05:00:00.000Z"),
        });
        const lastSecond = await makeRequest(w, {
          submittedAt: new Date("2026-03-09T03:59:59.000Z"),
        });
        const afterTo = await makeRequest(w, { submittedAt: new Date("2026-03-09T04:00:00.000Z") });

        const page = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?submittedFrom=2026-03-08&submittedTo=2026-03-08`, {
            cookie: w.adminCookie,
          }),
        );

        const ids = page.data.map((item) => item.id).sort();
        expect(ids).toEqual([firstSecond.id, lastSecond.id].sort());
        expect(ids).not.toContain(beforeFrom.id);
        expect(ids).not.toContain(afterTo.id);
      });

      it("takes a bound on one side only", async () => {
        const w = await world();
        const early = await makeRequest(w, { submittedAt: new Date("2026-01-10T15:00:00.000Z") });
        const late = await makeRequest(w, { submittedAt: new Date("2026-02-20T15:00:00.000Z") });

        const from = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?submittedFrom=2026-02-01`, {
            cookie: w.adminCookie,
          }),
        );
        const to = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?submittedTo=2026-01-31`, { cookie: w.adminCookie }),
        );

        expect(from.data.map((item) => item.id)).toEqual([late.id]);
        expect(to.data.map((item) => item.id)).toEqual([early.id]);
      });

      it("follows the zone in the settings, not a built-in one", async () => {
        const w = await world();
        const request = await makeRequest(w, { submittedAt: new Date("2026-03-08T01:00:00.000Z") });

        // 01:00 UTC on the 8th is the 7th in New York, and the 8th in UTC.
        const newYork = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?submittedFrom=2026-03-08&submittedTo=2026-03-08`, {
            cookie: w.adminCookie,
          }),
        );
        await prisma.businessSettings.updateMany({ data: { timeZone: "UTC" } });
        const utc = listOf(
          await w.client.get(`${ADMIN_REQUESTS}?submittedFrom=2026-03-08&submittedTo=2026-03-08`, {
            cookie: w.adminCookie,
          }),
        );

        expect(newYork.data).toHaveLength(0);
        expect(utc.data.map((item) => item.id)).toEqual([request.id]);
      });
    });

    it("combines search, status, service and dates", async () => {
      const w = await world();
      const target = await makeRequest(w, {
        owner: "alex",
        status: "QUOTED",
        submittedAt: new Date("2026-02-10T15:00:00.000Z"),
      });
      await makeRequest(w, {
        owner: "alex",
        status: "SUBMITTED",
        submittedAt: new Date("2026-02-10T15:00:00.000Z"),
      });
      await makeRequest(w, {
        owner: "priya",
        status: "QUOTED",
        submittedAt: new Date("2026-02-10T15:00:00.000Z"),
      });
      await makeRequest(w, {
        owner: "alex",
        status: "QUOTED",
        submittedAt: new Date("2026-03-01T15:00:00.000Z"),
      });

      const page = listOf(
        await w.client.get(
          `${ADMIN_REQUESTS}?q=alex&status=QUOTED&serviceId=${w.service.id}&submittedFrom=2026-02-01&submittedTo=2026-02-28`,
          { cookie: w.adminCookie },
        ),
      );

      expect(page.data.map((item) => item.id)).toEqual([target.id]);
    });
  });

  describe("sorting", () => {
    it("sorts by submission time and by last change, either way", async () => {
      const w = await world();
      const a = await makeRequest(w, { submittedAt: new Date("2026-02-01T10:00:00.000Z") });
      const b = await makeRequest(w, { submittedAt: new Date("2026-02-02T10:00:00.000Z") });
      const c = await makeRequest(w, { submittedAt: new Date("2026-02-03T10:00:00.000Z") });
      await prisma.serviceRequest.update({
        where: { id: a.id },
        data: { updatedAt: new Date("2026-03-01T10:00:00.000Z") },
      });
      await prisma.serviceRequest.update({
        where: { id: b.id },
        data: { updatedAt: new Date("2026-01-01T10:00:00.000Z") },
      });
      await prisma.serviceRequest.update({
        where: { id: c.id },
        data: { updatedAt: new Date("2026-02-01T10:00:00.000Z") },
      });
      const ids = async (query: string) =>
        listOf(
          await w.client.get(`${ADMIN_REQUESTS}?${query}`, { cookie: w.adminCookie }),
        ).data.map((item) => item.id);

      expect(await ids("sort=submittedAt&order=asc")).toEqual([a.id, b.id, c.id]);
      expect(await ids("sort=submittedAt&order=desc")).toEqual([c.id, b.id, a.id]);
      expect(await ids("sort=updatedAt&order=desc")).toEqual([a.id, c.id, b.id]);
      expect(await ids("sort=updatedAt&order=asc")).toEqual([b.id, c.id, a.id]);
    });

    it("sorts by reference, by the text of the reference", async () => {
      const w = await world();
      const r2 = await makeRequest(w, { reference: "FF-2026-00002" });
      const r10 = await makeRequest(w, { reference: "FF-2026-00010" });
      const r1 = await makeRequest(w, { reference: "FF-2026-00001" });
      const ids = async (order: string) =>
        listOf(
          await w.client.get(`${ADMIN_REQUESTS}?sort=reference&order=${order}`, {
            cookie: w.adminCookie,
          }),
        ).data.map((item) => item.id);

      expect(await ids("asc")).toEqual([r1.id, r2.id, r10.id]);
      expect(await ids("desc")).toEqual([r10.id, r2.id, r1.id]);
    });

    it("sorts by status in the order of the workflow, not the alphabet", async () => {
      const w = await world();
      for (const status of [...STATUSES].reverse()) await makeRequest(w, { status });

      const page = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?sort=status&order=asc&pageSize=100`, {
          cookie: w.adminCookie,
        }),
      );

      expect(page.data.map((item) => item.status)).toEqual([
        "SUBMITTED",
        "UNDER_REVIEW",
        "QUOTED",
        "ACCEPTED",
        "DECLINED",
        "CONVERTED_TO_JOB",
        "CANCELLED",
      ]);
    });

    it("keeps rows with an equal sort value in a stable order across pages", async () => {
      const w = await world();
      const sameTime = new Date("2026-02-01T10:00:00.000Z");
      for (let index = 0; index < 5; index += 1) await makeRequest(w, { submittedAt: sameTime });

      const first = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?pageSize=2&page=1`, { cookie: w.adminCookie }),
      );
      const second = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?pageSize=2&page=2`, { cookie: w.adminCookie }),
      );
      const third = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?pageSize=2&page=3`, { cookie: w.adminCookie }),
      );

      const ids = [...first.data, ...second.data, ...third.data].map((item) => item.id);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe("status counts", () => {
    async function scenario(w: World) {
      await makeRequest(w, { owner: "alex", status: "SUBMITTED" });
      await makeRequest(w, { owner: "alex", status: "SUBMITTED" });
      await makeRequest(w, { owner: "priya", status: "SUBMITTED" });
      await makeRequest(w, { owner: "alex", status: "QUOTED" });
      await makeRequest(w, { owner: "priya", status: "CANCELLED" });
    }

    it("counts every status for the whole queue", async () => {
      const w = await world();
      await scenario(w);

      const { meta } = listOf(await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie }));

      expect(meta.statusCounts).toEqual({
        SUBMITTED: 3,
        UNDER_REVIEW: 0,
        QUOTED: 1,
        ACCEPTED: 0,
        DECLINED: 0,
        CONVERTED_TO_JOB: 0,
        CANCELLED: 1,
      });
      expect(meta.totalForFilters).toBe(5);
    });

    it("ignores the status filter, so a chip can show what choosing it would give", async () => {
      const w = await world();
      await scenario(w);

      const page = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?status=QUOTED`, { cookie: w.adminCookie }),
      );

      expect(page.data).toHaveLength(1);
      expect(page.pagination.totalItems).toBe(1);
      expect(page.meta.statusCounts.SUBMITTED).toBe(3);
      expect(page.meta.statusCounts.QUOTED).toBe(1);
      expect(page.meta.totalForFilters).toBe(5);
    });

    it("follows the search, service, customer and date filters", async () => {
      const w = await world();
      await scenario(w);

      const bySearch = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?q=alex`, { cookie: w.adminCookie }),
      );
      const byCustomer = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?customerId=${w.priya.profile.id}`, {
          cookie: w.adminCookie,
        }),
      );
      const none = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?submittedFrom=2000-01-01&submittedTo=2000-01-02`, {
          cookie: w.adminCookie,
        }),
      );

      expect(bySearch.meta.statusCounts).toMatchObject({ SUBMITTED: 2, QUOTED: 1, CANCELLED: 0 });
      expect(bySearch.meta.totalForFilters).toBe(3);
      expect(byCustomer.meta.statusCounts).toMatchObject({ SUBMITTED: 1, QUOTED: 0, CANCELLED: 1 });
      expect(none.meta.totalForFilters).toBe(0);
    });

    it("counts requests beyond the page being shown", async () => {
      const w = await world();
      for (let index = 0; index < 25; index += 1) await makeRequest(w, { status: "SUBMITTED" });

      const page = listOf(
        await w.client.get(`${ADMIN_REQUESTS}?pageSize=5`, { cookie: w.adminCookie }),
      );

      expect(page.data).toHaveLength(5);
      expect(page.meta.statusCounts.SUBMITTED).toBe(25);
    });
  });

  it("asks the database the same number of questions for one row as for twenty-five (no N+1)", async () => {
    const operations: string[] = [];
    const counting = prisma.$extends({
      query: {
        $allOperations({ model, operation, args, query }) {
          operations.push(`${model ?? "raw"}.${operation}`);
          return query(args);
        },
      },
    }) as unknown as PrismaClient;
    const w = await world({ prisma: counting });
    await makeRequest(w);

    operations.length = 0;
    await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie });
    const forOne = [...operations];

    for (let index = 0; index < 24; index += 1)
      await makeRequest(w, { owner: index % 2 ? "alex" : "priya" });
    operations.length = 0;
    await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie });
    const forMany = [...operations];

    // The session lookup and the settings read are the same for both; the list itself is three queries.
    expect(forMany).toEqual(forOne);
    expect(forMany.filter((name) => name.startsWith("ServiceRequest."))).toEqual([
      "ServiceRequest.findMany",
      "ServiceRequest.count",
      "ServiceRequest.groupBy",
    ]);
  });
});

describe("GET /admin/requests/:id: a request in full (FR-024, G.2)", () => {
  async function fullRequest(w: World) {
    return makeRequest(w, {
      status: "UNDER_REVIEW",
      description: "The AC unit stopped cooling and rattles when it starts.",
      addressLine2: "Unit 4",
      accessNotesSnapshot: "Gate code 4821, friendly dog.",
      preferredWindow: "AFTERNOON",
      preferredStart: new Date("2026-11-10T17:00:00.000Z"),
      preferredEnd: new Date("2026-11-10T21:00:00.000Z"),
    });
  }

  it("has everything the customer sees, the customer's contact details, and the actions on offer", async () => {
    const w = await world();
    const request = await fullRequest(w);

    const response = await w.client.get(detailPath(request.id), { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    expect(requestOf(response)).toMatchObject({
      id: request.id,
      reference: request.reference,
      status: "UNDER_REVIEW",
      statusLabel: "Under review",
      nextStep: "We're preparing your quotation and will let you know as soon as it's ready.",
      serviceId: w.service.id,
      serviceName: "AC Repair",
      description: "The AC unit stopped cooling and rattles when it starts.",
      preferredDate: "2026-11-10",
      preferredWindow: "AFTERNOON",
      preferredStart: "2026-11-10T17:00:00.000Z",
      preferredEnd: "2026-11-10T21:00:00.000Z",
      address: {
        line1: "214 Larkspur Lane",
        line2: "Unit 4",
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
        accessNotes: "Gate code 4821, friendly dog.",
      },
      customer: {
        id: w.alex.profile.id,
        name: "Alex Morgan",
        email: ALEX,
        phone: "(212) 555-0100",
      },
      availableActions: ["CREATE_QUOTATION", "CANCEL"],
      cancellation: null,
    });
  });

  it.each([
    ["SUBMITTED", ["START_REVIEW", "CANCEL"]],
    ["UNDER_REVIEW", ["CREATE_QUOTATION", "CANCEL"]],
    ["QUOTED", ["CANCEL"]],
    // The customer accepted (T15): the work order is listed here and performed by T17.
    ["ACCEPTED", ["CREATE_WORK_ORDER", "CANCEL"]],
    ["DECLINED", ["REOPEN", "CANCEL"]],
    ["CONVERTED_TO_JOB", []],
    ["CANCELLED", []],
  ] as const)("lists the actions D-21 allows for a %s request", async (status, expected) => {
    const w = await world();
    const request = await makeRequest(w, { status });

    const dto = requestOf(await w.client.get(detailPath(request.id), { cookie: w.adminCookie }));

    expect(dto.availableActions).toEqual(expected);
  });

  it("lists every note, both kinds, newest first, with their visibility and author", async () => {
    const w = await world();
    const request = await fullRequest(w);
    await prisma.requestNote.create({
      data: {
        requestId: request.id,
        authorUserId: w.admin.id,
        body: INTERNAL_NOTE,
        visibility: "INTERNAL",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
      },
    });
    await prisma.requestNote.create({
      data: {
        requestId: request.id,
        authorUserId: w.admin.id,
        body: "We will bring a spare capacitor.",
        visibility: "CUSTOMER_VISIBLE",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
      },
    });

    const dto = requestOf(await w.client.get(detailPath(request.id), { cookie: w.adminCookie }));

    expect(
      dto.notes.map((note: AdminRequestNoteDto) => [note.visibility, note.body, note.author.name]),
    ).toEqual([
      ["CUSTOMER_VISIBLE", "We will bring a spare capacitor.", "Morgan Reyes"],
      ["INTERNAL", INTERNAL_NOTE, "Morgan Reyes"],
    ]);
  });

  it("has the admin timeline: internal events and internal summaries, flagged as such", async () => {
    const w = await world();
    const request = await fullRequest(w);
    await prisma.activityEvent.createMany({
      data: [
        {
          actorUserId: w.admin.id,
          entityType: "SERVICE_REQUEST",
          entityId: request.id,
          requestId: request.id,
          customerId: w.alex.profile.id,
          action: "request.flagged",
          summary: "Morgan Reyes flagged this address as a repeat no-show.",
          publicSummary: null,
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
        },
        {
          actorUserId: w.admin.id,
          entityType: "SERVICE_REQUEST",
          entityId: request.id,
          requestId: request.id,
          customerId: w.alex.profile.id,
          action: "request.noted",
          summary: "Morgan Reyes asked for more detail.",
          publicSummary: "We asked you for a little more detail.",
          createdAt: new Date("2026-03-02T10:00:00.000Z"),
        },
      ],
    });

    const dto = requestOf(await w.client.get(detailPath(request.id), { cookie: w.adminCookie }));

    expect(
      dto.timeline.map((event) => [event.summary, event.customerVisible, event.actor?.name]),
    ).toEqual([
      ["Morgan Reyes flagged this address as a repeat no-show.", false, "Morgan Reyes"],
      ["Morgan Reyes asked for more detail.", true, "Morgan Reyes"],
    ]);
    expect(dto.timeline[1]?.publicSummary).toBe("We asked you for a little more detail.");
  });

  it("shows the customer's history: earlier requests, newest first, and their jobs and invoices", async () => {
    const w = await world();
    const current = await fullRequest(w);
    const earlier = await makeRequest(w, {
      status: "CONVERTED_TO_JOB",
      serviceId: w.cleaning.id,
      serviceNameSnapshot: "Home Deep Cleaning",
      submittedAt: new Date("2026-01-15T10:00:00.000Z"),
    });
    const earliest = await makeRequest(w, {
      status: "CANCELLED",
      submittedAt: new Date("2026-01-05T10:00:00.000Z"),
    });
    await makeRequest(w, { owner: "priya", status: "SUBMITTED" });
    const quotation = await createQuotation(prisma, {
      requestId: earlier.id,
      customerId: w.alex.profile.id,
      createdByUserId: w.admin.id,
      status: "ACCEPTED",
      sentAt: new Date("2026-01-16T15:00:00.000Z"),
    });
    const workOrder = await createWorkOrder(prisma, {
      requestId: earlier.id,
      quotationId: quotation.id,
      customerId: w.alex.profile.id,
      serviceId: w.cleaning.id,
      createdByUserId: w.admin.id,
    });
    await createInvoice(prisma, {
      workOrderId: workOrder.id,
      customerId: w.alex.profile.id,
      createdByUserId: w.admin.id,
    });

    const { customer } = requestOf(
      await w.client.get(detailPath(current.id), { cookie: w.adminCookie }),
    );

    expect(customer.previousRequests.map((item) => item.id)).toEqual([earlier.id, earliest.id]);
    expect(customer.previousRequests[0]).toEqual({
      id: earlier.id,
      reference: earlier.reference,
      serviceName: "Home Deep Cleaning",
      status: "CONVERTED_TO_JOB",
      statusLabel: "Converted to job",
      submittedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(customer.totalRequests).toBe(3);
    expect(customer.workOrderCount).toBe(1);
    expect(customer.invoiceCount).toBe(1);
  });

  it("limits the earlier requests to ten but counts them all", async () => {
    const w = await world();
    const current = await makeRequest(w);
    for (let index = 0; index < 12; index += 1) await makeRequest(w);

    const { customer } = requestOf(
      await w.client.get(detailPath(current.id), { cookie: w.adminCookie }),
    );

    expect(customer.previousRequests).toHaveLength(10);
    expect(customer.totalRequests).toBe(13);
  });

  it("has an empty history for a customer's first request", async () => {
    const w = await world();
    const request = await makeRequest(w);

    const { customer } = requestOf(
      await w.client.get(detailPath(request.id), { cookie: w.adminCookie }),
    );

    expect(customer).toMatchObject({
      previousRequests: [],
      totalRequests: 1,
      workOrderCount: 0,
      invoiceCount: 0,
    });
  });

  it("answers 404 for an id that does not exist, and 422 for one that is not an id or is a reference", async () => {
    const w = await world();
    const request = await makeRequest(w);

    expectApiError(await w.client.get(detailPath(MISSING_ID), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await w.client.get(detailPath("not-an-id"), { cookie: w.adminCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await w.client.get(detailPath(request.reference), { cookie: w.adminCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("shows the internal reason and who cancelled a cancelled request", async () => {
    const w = await world();
    const request = await makeRequest(w, {
      status: "CANCELLED",
      cancelReason: INTERNAL_REASON,
      cancelCustomerMessage: CUSTOMER_MESSAGE,
      cancelledAt: new Date("2026-03-02T09:30:00.000Z"),
      cancelledByUserId: w.admin.id,
    });

    const dto = requestOf(await w.client.get(detailPath(request.id), { cookie: w.adminCookie }));

    expect(dto.cancellation).toEqual({
      cancelledAt: "2026-03-02T09:30:00.000Z",
      cancelledBy: { name: "Morgan Reyes" },
      reason: INTERNAL_REASON,
      customerMessage: CUSTOMER_MESSAGE,
    });
  });
});

describe("PATCH /admin/requests/:id/status (FR-025, FR-026, D-21, G.3)", () => {
  describe("starting a review", () => {
    it("moves SUBMITTED to UNDER_REVIEW, writes an event the customer can read, and tells nobody else", async () => {
      const w = await world();
      const request = await makeRequest(w);

      const response = await patchStatus(w, request.id, {
        action: "START_REVIEW",
        expectedStatus: "SUBMITTED",
      });

      expect(response.status).toBe(200);
      const dto = requestOf(response);
      expect(dto).toMatchObject({
        status: "UNDER_REVIEW",
        statusLabel: "Under review",
        availableActions: ["CREATE_QUOTATION", "CANCEL"],
      });
      const events = await prisma.activityEvent.findMany({ where: { requestId: request.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: w.admin.id,
        entityType: "SERVICE_REQUEST",
        entityId: request.id,
        customerId: w.alex.profile.id,
        action: "request.review_started",
        fromStatus: "SUBMITTED",
        toStatus: "UNDER_REVIEW",
        summary: `Morgan Reyes started reviewing request ${request.reference}.`,
        publicSummary: "We started reviewing your request.",
        metadata: { requestReference: request.reference },
      });
      // No notification or email for this step (D-38).
      expect(await prisma.notification.count()).toBe(0);
      expect(w.emails.sent).toHaveLength(0);
    });

    it("shows the customer the new status and the event, in their own words", async () => {
      const w = await world();
      const request = await makeRequest(w);
      await patchStatus(w, request.id, { action: "START_REVIEW", expectedStatus: "SUBMITTED" });

      const customerView = bodyOf<{ data: CustomerRequestDto }>(
        await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
      ).data;

      expect(customerView.status).toBe("UNDER_REVIEW");
      expect(customerView.statusLabel).toBe("Under review");
      expect(customerView.timeline.map((event) => event.publicSummary)).toEqual([
        "We started reviewing your request.",
      ]);
      expect(customerView.timeline[0]).toMatchObject({
        actor: "CoolBreeze Home Services",
        toStatus: "UNDER_REVIEW",
      });
    });

    it("moves the request in the queue and its counts", async () => {
      const w = await world();
      const request = await makeRequest(w);
      await patchStatus(w, request.id, { action: "START_REVIEW", expectedStatus: "SUBMITTED" });

      const page = listOf(await w.client.get(ADMIN_REQUESTS, { cookie: w.adminCookie }));

      expect(page.data[0]).toMatchObject({ status: "UNDER_REVIEW", isNew: false });
      expect(page.meta.statusCounts).toMatchObject({ SUBMITTED: 0, UNDER_REVIEW: 1 });
    });
  });

  describe("cancelling", () => {
    it.each(["SUBMITTED", "UNDER_REVIEW", "QUOTED", "ACCEPTED", "DECLINED"] as const)(
      "cancels a %s request, recording who, when and why",
      async (status) => {
        const w = await world();
        const request = await makeRequest(w, { status });

        const response = await patchStatus(w, request.id, {
          action: "CANCEL",
          expectedStatus: status,
          reason: INTERNAL_REASON,
          customerMessage: CUSTOMER_MESSAGE,
        });

        expect(response.status).toBe(200);
        expect(requestOf(response)).toMatchObject({
          status: "CANCELLED",
          availableActions: [],
          cancellation: {
            reason: INTERNAL_REASON,
            customerMessage: CUSTOMER_MESSAGE,
            cancelledBy: { name: "Morgan Reyes" },
            cancelledAt: w.clock.now().toISOString(),
          },
        });
        const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
        expect(row).toMatchObject({
          status: "CANCELLED",
          cancelReason: INTERNAL_REASON,
          cancelCustomerMessage: CUSTOMER_MESSAGE,
          cancelledAt: w.clock.now(),
          cancelledByUserId: w.admin.id,
        });
        const [event] = await prisma.activityEvent.findMany({ where: { requestId: request.id } });
        expect(event).toMatchObject({
          action: "request.cancelled",
          fromStatus: status,
          toStatus: "CANCELLED",
          summary: `Morgan Reyes cancelled request ${request.reference}.`,
          publicSummary: "We cancelled your request.",
        });
      },
    );

    it("notifies the customer in the app and emails them the message they were meant to read", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "UNDER_REVIEW" });

      await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "UNDER_REVIEW",
        reason: INTERNAL_REASON,
        customerMessage: CUSTOMER_MESSAGE,
      });
      await w.deps.emailDispatcher.idle();

      const notifications = await prisma.notification.findMany();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        recipientUserId: w.alex.user.id,
        type: "REQUEST_CANCELLED",
        title: `Request ${request.reference} was cancelled`,
        message: "Your request for AC Repair was cancelled.",
        linkPath: `/portal/requests/${request.id}`,
        entityId: request.id,
      });
      expect(w.emails.sent).toHaveLength(1);
      const [email] = w.emails.sent;
      expect(email?.to).toBe(ALEX);
      expect(email?.subject).toBe(`Request ${request.reference} was cancelled`);
      expect(email?.text).toContain(CUSTOMER_MESSAGE);
      expect(email?.text).toContain(
        `${w.deps.config.email.publicWebUrl}/portal/requests/${request.id}`,
      );
      const logs = await prisma.emailDeliveryLog.findMany();
      expect(logs.map((log) => [log.template, log.status, log.notificationId])).toEqual([
        ["request-cancelled", "LOGGED", notifications[0]?.id],
      ]);
    });

    it("sends the neutral text, and no message, when the admin wrote none", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "SUBMITTED" });

      await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "SUBMITTED",
        reason: INTERNAL_REASON,
      });
      await w.deps.emailDispatcher.idle();

      const [email] = w.emails.sent;
      expect(email?.text).toContain("has been cancelled, so no work will be scheduled for it");
      expect(email?.text).toContain("If this is not what you expected, please contact us.");
      expect(email?.text).not.toContain("A message from");
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.cancelCustomerMessage).toBeNull();
    });

    it("never lets the internal reason reach the customer: notification, email, request, list, timeline", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "UNDER_REVIEW" });
      await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "UNDER_REVIEW",
        reason: INTERNAL_REASON,
        customerMessage: CUSTOMER_MESSAGE,
      });
      await w.deps.emailDispatcher.idle();

      const customerRequest = await w.client.get(`/api/v1/requests/${request.id}`, {
        cookie: w.alexCookie,
      });
      const customerList = await w.client.get("/api/v1/requests/me", { cookie: w.alexCookie });
      const customerNotifications = await w.client.get("/api/v1/notifications/me", {
        cookie: w.alexCookie,
      });
      const everythingTheCustomerGot = JSON.stringify([
        customerRequest.body,
        customerList.body,
        customerNotifications.body,
        w.emails.sent,
        await prisma.notification.findMany(),
        await prisma.activityEvent.findMany({
          where: { publicSummary: { not: null } },
          select: { publicSummary: true, metadata: true },
        }),
      ]);

      expect(everythingTheCustomerGot).not.toContain("do-not-serve");
      expect(everythingTheCustomerGot).not.toContain("March dispute");
      expect(everythingTheCustomerGot).not.toContain("cancelReason");
      // What they were meant to read is there.
      expect(JSON.stringify(customerRequest.body)).toContain(CUSTOMER_MESSAGE);
      expect(bodyOf<{ data: CustomerRequestDto }>(customerRequest).data.cancellation).toEqual({
        cancelledAt: w.clock.now().toISOString(),
        message: CUSTOMER_MESSAGE,
      });
    });

    it("leaves the request cancelled and the email FAILED, not undone, when the mail server is down", async () => {
      const w = await world();
      w.emails.failWith = Object.assign(new Error("connect ECONNREFUSED smtp.internal:587"), {
        code: "ECONNECTION",
      });
      const request = await makeRequest(w, { status: "SUBMITTED" });

      const response = await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "SUBMITTED",
        reason: INTERNAL_REASON,
      });
      await w.deps.emailDispatcher.idle();

      expect(response.status).toBe(200);
      expect(
        (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe("CANCELLED");
      expect((await prisma.emailDeliveryLog.findMany()).map((log) => log.status)).toEqual([
        "FAILED",
      ]);
      expect(await prisma.notification.count()).toBe(1);
    });

    it("does not change a converted request: it follows its job instead", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "CONVERTED_TO_JOB" });
      const before = await rowOf(request.id);

      const response = await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "CONVERTED_TO_JOB",
        reason: INTERNAL_REASON,
      });

      const error = expectApiError(response, {
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(error.message).toBe(
        "This request is converted to job, so it can no longer be changed.",
      );
      expect(await rowOf(request.id)).toBe(before);
    });
  });

  describe("reopening", () => {
    it("moves DECLINED to UNDER_REVIEW, keeps the reason as an internal note and tells the customer only that it was reopened", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "DECLINED" });
      const reason = "The customer phoned and would like a cheaper option.";

      const response = await patchStatus(w, request.id, {
        action: "REOPEN",
        expectedStatus: "DECLINED",
        reason,
      });

      expect(response.status).toBe(200);
      const dto = requestOf(response);
      expect(dto.status).toBe("UNDER_REVIEW");
      expect(dto.notes).toHaveLength(1);
      expect(dto.notes[0]).toMatchObject({
        visibility: "INTERNAL",
        body: `Reopened the request. Reason: ${reason}`,
        author: { name: "Morgan Reyes" },
      });
      const [event] = await prisma.activityEvent.findMany({ where: { requestId: request.id } });
      expect(event).toMatchObject({
        action: "request.reopened",
        fromStatus: "DECLINED",
        toStatus: "UNDER_REVIEW",
        summary: `Morgan Reyes reopened request ${request.reference}.`,
        publicSummary: "We reopened your request.",
      });
      const customerView = await w.client.get(`/api/v1/requests/${request.id}`, {
        cookie: w.alexCookie,
      });
      expect(JSON.stringify(customerView.body)).not.toContain("cheaper option");
      expect(bodyOf<{ data: CustomerRequestDto }>(customerView).data.notes).toEqual([]);
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  describe("refusals leave the record unchanged (G.3)", () => {
    it("does not take CREATE_QUOTATION: it is not a status change, so it is 422 and nothing is written", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "UNDER_REVIEW" });
      const before = { row: await rowOf(request.id), footprint: await footprint(w) };

      const response = await patchStatus(w, request.id, {
        action: RequestAction.CREATE_QUOTATION,
        expectedStatus: "UNDER_REVIEW",
      });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["action"]);
      expect(await rowOf(request.id)).toBe(before.row);
      expect(await footprint(w)).toEqual(before.footprint);
    });

    it("does not take CREATE_WORK_ORDER either: it is listed for an accepted request but built by T17, so it is 422 and nothing is written", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "ACCEPTED" });
      const before = { row: await rowOf(request.id), footprint: await footprint(w) };

      const response = await patchStatus(w, request.id, {
        action: RequestAction.CREATE_WORK_ORDER,
        expectedStatus: "ACCEPTED",
      });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["action"]);
      expect(await rowOf(request.id)).toBe(before.row);
      expect(await footprint(w)).toEqual(before.footprint);
    });

    /** The actions an admin may not take in each status, with a valid body for each. */
    const REFUSED = STATUSES.flatMap((status) =>
      ACTIONS.filter(
        (action) =>
          !(
            (action === "START_REVIEW" && status === "SUBMITTED") ||
            (action === "REOPEN" && status === "DECLINED") ||
            (action === "CANCEL" && !["CONVERTED_TO_JOB", "CANCELLED"].includes(status))
          ),
      ).map((action) => [status, action] as const),
    );

    it("covers every action in every status where it is not allowed (21 - 7 allowed = 14)", () => {
      expect(REFUSED).toHaveLength(STATUSES.length * ACTIONS.length - 7);
      expect(REFUSED).toHaveLength(14);
    });

    it.each(REFUSED)(
      "a %s request cannot be given %s: 409 INVALID_STATE_TRANSITION",
      async (status, action) => {
        const w = await world();
        const request = await makeRequest(w, { status });
        const before = { row: await rowOf(request.id), footprint: await footprint(w) };

        const response = await patchStatus(w, request.id, {
          action,
          expectedStatus: status,
          ...(action !== "START_REVIEW" && { reason: INTERNAL_REASON }),
        });

        const error = expectApiError(response, {
          status: 409,
          code: ErrorCode.INVALID_STATE_TRANSITION,
        });
        expect(error.details).toMatchObject({ currentStatus: status });
        expect(error.message.length).toBeGreaterThan(10);
        expect(await rowOf(request.id)).toBe(before.row);
        expect(await footprint(w)).toEqual(before.footprint);
      },
    );

    it.each(ACTIONS)(
      "%s on a request whose status has changed is 409 STALE_STATE, and changes nothing",
      async (action) => {
        const w = await world();
        // The admin's screen says SUBMITTED (or DECLINED for a reopening), but someone has moved it on.
        const shown = action === "REOPEN" ? "DECLINED" : "SUBMITTED";
        const request = await makeRequest(w, { status: "QUOTED" });
        const before = { row: await rowOf(request.id), footprint: await footprint(w) };

        const response = await patchStatus(w, request.id, {
          action,
          expectedStatus: shown,
          ...(action !== "START_REVIEW" && { reason: INTERNAL_REASON }),
        });

        const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
        expect(error.message).toBe(STALE_REQUEST_MESSAGE);
        expect(error.message).toBe(
          "This request was updated by someone else. Refresh to see the latest status.",
        );
        expect(error.details).toEqual({ currentStatus: "QUOTED" });
        expect(await rowOf(request.id)).toBe(before.row);
        expect(await footprint(w)).toEqual(before.footprint);
      },
    );

    it("calls it stale, not invalid, when the screen was out of date and the action would not have been allowed anyway", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "CANCELLED" });

      const response = await patchStatus(w, request.id, {
        action: "START_REVIEW",
        expectedStatus: "SUBMITTED",
      });

      expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    });

    it("lets only one of two simultaneous 'start review' clicks win; the other is stale and writes nothing", async () => {
      const w = await world();
      const request = await makeRequest(w);

      const responses = await Promise.all([
        patchStatus(w, request.id, { action: "START_REVIEW", expectedStatus: "SUBMITTED" }),
        patchStatus(w, request.id, { action: "START_REVIEW", expectedStatus: "SUBMITTED" }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const loser = responses.find((response) => response.status === 409);
      expectApiError(loser as NonNullable<typeof loser>, {
        status: 409,
        code: ErrorCode.STALE_STATE,
      });
      expect(await prisma.activityEvent.count({ where: { requestId: request.id } })).toBe(1);
    });

    it("lets only one of two simultaneous cancellations win, with one notification and one email", async () => {
      const w = await world();
      const request = await makeRequest(w, { status: "UNDER_REVIEW" });

      const responses = await Promise.all([
        patchStatus(w, request.id, {
          action: "CANCEL",
          expectedStatus: "UNDER_REVIEW",
          reason: "First reason entered.",
        }),
        patchStatus(w, request.id, {
          action: "CANCEL",
          expectedStatus: "UNDER_REVIEW",
          reason: "Second reason entered.",
        }),
      ]);
      await w.deps.emailDispatcher.idle();

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await prisma.notification.count()).toBe(1);
      expect(w.emails.sent).toHaveLength(1);
      const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      const winner = responses.find((response) => response.status === 200);
      expect(requestOf(winner as NonNullable<typeof winner>).cancellation?.reason).toBe(
        row.cancelReason,
      );
    });
  });

  describe("input rules (G.3)", () => {
    it.each(["CANCEL", "REOPEN"] as const)(
      "%s without a reason is 422 and changes nothing",
      async (action) => {
        const w = await world();
        const request = await makeRequest(w, {
          status: action === "REOPEN" ? "DECLINED" : "SUBMITTED",
        });
        const before = { row: await rowOf(request.id), footprint: await footprint(w) };

        const response = await patchStatus(w, request.id, {
          action,
          expectedStatus: action === "REOPEN" ? "DECLINED" : "SUBMITTED",
        });

        const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
        expect(error.fieldErrors).toEqual({
          reason: "Enter a reason of 5 to 500 characters, so the history says why.",
        });
        expect(await rowOf(request.id)).toBe(before.row);
        expect(await footprint(w)).toEqual(before.footprint);
      },
    );

    it.each([
      ["a blank reason", "     "],
      ["a reason of four characters", "abcd"],
      ["a reason of 501 characters", "x".repeat(501)],
    ])("refuses %s", async (_name, reason) => {
      const w = await world();
      const request = await makeRequest(w);

      const response = await patchStatus(w, request.id, {
        action: "CANCEL",
        expectedStatus: "SUBMITTED",
        reason,
      });

      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(
        (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe("SUBMITTED");
    });

    it("accepts a reason of exactly 5 and exactly 500 characters", async () => {
      const w = await world();
      const short = await makeRequest(w);
      const long = await makeRequest(w);

      expect(
        (
          await patchStatus(w, short.id, {
            action: "CANCEL",
            expectedStatus: "SUBMITTED",
            reason: "fives",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await patchStatus(w, long.id, {
            action: "CANCEL",
            expectedStatus: "SUBMITTED",
            reason: "x".repeat(500),
          })
        ).status,
      ).toBe(200);
    });

    it("refuses a reason when starting a review, and a customer message on anything but a cancellation", async () => {
      const w = await world();
      const request = await makeRequest(w);
      const declined = await makeRequest(w, { status: "DECLINED" });

      const withReason = await patchStatus(w, request.id, {
        action: "START_REVIEW",
        expectedStatus: "SUBMITTED",
        reason: "Because.",
      });
      const withMessage = await patchStatus(w, declined.id, {
        action: "REOPEN",
        expectedStatus: "DECLINED",
        reason: INTERNAL_REASON,
        customerMessage: "Hello",
      });

      expectApiError(withReason, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expectApiError(withMessage, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(
        (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe("SUBMITTED");
      expect(
        (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: declined.id } })).status,
      ).toBe("DECLINED");
    });

    it.each([
      "QUOTED",
      "ACCEPTED",
      "DECLINED",
      "CONVERTED_TO_JOB",
      "UNDER_REVIEW",
      "CANCELLED",
      "MARK_QUOTED",
    ])(
      "cannot be given the status or action %j: only the system sets those (422)",
      async (action) => {
        const w = await world();
        const request = await makeRequest(w, { status: "UNDER_REVIEW" });
        const before = await rowOf(request.id);

        const asAction = await patchStatus(w, request.id, {
          action,
          expectedStatus: "UNDER_REVIEW",
          reason: INTERNAL_REASON,
        });
        const asStatus = await patchStatus(w, request.id, {
          action: "CANCEL",
          expectedStatus: "UNDER_REVIEW",
          reason: INTERNAL_REASON,
          status: action,
        });

        expectApiError(asAction, { status: 422, code: ErrorCode.VALIDATION_ERROR });
        const error = expectApiError(asStatus, { status: 422, code: ErrorCode.VALIDATION_ERROR });
        expect(error.fieldErrors).toEqual({ status: "Unknown field." });
        expect(await rowOf(request.id)).toBe(before);
      },
    );

    it.each([
      "cancelReason",
      "cancelledByUserId",
      "cancelledAt",
      "customerId",
      "reference",
      "role",
    ])("refuses %s in the body: those belong to the server", async (field) => {
      const w = await world();
      const request = await makeRequest(w);

      const response = await patchStatus(w, request.id, {
        action: "START_REVIEW",
        expectedStatus: "SUBMITTED",
        [field]: "x",
      });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toEqual({ [field]: "Unknown field." });
    });

    it("needs the status the screen showed", async () => {
      const w = await world();
      const request = await makeRequest(w);

      const response = await patchStatus(w, request.id, { action: "START_REVIEW" });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toHaveProperty("expectedStatus");
    });

    it("answers 404 for a request that does not exist and 422 for an id that is not one", async () => {
      const w = await world();

      expectApiError(
        await patchStatus(w, MISSING_ID, { action: "START_REVIEW", expectedStatus: "SUBMITTED" }),
        {
          status: 404,
          code: ErrorCode.NOT_FOUND,
        },
      );
      expectApiError(
        await patchStatus(w, "FF-2026-00001", {
          action: "START_REVIEW",
          expectedStatus: "SUBMITTED",
        }),
        {
          status: 422,
          code: ErrorCode.VALIDATION_ERROR,
        },
      );
    });
  });

  it("walks a request through the admin's whole path and writes one event per change (G.5)", async () => {
    const w = await world();
    const request = await makeRequest(w);

    await patchStatus(w, request.id, { action: "START_REVIEW", expectedStatus: "SUBMITTED" });
    // The system, not an endpoint, declines it (T15); the admin then reopens it and finally cancels.
    await prisma.$transaction(async (tx) => {
      await markQuoted(tx, request.id);
      await markDeclined(tx, request.id);
    });
    await patchStatus(w, request.id, {
      action: "REOPEN",
      expectedStatus: "DECLINED",
      reason: "Customer asked again.",
    });
    await patchStatus(w, request.id, {
      action: "CANCEL",
      expectedStatus: "UNDER_REVIEW",
      reason: "Customer moved away.",
    });

    const events = await prisma.activityEvent.findMany({
      where: { requestId: request.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.fromStatus, event.toStatus])).toEqual([
      ["request.review_started", "SUBMITTED", "UNDER_REVIEW"],
      ["request.reopened", "DECLINED", "UNDER_REVIEW"],
      ["request.cancelled", "UNDER_REVIEW", "CANCELLED"],
    ]);
    expect(events.every((event) => event.actorUserId === w.admin.id)).toBe(true);
  });
});

describe("the system's status changes (D-21), for the tasks that come next", () => {
  /** Each function with the one status it may start from and the status it leads to. */
  const FUNCTIONS = [
    ["markQuoted", markQuoted, "UNDER_REVIEW", "QUOTED"],
    ["markAccepted", markAccepted, "QUOTED", "ACCEPTED"],
    ["markDeclined", markDeclined, "QUOTED", "DECLINED"],
    ["revertToUnderReview", revertToUnderReview, "QUOTED", "UNDER_REVIEW"],
    ["markConvertedToJob", markConvertedToJob, "ACCEPTED", "CONVERTED_TO_JOB"],
  ] as const;

  const CASES = FUNCTIONS.map(([name, change, from, to]) => ({ name, change, from, to }));

  it.each(CASES)("$name moves a $from request to $to", async ({ change, from, to }) => {
    const w = await world();
    const request = await makeRequest(w, { status: from });

    const result = await prisma.$transaction((tx) => change(tx, request.id));

    expect(result).toEqual({ from });
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe(to);
  });

  const REFUSED = FUNCTIONS.flatMap(([name, change, from]) =>
    STATUSES.filter((status) => status !== from).map((status) => ({ name, change, status })),
  );

  it("is refused from every other status: 5 functions x 6 statuses = 30 cases", () => {
    expect(REFUSED).toHaveLength(30);
  });

  it.each(REFUSED)(
    "$name on a $status request is 409 INVALID_STATE_TRANSITION and changes nothing",
    async ({ change, status }) => {
      const w = await world();
      const request = await makeRequest(w, { status });
      const before = await rowOf(request.id);

      const attempt = prisma.$transaction((tx) => change(tx, request.id));

      await expect(attempt).rejects.toMatchObject({
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
        details: { currentStatus: status },
      });
      expect(await rowOf(request.id)).toBe(before);
    },
  );

  it("is 404 for a request that does not exist", async () => {
    await createBusinessSettings(prisma);

    await expect(prisma.$transaction((tx) => markQuoted(tx, MISSING_ID))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("cannot make an admin's change: the system may not start a review, cancel or reopen", async () => {
    const w = await world();
    const submitted = await makeRequest(w, { status: "SUBMITTED" });
    const declined = await makeRequest(w, { status: "DECLINED" });

    for (const [id, to] of [
      [submitted.id, "UNDER_REVIEW"],
      [submitted.id, "CANCELLED"],
      [declined.id, "UNDER_REVIEW"],
    ] as const) {
      await expect(
        prisma.$transaction((tx) =>
          transitionRequest(tx, { requestId: id, to, trigger: RequestTrigger.SYSTEM }),
        ),
      ).rejects.toMatchObject({ status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });
    }
    expect(canTransition("SUBMITTED", "UNDER_REVIEW", RequestTrigger.SYSTEM)).toBe(false);
  });

  it("only makes a change that is still valid when it writes: a concurrent change makes one of two callers lose", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "QUOTED" });

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => markAccepted(tx, request.id)),
      prisma.$transaction((tx) => markDeclined(tx, request.id)),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    const final = (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } }))
      .status;
    expect(["ACCEPTED", "DECLINED"]).toContain(final);
  });
});

describe("POST /admin/requests/:id/notes (FR-024, FR-094, BR-19, G.4)", () => {
  it("adds an internal note: stored, attributed, in an event only staff see, and told to nobody", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "UNDER_REVIEW" });

    const response = await postNote(w, request.id, {
      body: `  ${INTERNAL_NOTE}  `,
      visibility: "INTERNAL",
    });

    expect(response.status).toBe(201);
    const note = bodyOf<{ data: AdminRequestNoteDto }>(response).data;
    expect(note).toEqual({
      id: expect.any(String) as unknown,
      body: INTERNAL_NOTE,
      visibility: "INTERNAL",
      author: { name: "Morgan Reyes" },
      createdAt: expect.any(String) as unknown,
    });
    const row = await prisma.requestNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(row).toMatchObject({
      requestId: request.id,
      authorUserId: w.admin.id,
      visibility: "INTERNAL",
    });
    const [event] = await prisma.activityEvent.findMany({ where: { requestId: request.id } });
    expect(event).toMatchObject({
      action: "request.note_added",
      summary: `Morgan Reyes added an internal note to request ${request.reference}.`,
      publicSummary: null,
      customerId: w.alex.profile.id,
      metadata: { requestReference: request.reference, visibility: "INTERNAL" },
    });
    expect(await prisma.notification.count()).toBe(0);
    expect(w.emails.sent).toHaveLength(0);
  });

  it("adds a customer-visible note: it reaches the portal and the customer's timeline, and they are told in the app", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "UNDER_REVIEW" });
    const text = "We will bring a replacement capacitor, so the visit should take about an hour.";

    const response = await postNote(w, request.id, { body: text, visibility: "CUSTOMER_VISIBLE" });

    expect(response.status).toBe(201);
    const [event] = await prisma.activityEvent.findMany({ where: { requestId: request.id } });
    expect(event).toMatchObject({
      action: "request.note_added",
      summary: `Morgan Reyes added a note to request ${request.reference} that the customer can see.`,
      publicSummary: "We added a note to your request.",
      metadata: { requestReference: request.reference, visibility: "CUSTOMER_VISIBLE" },
    });
    const customerView = bodyOf<{ data: CustomerRequestDto }>(
      await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
    ).data;
    expect(customerView.notes).toEqual([
      {
        id: expect.any(String) as unknown,
        body: text,
        author: "CoolBreeze Home Services",
        createdAt: expect.any(String) as unknown,
      },
    ]);
    expect(customerView.timeline.map((item) => item.publicSummary)).toEqual([
      "We added a note to your request.",
    ]);
    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientUserId: w.alex.user.id,
      type: "NOTE_ADDED",
      linkPath: `/portal/requests/${request.id}`,
      entityId: request.id,
    });
    // The notification says a note exists; it does not carry the note, and no email goes out (D-38).
    expect(JSON.stringify(notifications)).not.toContain("replacement capacitor");
    expect(w.emails.sent).toHaveLength(0);
  });

  it("keeps an internal note, and the event that records it, out of everything the customer can read (G.4)", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "UNDER_REVIEW" });
    await postNote(w, request.id, { body: INTERNAL_NOTE, visibility: "INTERNAL" });
    await postNote(w, request.id, { body: "A note for you.", visibility: "CUSTOMER_VISIBLE" });

    const customerRequest = await w.client.get(`/api/v1/requests/${request.id}`, {
      cookie: w.alexCookie,
    });
    const customerList = await w.client.get("/api/v1/requests/me", { cookie: w.alexCookie });
    const customerNotifications = await w.client.get("/api/v1/notifications/me", {
      cookie: w.alexCookie,
    });
    // An admin looking at the customer's endpoint gets the customer's view too (D-41).
    const adminPreview = await w.client.get(`/api/v1/requests/${request.id}`, {
      cookie: w.adminCookie,
    });

    for (const response of [customerRequest, customerList, customerNotifications, adminPreview]) {
      const text = JSON.stringify(response.body);
      expect(text).not.toContain("argument");
      expect(text).not.toContain("Quote high");
      expect(text).not.toContain("an internal note");
    }
    const dto = bodyOf<{ data: CustomerRequestDto }>(customerRequest).data;
    expect(dto.notes.map((note) => note.body)).toEqual(["A note for you."]);
    expect(dto.timeline.map((event) => event.publicSummary)).toEqual([
      "We added a note to your request.",
    ]);
    // The business sees both.
    const adminView = requestOf(
      await w.client.get(detailPath(request.id), { cookie: w.adminCookie }),
    );
    expect(adminView.notes.map((note) => [note.visibility, note.body])).toEqual([
      ["CUSTOMER_VISIBLE", "A note for you."],
      ["INTERNAL", INTERNAL_NOTE],
    ]);
    expect(adminView.timeline.map((event) => event.customerVisible)).toEqual([false, true]);
  });

  it("lists the newest note first", async () => {
    const w = await world();
    const request = await makeRequest(w);
    await postNote(w, request.id, { body: "First.", visibility: "INTERNAL" });
    await postNote(w, request.id, { body: "Second.", visibility: "INTERNAL" });
    // The two are stamped within a millisecond of each other; make the order unambiguous.
    await prisma.requestNote.updateMany({
      where: { body: "Second." },
      data: { createdAt: new Date(Date.now() + 60_000) },
    });

    const dto = requestOf(await w.client.get(detailPath(request.id), { cookie: w.adminCookie }));

    expect(dto.notes.map((note) => note.body)).toEqual(["Second.", "First."]);
  });

  it("allows a note on a cancelled request: the record stays open to comment", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "CANCELLED" });

    const response = await postNote(w, request.id, {
      body: "Customer called to confirm.",
      visibility: "INTERNAL",
    });

    expect(response.status).toBe(201);
  });

  describe("validation", () => {
    it.each([
      ["an empty note", { body: "", visibility: "INTERNAL" }, "body"],
      ["a blank note", { body: "   ", visibility: "INTERNAL" }, "body"],
      ["a note of 2001 characters", { body: "x".repeat(2001), visibility: "INTERNAL" }, "body"],
      ["no visibility", { body: "Hello" }, "visibility"],
      ["an unknown visibility", { body: "Hello", visibility: "PUBLIC" }, "visibility"],
      ["a lower-case visibility", { body: "Hello", visibility: "internal" }, "visibility"],
      [
        "an author in the body",
        { body: "Hello", visibility: "INTERNAL", authorUserId: MISSING_ID },
        "authorUserId",
      ],
    ])("refuses %s with 422, and creates nothing", async (_name, body, field) => {
      const w = await world();
      const request = await makeRequest(w);
      const before = await footprint(w);

      const response = await postNote(w, request.id, body);

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toHaveProperty([field]);
      expect(await footprint(w)).toEqual(before);
    });

    it("accepts 1 and 2000 characters", async () => {
      const w = await world();
      const request = await makeRequest(w);

      expect((await postNote(w, request.id, { body: "x", visibility: "INTERNAL" })).status).toBe(
        201,
      );
      expect(
        (await postNote(w, request.id, { body: "y".repeat(2000), visibility: "INTERNAL" })).status,
      ).toBe(201);
    });

    it("answers 404 for a request that does not exist and 422 for an id that is not one", async () => {
      const w = await world();

      expectApiError(await postNote(w, MISSING_ID, { body: "Hello", visibility: "INTERNAL" }), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expectApiError(await postNote(w, "not-an-id", { body: "Hello", visibility: "INTERNAL" }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(await prisma.requestNote.count()).toBe(0);
    });
  });
});

describe("no way for a customer to read what is internal (BR-19, SEC-DATA-03, FR-094)", () => {
  it("never shows a customer an internal note, a reopening reason, a cancellation reason or an internal event, on any customer endpoint", async () => {
    const w = await world();
    const declined = await makeRequest(w, { status: "DECLINED" });
    const cancelled = await makeRequest(w, { status: "UNDER_REVIEW" });
    await postNote(w, declined.id, { body: INTERNAL_NOTE, visibility: "INTERNAL" });
    await patchStatus(w, declined.id, {
      action: "REOPEN",
      expectedStatus: "DECLINED",
      reason: "Reopened for a call back.",
    });
    await patchStatus(w, cancelled.id, {
      action: "CANCEL",
      expectedStatus: "UNDER_REVIEW",
      reason: INTERNAL_REASON,
    });
    await w.deps.emailDispatcher.idle();

    const responses = [
      await w.client.get("/api/v1/requests/me", { cookie: w.alexCookie }),
      await w.client.get(`/api/v1/requests/${declined.id}`, { cookie: w.alexCookie }),
      await w.client.get(`/api/v1/requests/${cancelled.id}`, { cookie: w.alexCookie }),
      await w.client.get("/api/v1/notifications/me", { cookie: w.alexCookie }),
    ];
    const everything = JSON.stringify([
      responses.map((response) => response.body as unknown),
      w.emails.sent,
    ]);

    for (const secret of [
      "argument",
      "Quote high",
      "Reopened for a call back",
      "do-not-serve",
      "March dispute",
      "Reopened the request",
    ]) {
      expect(everything, secret).not.toContain(secret);
    }
    for (const response of responses.slice(0, 3)) {
      expect(response.status).toBe(200);
    }
  });

  it("does not let another customer see any of it either", async () => {
    const w = await world();
    const request = await makeRequest(w, { status: "UNDER_REVIEW" });
    await postNote(w, request.id, { body: INTERNAL_NOTE, visibility: "INTERNAL" });

    const response = await w.client.get(`/api/v1/requests/${request.id}`, {
      cookie: w.priyaCookie,
    });
    const adminOnly = await w.client.get(detailPath(request.id), { cookie: w.priyaCookie });

    expectApiError(response, { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(adminOnly, { status: 403, code: ErrorCode.FORBIDDEN });
    expect(JSON.stringify([response.body, adminOnly.body])).not.toContain("Quote high");
  });
});
