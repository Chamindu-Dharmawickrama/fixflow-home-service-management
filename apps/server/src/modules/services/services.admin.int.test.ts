import {
  type AdminServiceDto,
  type AdminServiceListResponse,
  ErrorCode,
  type PublicServiceDto,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createBusinessSettings,
  createService,
  createServiceRequest,
} from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const PUBLIC_LIST = "/api/v1/services";
const ADMIN = "/api/v1/admin/services";
const adminOne = (id: string) => `${ADMIN}/${id}`;
const CUSTOMER_EMAIL = "alex.morgan@example.test";
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const ADMIN_KEYS = [
  "archivedAt",
  "availableActions",
  "category",
  "createdAt",
  "currencyCode",
  "estimatedDurationMinutes",
  "fullDescription",
  "id",
  "imageKey",
  "imageUrl",
  "inclusions",
  "isActive",
  "isPublished",
  "name",
  "pricingMode",
  "shortDescription",
  "slug",
  "sortOrder",
  "startingPrice",
  "status",
  "updatedAt",
];

const NEW_FIXED = {
  name: "AC Routine Maintenance",
  category: "Air conditioning",
  shortDescription: "A yearly service that keeps your air conditioner efficient.",
  fullDescription: "A thorough service for split and ducted air conditioners, best in spring.",
  inclusions: ["Filter cleaning", "Refrigerant check"],
  estimatedDurationMinutes: 90,
  pricingMode: "FIXED",
  startingPrice: "129",
  imageKey: "air-conditioning",
  sortOrder: 20,
};

const NEW_QUOTE = {
  name: "Washing Machine Repair",
  category: "Appliance repair",
  shortDescription: "Fixes for washers that will not drain, spin or start.",
  fullDescription: "Front- and top-loading washing machines diagnosed and repaired at your home.",
  pricingMode: "QUOTE_REQUIRED",
};

async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma, { currencyCode: "USD" });
  const test = buildTestApp({ prisma, ...options });
  const admin = await createLocalAdmin(prisma);
  await createLocalCustomer(prisma, { email: CUSTOMER_EMAIL, name: "Alex Morgan" });
  return {
    ...test,
    admin,
    adminCookie: await signInAs(test.app, admin.email),
    customerCookie: await signInAs(test.app, CUSTOMER_EMAIL),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const create = (w: World, body: unknown) =>
  api(w.app)
    .post(ADMIN, { cookie: w.adminCookie })
    .send(body as object);
const edit = (w: World, id: string, body: unknown) =>
  api(w.app)
    .patch(adminOne(id), { cookie: w.adminCookie })
    .send(body as object);
const archive = (w: World, id: string, expectedStatus: string) =>
  api(w.app)
    .post(`${adminOne(id)}/archive`, { cookie: w.adminCookie })
    .send({ expectedStatus });
const restore = (w: World, id: string, expectedStatus: string) =>
  api(w.app)
    .post(`${adminOne(id)}/restore`, { cookie: w.adminCookie })
    .send({ expectedStatus });

const dataOf = (response: { body: unknown }) => (response.body as { data: AdminServiceDto }).data;

async function created(w: World, body: object = NEW_FIXED): Promise<AdminServiceDto> {
  const response = await create(w, body);
  expect(response.status).toBe(201);
  return dataOf(response);
}

async function publicSlugs(w: World): Promise<string[]> {
  const { data } = bodyOf<{ data: PublicServiceDto[] }>(await api(w.app).get(PUBLIC_LIST));
  return data.map((service) => service.slug);
}

function eventsFor(id: string) {
  return prisma.activityEvent.findMany({
    where: { entityType: "SERVICE", entityId: id },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------------------------

describe("access control", () => {
  const cases = [
    ["GET", ADMIN],
    ["GET", adminOne(MISSING_ID)],
    ["POST", ADMIN],
    ["PATCH", adminOne(MISSING_ID)],
    ["POST", `${adminOne(MISSING_ID)}/archive`],
    ["POST", `${adminOne(MISSING_ID)}/restore`],
  ] as const;

  const send = (w: World, method: (typeof cases)[number][0], path: string, cookie?: string) => {
    const client = api(w.app);
    const options = cookie === undefined ? {} : { cookie };
    return method === "GET"
      ? client.get(path, options)
      : method === "POST"
        ? client.post(path, options).send({ expectedStatus: "PUBLISHED", ...NEW_FIXED })
        : client.patch(path, options).send({ name: "Renamed service" });
  };

  it.each(cases)("%s %s is 401 without a session", async (method, path) => {
    const w = await world();

    expectApiError(await send(w, method, path), { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it.each(cases)("%s %s is 403 for a customer", async (method, path) => {
    const w = await world();

    expectApiError(await send(w, method, path, w.customerCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("is 403 for an admin who is no longer on the allowlist (D-71)", async () => {
    const w = await world({ env: { ADMIN_EMAILS: "someone.else@example.test" } });

    expectApiError(await api(w.app).get(ADMIN, { cookie: w.adminCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("changes nothing when a customer or visitor tries to write", async () => {
    const w = await world();
    const service = await createService(prisma, { slug: "existing-service" });

    await api(w.app).post(ADMIN).send(NEW_FIXED);
    await api(w.app).post(ADMIN, { cookie: w.customerCookie }).send(NEW_FIXED);
    await api(w.app)
      .patch(adminOne(service.id), { cookie: w.customerCookie })
      .send({ name: "Hijacked service" });
    await api(w.app)
      .post(`${adminOne(service.id)}/archive`, { cookie: w.customerCookie })
      .send({ expectedStatus: "PUBLISHED" });

    expect(await prisma.service.count()).toBe(1);
    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(service);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("refuses a write from another origin (CSRF)", async () => {
    const w = await world();

    const response = await api(w.app)
      .post(ADMIN, { cookie: w.adminCookie, origin: "https://evil.example.com" })
      .send(NEW_FIXED);

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await prisma.service.count()).toBe(0);
  });

  it("is rate limited per admin (429)", async () => {
    const w = await world({ rateLimits: { adminWrite: { limit: 2, windowSeconds: 60 } } });

    expect((await create(w, NEW_QUOTE)).status).toBe(201);
    expect((await create(w, { ...NEW_QUOTE, name: "Dryer Repair" })).status).toBe(201);
    const limited = await create(w, { ...NEW_QUOTE, name: "Oven Repair" });

    expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(await prisma.service.count()).toBe(2);
    // Reading is not limited.
    expect((await api(w.app).get(ADMIN, { cookie: w.adminCookie })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------

describe("POST /admin/services", () => {
  it("creates a fixed-price service, unpublished, with an admin DTO", async () => {
    const w = await world();

    const response = await create(w, NEW_FIXED);

    expect(response.status).toBe(201);
    const service = dataOf(response);
    expect(Object.keys(service).sort()).toEqual(ADMIN_KEYS);
    expect(service).toMatchObject({
      name: "AC Routine Maintenance",
      slug: "ac-routine-maintenance",
      category: "Air conditioning",
      pricingMode: "FIXED",
      startingPrice: "129.00",
      currencyCode: "USD",
      inclusions: ["Filter cleaning", "Refrigerant check"],
      estimatedDurationMinutes: 90,
      imageKey: "air-conditioning",
      imageUrl: null,
      sortOrder: 20,
      isPublished: false,
      archivedAt: null,
      status: "UNPUBLISHED",
      isActive: false,
      availableActions: ["EDIT", "PUBLISH", "ARCHIVE"],
    });
    expect(await publicSlugs(w)).toEqual([]);
  });

  it("creates a quote-only service with no price", async () => {
    const w = await world();

    const service = await created(w, NEW_QUOTE);

    expect(service).toMatchObject({
      pricingMode: "QUOTE_REQUIRED",
      startingPrice: null,
      inclusions: [],
      estimatedDurationMinutes: null,
      imageKey: null,
      sortOrder: 0,
    });
  });

  it("can be published as it is created, and then appears on the website", async () => {
    const w = await world();

    const service = await created(w, { ...NEW_FIXED, isPublished: true });

    expect(service).toMatchObject({ status: "PUBLISHED", isActive: true });
    expect(await publicSlugs(w)).toEqual(["ac-routine-maintenance"]);
  });

  it("makes the slug from the name, and numbers it when that is taken", async () => {
    const w = await world();

    const first = await created(w, NEW_QUOTE);
    const second = await created(w, NEW_QUOTE);
    const third = await created(w, { ...NEW_QUOTE, name: "  Washing Machine   Repair!  " });

    expect([first.slug, second.slug, third.slug]).toEqual([
      "washing-machine-repair",
      "washing-machine-repair-2",
      "washing-machine-repair-3",
    ]);
  });

  it("uses a slug the admin typed", async () => {
    const w = await world();

    expect((await created(w, { ...NEW_QUOTE, slug: "washer-fix" })).slug).toBe("washer-fix");
  });

  it("is 409 SLUG_TAKEN when a typed slug is used by another service, naming the field", async () => {
    const w = await world();
    await created(w, { ...NEW_QUOTE, slug: "washer-fix" });

    const response = await create(w, { ...NEW_FIXED, slug: "washer-fix" });

    const error = expectApiError(response, { status: 409, code: ErrorCode.SLUG_TAKEN });
    expect(error.fieldErrors).toEqual({
      slug: "Another service already uses this web address. Choose a different one.",
    });
    expect(await prisma.service.count()).toBe(1);
  });

  it("treats an archived service's slug as taken too: the address cannot be reused", async () => {
    const w = await world();
    await createService(prisma, {
      slug: "old-service",
      isPublished: false,
      archivedAt: new Date(),
    });

    expectApiError(await create(w, { ...NEW_QUOTE, slug: "old-service" }), {
      status: 409,
      code: ErrorCode.SLUG_TAKEN,
    });
    expect((await created(w, { ...NEW_QUOTE, name: "Old Service" })).slug).toBe("old-service-2");
  });

  it("gives two simultaneous creations of the same name different slugs, or a clean 409", async () => {
    const w = await world();

    const responses = await Promise.all(Array.from({ length: 4 }, () => create(w, NEW_QUOTE)));

    for (const response of responses) {
      expect([201, 409]).toContain(response.status);
      if (response.status === 409) {
        expect((response.body as { error: { code: string } }).error.code).toBe(
          ErrorCode.SLUG_TAKEN,
        );
      }
    }
    const slugs = (await prisma.service.findMany({ select: { slug: true } })).map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBeGreaterThanOrEqual(1);
  });

  it("is 422 for a fixed-price service without a starting price", async () => {
    const w = await world();
    const { startingPrice: _price, ...withoutPrice } = NEW_FIXED;

    for (const body of [withoutPrice, { ...withoutPrice, startingPrice: null }]) {
      const error = expectApiError(await create(w, body), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(error.fieldErrors).toEqual({
        startingPrice: "Enter a starting price for a fixed-price service.",
      });
    }
    expect(await prisma.service.count()).toBe(0);
  });

  it("is 422 for a price on a quote-only service", async () => {
    const w = await world();

    const error = expectApiError(await create(w, { ...NEW_QUOTE, startingPrice: "50.00" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(error.fieldErrors?.startingPrice).toMatch(/only used with fixed pricing/);
  });

  it.each([
    ["a starting price of zero", { startingPrice: "0" }, "startingPrice"],
    ["a negative starting price", { startingPrice: "-5.00" }, "startingPrice"],
    ["a starting price with three decimals", { startingPrice: "10.555" }, "startingPrice"],
    ["a starting price above the limit", { startingPrice: "1000000.00" }, "startingPrice"],
    ["a starting price sent as a number", { startingPrice: 129 }, "startingPrice"],
    ["a name that is too short", { name: "AC" }, "name"],
    ["a name that is too long", { name: "x".repeat(81) }, "name"],
    ["a category that is too long", { category: "x".repeat(51) }, "category"],
    [
      "a short description that is too short",
      { shortDescription: "Too short" },
      "shortDescription",
    ],
    ["a missing category", { category: undefined }, "category"],
    ["a bad slug", { slug: "Not A Slug" }, "slug"],
    ["a duration below the minimum", { estimatedDurationMinutes: 1 }, "estimatedDurationMinutes"],
    ["a duration above the maximum", { estimatedDurationMinutes: 721 }, "estimatedDurationMinutes"],
    ["a negative display order", { sortOrder: -1 }, "sortOrder"],
    ["an image that is not bundled", { imageKey: "my-photo" }, "imageKey"],
    [
      "a plain-http image address",
      { imageKey: null, imageUrl: "http://example.test/a.jpg" },
      "imageUrl",
    ],
    ["both an image key and an address", { imageUrl: "https://example.test/a.jpg" }, "imageUrl"],
    [
      "thirteen inclusions",
      { inclusions: Array.from({ length: 13 }, (_, i) => `Item ${i}`) },
      "inclusions",
    ],
    ["an inclusion over 120 characters", { inclusions: ["ok", "x".repeat(121)] }, "inclusions.1"],
    ["a blank inclusion", { inclusions: ["ok", "  "] }, "inclusions.1"],
    ["an unknown pricing mode", { pricingMode: "FREE" }, "pricingMode"],
    ["an attempt to set the archive time", { archivedAt: "2026-01-01T00:00:00Z" }, "archivedAt"],
    ["an attempt to set the id", { id: MISSING_ID }, "id"],
  ] as const)("is 422 for %s", async (_name, change, field) => {
    const w = await world();

    const response = await create(w, { ...NEW_FIXED, ...change });

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(typeof error.fieldErrors?.[field]).toBe("string");
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("accepts the boundary values: 12 inclusions of 120 characters, shortest name, longest price", async () => {
    const w = await world();

    const service = await created(w, {
      ...NEW_FIXED,
      name: "AC+",
      inclusions: Array.from(
        { length: 12 },
        (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(118)}`,
      ),
      startingPrice: "999999.99",
      estimatedDurationMinutes: 720,
      sortOrder: 9999,
    });

    expect(service.inclusions).toHaveLength(12);
    expect(service.startingPrice).toBe("999999.99");
  });

  it("records a service.created event with the new state, and the actor", async () => {
    const w = await world();

    const service = await created(w, { ...NEW_FIXED, isPublished: true });

    const events = await eventsFor(service.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: w.admin.id,
      action: "service.created",
      fromStatus: null,
      toStatus: "PUBLISHED",
      publicSummary: null,
      customerId: null,
      metadata: { isPublished: true },
    });
    expect(events[0]?.summary).toBe(
      'Test Admin created and published the service "AC Routine Maintenance".',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("GET /admin/services", () => {
  async function seedCatalogue(w: World) {
    const ac = await created(w, { ...NEW_FIXED, isPublished: true });
    const washer = await created(w, NEW_QUOTE);
    const cleaning = await created(w, {
      ...NEW_QUOTE,
      name: "Home Deep Cleaning",
      category: "Cleaning",
      shortDescription: "A top-to-bottom clean of kitchens, bathrooms and living areas.",
      sortOrder: 50,
    });
    await archive(w, cleaning.id, "UNPUBLISHED");
    return { ac, washer, cleaning };
  }

  const list = (w: World, query = "") =>
    api(w.app).get(`${ADMIN}${query}`, { cookie: w.adminCookie });

  it("lists every service whatever its state, with the admin keys, actions and counts", async () => {
    const w = await world();
    await seedCatalogue(w);

    const response = await list(w);

    expect(response.status).toBe(200);
    const body = bodyOf<AdminServiceListResponse>(response);
    expect(body.data).toHaveLength(3);
    for (const service of body.data) {
      expect(Object.keys(service).sort()).toEqual(ADMIN_KEYS);
    }
    expect(Object.fromEntries(body.data.map((s) => [s.slug, s.status]))).toEqual({
      "washing-machine-repair": "UNPUBLISHED",
      "ac-routine-maintenance": "PUBLISHED",
      "home-deep-cleaning": "ARCHIVED",
    });
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
    expect(body.meta).toEqual({
      counts: { all: 3, published: 1, unpublished: 1, archived: 1 },
      currencyCode: "USD",
    });
  });

  it.each([
    ["published", ["ac-routine-maintenance"]],
    ["unpublished", ["washing-machine-repair"]],
    ["archived", ["home-deep-cleaning"]],
  ])("filters by status=%s", async (status, slugs) => {
    const w = await world();
    await seedCatalogue(w);

    const body = bodyOf<AdminServiceListResponse>(await list(w, `?status=${status}`));

    expect(body.data.map((s) => s.slug)).toEqual(slugs);
    expect(body.pagination.totalItems).toBe(1);
    // The tab counts ignore the filter, so every tab can say how many it holds.
    expect(body.meta.counts).toEqual({ all: 3, published: 1, unpublished: 1, archived: 1 });
  });

  it("searches name, category, slug and description, ignoring case", async () => {
    const w = await world();
    await seedCatalogue(w);

    for (const [search, slug] of [
      ["WASHING", "washing-machine-repair"],
      ["air condi", "ac-routine-maintenance"],
      ["deep-cleaning", "home-deep-cleaning"],
      ["drain, spin", "washing-machine-repair"],
    ] as const) {
      const body = bodyOf<AdminServiceListResponse>(
        await list(w, `?search=${encodeURIComponent(search)}`),
      );
      expect(
        body.data.map((s) => s.slug),
        search,
      ).toEqual([slug]);
    }
    expect(bodyOf<AdminServiceListResponse>(await list(w, "?search=zzzz")).data).toEqual([]);
  });

  it("treats % and _ in a search as plain characters, not wildcards", async () => {
    const w = await world();
    await seedCatalogue(w);

    expect(bodyOf<AdminServiceListResponse>(await list(w, "?search=%25")).data).toEqual([]);
    expect(bodyOf<AdminServiceListResponse>(await list(w, "?search=_")).data).toEqual([]);
  });

  it("combines a status with a search", async () => {
    const w = await world();
    await seedCatalogue(w);

    const body = bodyOf<AdminServiceListResponse>(await list(w, "?status=archived&search=washing"));

    expect(body.data).toEqual([]);
    expect(body.pagination.totalItems).toBe(0);
  });

  it("sorts by the website order by default, and by any allowed field", async () => {
    const w = await world();
    await seedCatalogue(w);

    const slugs = async (query: string) =>
      bodyOf<AdminServiceListResponse>(await list(w, query)).data.map((s) => s.slug);

    expect(await slugs("")).toEqual([
      "washing-machine-repair", // display order 0
      "ac-routine-maintenance", // 20
      "home-deep-cleaning", // 50
    ]);
    expect(await slugs("?sort=name&order=asc")).toEqual([
      "ac-routine-maintenance",
      "home-deep-cleaning",
      "washing-machine-repair",
    ]);
    expect(await slugs("?sort=category&order=desc")).toEqual([
      "home-deep-cleaning",
      "washing-machine-repair",
      "ac-routine-maintenance",
    ]);
  });

  it("paginates, and reports the totals", async () => {
    const w = await world();
    for (const name of [
      "Service One",
      "Service Two",
      "Service Three",
      "Service Four",
      "Service Five",
    ]) {
      await created(w, { ...NEW_QUOTE, name });
    }

    const page2 = bodyOf<AdminServiceListResponse>(await list(w, "?pageSize=2&page=2&sort=name"));

    // Alphabetically: Five, Four | One, Three | Two.
    expect(page2.data.map((s) => s.name)).toEqual(["Service One", "Service Three"]);
    expect(page2.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 5, totalPages: 3 });
    const beyond = bodyOf<AdminServiceListResponse>(await list(w, "?pageSize=2&page=9"));
    expect(beyond.data).toEqual([]);
    expect(beyond.pagination.totalItems).toBe(5);
  });

  it.each([
    ["an unknown status", "?status=deleted"],
    ["a sort field that is not allowed", "?sort=startingPrice"],
    ["a page size above 100", "?pageSize=101"],
    ["a page of zero", "?page=0"],
    ["an order that is not asc or desc", "?order=sideways"],
    ["a search that is too long", `?search=${"x".repeat(101)}`],
  ])("is 422 for %s", async (_name, query) => {
    const w = await world();

    expectApiError(await list(w, query), { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("returns an empty list, with zero counts, when there are no services", async () => {
    const w = await world();

    const body = bodyOf<AdminServiceListResponse>(await list(w));

    expect(body.data).toEqual([]);
    expect(body.meta.counts).toEqual({ all: 0, published: 0, unpublished: 0, archived: 0 });
  });
});

describe("GET /admin/services/:id", () => {
  it("returns any service, whatever its state", async () => {
    const w = await world();
    const service = await created(w);
    await archive(w, service.id, "UNPUBLISHED");

    const response = await api(w.app).get(adminOne(service.id), { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({
      id: service.id,
      status: "ARCHIVED",
      isActive: false,
      availableActions: ["EDIT", "RESTORE"],
    });
    expect(Object.keys(dataOf(response)).sort()).toEqual(ADMIN_KEYS);
  });

  it("is 404 for an unknown id and 422 for something that is not an id", async () => {
    const w = await world();

    expectApiError(await api(w.app).get(adminOne(MISSING_ID), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await api(w.app).get(adminOne("nope"), { cookie: w.adminCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("PATCH /admin/services/:id", () => {
  it("edits fields, returns the new service and leaves the rest alone", async () => {
    const w = await world();
    const service = await created(w);

    const response = await edit(w, service.id, {
      name: "AC Yearly Service",
      shortDescription: "A yearly check that keeps your air conditioner running.",
      inclusions: ["Filter cleaning"],
      startingPrice: "139.5",
      estimatedDurationMinutes: null,
      sortOrder: 5,
    });

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({
      id: service.id,
      name: "AC Yearly Service",
      shortDescription: "A yearly check that keeps your air conditioner running.",
      inclusions: ["Filter cleaning"],
      startingPrice: "139.50",
      estimatedDurationMinutes: null,
      sortOrder: 5,
      // Untouched:
      slug: "ac-routine-maintenance",
      category: "Air conditioning",
      pricingMode: "FIXED",
      imageKey: "air-conditioning",
      status: "UNPUBLISHED",
    });
    expect(dataOf(response).updatedAt >= service.updatedAt).toBe(true);
  });

  it("publishes with isPublished, and the service appears on the website", async () => {
    const w = await world();
    const service = await created(w);
    expect(await publicSlugs(w)).toEqual([]);

    const response = await edit(w, service.id, { isPublished: true });

    expect(dataOf(response)).toMatchObject({
      status: "PUBLISHED",
      isPublished: true,
      isActive: true,
      availableActions: ["EDIT", "UNPUBLISH", "ARCHIVE"],
    });
    expect(await publicSlugs(w)).toEqual(["ac-routine-maintenance"]);
  });

  it("unpublishes with isPublished false, and it leaves the website at once", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });
    expect(await publicSlugs(w)).toEqual(["ac-routine-maintenance"]);

    const response = await edit(w, service.id, { isPublished: false });

    expect(dataOf(response)).toMatchObject({ status: "UNPUBLISHED", isActive: false });
    expect(await publicSlugs(w)).toEqual([]);
    const gone = await api(w.app).get(`/api/v1/services/slug/${service.slug}`);
    expect(gone.status).toBe(404);
  });

  it("can edit content and publish in one request", async () => {
    const w = await world();
    const service = await created(w);

    const response = await edit(w, service.id, { name: "AC Yearly Service", isPublished: true });

    expect(dataOf(response)).toMatchObject({ name: "AC Yearly Service", status: "PUBLISHED" });
    expect((await eventsFor(service.id)).map((event) => event.action)).toEqual([
      "service.created",
      "service.updated",
      "service.published",
    ]);
  });

  it("does nothing, and records nothing, when asked for what already is", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });
    const before = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });

    const response = await edit(w, service.id, {
      isPublished: true,
      name: service.name,
      inclusions: [...service.inclusions],
      startingPrice: "129",
    });

    expect(response.status).toBe(200);
    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(before);
    expect(await eventsFor(service.id)).toHaveLength(1); // only service.created
  });

  it("is 409 INVALID_STATE_TRANSITION to publish an archived service, and nothing changes", async () => {
    const w = await world();
    const service = await created(w);
    await archive(w, service.id, "UNPUBLISHED");
    const before = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });

    const response = await edit(w, service.id, {
      isPublished: true,
      name: "Renamed while archived",
    });

    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.details).toEqual({ currentStatus: "ARCHIVED", action: "PUBLISH" });
    // Not even the rename was applied: the request is refused as a whole.
    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(before);
  });

  it("allows editing the content of an archived service without restoring it", async () => {
    const w = await world();
    const service = await created(w);
    await archive(w, service.id, "UNPUBLISHED");

    const response = await edit(w, service.id, { category: "Appliances", isPublished: false });

    expect(dataOf(response)).toMatchObject({ category: "Appliances", status: "ARCHIVED" });
  });

  describe("expectedStatus (D-46)", () => {
    it("is 409 STALE_STATE when the service has since moved, and nothing changes", async () => {
      const w = await world();
      const service = await created(w, { ...NEW_FIXED, isPublished: true });
      await archive(w, service.id, "PUBLISHED");
      const before = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });

      const response = await edit(w, service.id, {
        name: "Stale edit",
        expectedStatus: "PUBLISHED",
      });

      const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
      expect(error.details).toEqual({ currentStatus: "ARCHIVED" });
      expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(before);
    });

    it("lets an edit through when the state is the one the form saw", async () => {
      const w = await world();
      const service = await created(w, { ...NEW_FIXED, isPublished: true });

      const response = await edit(w, service.id, {
        name: "Fresh edit",
        expectedStatus: "PUBLISHED",
      });

      expect(dataOf(response).name).toBe("Fresh edit");
    });

    it("lets only one of two simultaneous opposite changes win", async () => {
      const w = await world();
      const service = await created(w, { ...NEW_FIXED, isPublished: true });

      const [archived, unpublished] = await Promise.all([
        archive(w, service.id, "PUBLISHED"),
        edit(w, service.id, { isPublished: false, expectedStatus: "PUBLISHED" }),
      ]);

      expect([archived.status, unpublished.status].sort()).toEqual([200, 409]);
      const final = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
      // Whichever won, the row is consistent: archived implies unpublished.
      expect(final.isPublished).toBe(false);
      const lifecycleEvents = (await eventsFor(service.id)).filter((e) =>
        ["service.archived", "service.unpublished"].includes(e.action),
      );
      expect(lifecycleEvents).toHaveLength(1);
    });
  });

  describe("slug", () => {
    it("can be changed, and the old address stops working", async () => {
      const w = await world();
      const service = await created(w, { ...NEW_FIXED, isPublished: true });

      const response = await edit(w, service.id, { slug: "ac-yearly" });

      expect(dataOf(response).slug).toBe("ac-yearly");
      expect((await api(w.app).get("/api/v1/services/slug/ac-routine-maintenance")).status).toBe(
        404,
      );
      expect((await api(w.app).get("/api/v1/services/slug/ac-yearly")).status).toBe(200);
    });

    it("is 409 SLUG_TAKEN when another service has it, and nothing changes", async () => {
      const w = await world();
      const first = await created(w, NEW_FIXED);
      const second = await created(w, NEW_QUOTE);
      const before = await prisma.service.findUniqueOrThrow({ where: { id: second.id } });

      const response = await edit(w, second.id, { slug: first.slug, name: "Name changed too" });

      const error = expectApiError(response, { status: 409, code: ErrorCode.SLUG_TAKEN });
      expect(error.fieldErrors?.slug).toBeDefined();
      expect(await prisma.service.findUniqueOrThrow({ where: { id: second.id } })).toEqual(before);
      expect(await eventsFor(second.id)).toHaveLength(1);
    });

    it("may be sent unchanged without conflicting with itself", async () => {
      const w = await world();
      const service = await created(w);

      expect((await edit(w, service.id, { slug: service.slug, sortOrder: 3 })).status).toBe(200);
    });
  });

  describe("pricing", () => {
    it("is 422 to make a service fixed-price without a price", async () => {
      const w = await world();
      const service = await created(w, NEW_QUOTE);

      const response = await edit(w, service.id, { pricingMode: "FIXED" });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toEqual({
        startingPrice: "Enter a starting price for a fixed-price service.",
      });
      expect(
        (await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).pricingMode,
      ).toBe("QUOTE_REQUIRED");
    });

    it("switches to fixed pricing when a price comes with it", async () => {
      const w = await world();
      const service = await created(w, NEW_QUOTE);

      const response = await edit(w, service.id, { pricingMode: "FIXED", startingPrice: "89" });

      expect(dataOf(response)).toMatchObject({ pricingMode: "FIXED", startingPrice: "89.00" });
    });

    it("clears the price when a fixed-price service becomes quote-only", async () => {
      const w = await world();
      const service = await created(w, NEW_FIXED);

      const response = await edit(w, service.id, { pricingMode: "QUOTE_REQUIRED" });

      expect(dataOf(response)).toMatchObject({
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: null,
      });
      const row = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
      expect(row.startingPrice).toBeNull();
    });

    it("is 422 to send a price together with quote-only pricing", async () => {
      const w = await world();
      const service = await created(w, NEW_FIXED);

      expectApiError(
        await edit(w, service.id, { pricingMode: "QUOTE_REQUIRED", startingPrice: "50" }),
        {
          status: 422,
          code: ErrorCode.VALIDATION_ERROR,
        },
      );
      expectApiError(await edit(w, service.id, { startingPrice: null }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(
        (
          await prisma.service.findUniqueOrThrow({ where: { id: service.id } })
        ).startingPrice?.toFixed(2),
      ).toBe("129.00");
    });

    it("is 422 to add an address to a service that already has a bundled picture", async () => {
      const w = await world();
      const service = await created(w, NEW_FIXED);

      const response = await edit(w, service.id, { imageUrl: "https://example.test/a.jpg" });

      expect(
        expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR }).fieldErrors
          ?.imageUrl,
      ).toBe("Choose either a bundled picture or a web address, not both.");
    });

    it("swaps the picture for an address by sending both fields", async () => {
      const w = await world();
      const service = await created(w, NEW_FIXED);

      const response = await edit(w, service.id, {
        imageKey: null,
        imageUrl: "https://cdn.example.test/ac.jpg",
      });

      expect(dataOf(response)).toMatchObject({
        imageKey: null,
        imageUrl: "https://cdn.example.test/ac.jpg",
      });
    });
  });

  it("is 404 for an unknown service and 422 for an empty body or an unknown field", async () => {
    const w = await world();
    const service = await created(w);

    expectApiError(await edit(w, MISSING_ID, { name: "Nothing here" }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await edit(w, service.id, {}), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await edit(w, service.id, { archivedAt: null }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await edit(w, service.id, { expectedStatus: "UNPUBLISHED" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("leaves the service untouched when validation fails, whatever else was valid in the body", async () => {
    const w = await world();
    const service = await created(w);
    const before = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });

    const response = await edit(w, service.id, {
      name: "A perfectly good name",
      sortOrder: 9,
      category: "x".repeat(51),
    });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).toEqual(before);
  });

  it("records service.updated with the changed field names, never their values", async () => {
    const w = await world();
    const service = await created(w);

    await edit(w, service.id, {
      name: "AC Yearly Service",
      fullDescription: "A confidential description that must not be copied into the history log.",
      sortOrder: 7,
    });

    const [, updated] = await eventsFor(service.id);
    expect(updated).toMatchObject({
      actorUserId: w.admin.id,
      action: "service.updated",
      publicSummary: null,
      metadata: { changedFields: ["name", "fullDescription", "sortOrder"] },
    });
    expect(updated?.summary).toBe(
      'Test Admin updated the service "AC Yearly Service" (changed: name, fullDescription, sortOrder).',
    );
    expect(JSON.stringify(updated)).not.toContain("confidential description");
  });
});

// ---------------------------------------------------------------------------------------------

describe("archive and restore", () => {
  it("archives a published service: it leaves the website and cannot be found by address or id", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });

    const response = await archive(w, service.id, "PUBLISHED");

    expect(response.status).toBe(200);
    const archived = dataOf(response);
    expect(archived).toMatchObject({
      status: "ARCHIVED",
      isPublished: false,
      isActive: false,
      availableActions: ["EDIT", "RESTORE"],
    });
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(await publicSlugs(w)).toEqual([]);
    expect((await api(w.app).get(`/api/v1/services/slug/${service.slug}`)).status).toBe(404);
    expect((await api(w.app).get(`/api/v1/services/${service.id}`)).status).toBe(404);
  });

  it("stamps the archive time from the clock", async () => {
    const w = await world();
    const service = await created(w);
    // Inside the 7-day session the admin signed in with, so the cookie is still valid.
    w.clock.set(new Date("2026-03-04T14:30:00.000Z"));

    const archived = dataOf(await archive(w, service.id, "UNPUBLISHED"));

    expect(archived.archivedAt).toBe("2026-03-04T14:30:00.000Z");
  });

  it("archives an unpublished service too", async () => {
    const w = await world();
    const service = await created(w);

    expect(dataOf(await archive(w, service.id, "UNPUBLISHED")).status).toBe("ARCHIVED");
  });

  it("restores an archived service as unpublished: it does not reappear on the website", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });
    await archive(w, service.id, "PUBLISHED");

    const response = await restore(w, service.id, "ARCHIVED");

    expect(response.status).toBe(200);
    expect(dataOf(response)).toMatchObject({
      status: "UNPUBLISHED",
      isPublished: false,
      isActive: false,
      archivedAt: null,
      availableActions: ["EDIT", "PUBLISH", "ARCHIVE"],
    });
    expect(await publicSlugs(w)).toEqual([]);

    // …until the admin publishes it again.
    await edit(w, service.id, { isPublished: true });
    expect(await publicSlugs(w)).toEqual([service.slug]);
  });

  it("keeps every other detail through an archive and restore round trip", async () => {
    const w = await world();
    const service = await created(w, NEW_FIXED);

    await archive(w, service.id, "UNPUBLISHED");
    const restored = dataOf(await restore(w, service.id, "ARCHIVED"));

    expect({ ...restored, updatedAt: "" }).toEqual({ ...service, updatedAt: "" });
  });

  it("is 409 INVALID_STATE_TRANSITION to archive twice or restore what is not archived", async () => {
    const w = await world();
    const service = await created(w);
    await archive(w, service.id, "UNPUBLISHED");

    const again = await archive(w, service.id, "ARCHIVED");
    expect(
      expectApiError(again, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION }).details,
    ).toEqual({ currentStatus: "ARCHIVED", action: "ARCHIVE" });

    const live = await created(w, NEW_QUOTE);
    const wrong = await restore(w, live.id, "UNPUBLISHED");
    expect(
      expectApiError(wrong, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION }).details,
    ).toEqual({ currentStatus: "UNPUBLISHED", action: "RESTORE" });
    expect(
      (await prisma.service.findUniqueOrThrow({ where: { id: live.id } })).archivedAt,
    ).toBeNull();
  });

  it("is 409 STALE_STATE when the caller's view is out of date, and nothing changes", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });

    const response = await archive(w, service.id, "UNPUBLISHED"); // it is in fact published

    const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: "PUBLISHED" });
    const row = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
    expect(row).toMatchObject({ isPublished: true, archivedAt: null });
    expect(await publicSlugs(w)).toEqual([service.slug]);
  });

  it("lets exactly one of two simultaneous archives win", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });

    const responses = await Promise.all([
      archive(w, service.id, "PUBLISHED"),
      archive(w, service.id, "PUBLISHED"),
      archive(w, service.id, "PUBLISHED"),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(
      (await eventsFor(service.id)).filter((e) => e.action === "service.archived"),
    ).toHaveLength(1);
  });

  it("needs expectedStatus, and rejects unknown fields and ids", async () => {
    const w = await world();
    const service = await created(w);

    const missing = await api(w.app)
      .post(`${adminOne(service.id)}/archive`, { cookie: w.adminCookie })
      .send({});
    expectApiError(missing, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    const extra = await api(w.app)
      .post(`${adminOne(service.id)}/archive`, { cookie: w.adminCookie })
      .send({ expectedStatus: "UNPUBLISHED", reason: "nope" });
    expectApiError(extra, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expectApiError(await archive(w, MISSING_ID, "PUBLISHED"), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await restore(w, "nope", "ARCHIVED"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(
      (await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).archivedAt,
    ).toBeNull();
  });

  it("leaves existing requests untouched: an archived service is only hidden", async () => {
    const w = await world();
    const service = await created(w, { ...NEW_FIXED, isPublished: true });
    const { profile } = await createLocalCustomer(prisma, { email: "priya.shah@example.test" });
    const request = await createServiceRequest(prisma, {
      customerId: profile.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
    });

    await archive(w, service.id, "PUBLISHED");

    const after = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after).toEqual(request);
    expect(after.serviceNameSnapshot).toBe("AC Routine Maintenance");
  });

  it("records the lifecycle in the history: from and to status, in order", async () => {
    const w = await world();
    const service = await created(w);

    await edit(w, service.id, { isPublished: true });
    await edit(w, service.id, { isPublished: false });
    await edit(w, service.id, { isPublished: true });
    await archive(w, service.id, "PUBLISHED");
    await restore(w, service.id, "ARCHIVED");

    const events = await eventsFor(service.id);
    expect(events.map((e) => [e.action, e.fromStatus, e.toStatus])).toEqual([
      ["service.created", null, "UNPUBLISHED"],
      ["service.published", "UNPUBLISHED", "PUBLISHED"],
      ["service.unpublished", "PUBLISHED", "UNPUBLISHED"],
      ["service.published", "UNPUBLISHED", "PUBLISHED"],
      ["service.archived", "PUBLISHED", "ARCHIVED"],
      ["service.restored", "ARCHIVED", "UNPUBLISHED"],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        actorUserId: w.admin.id,
        entityType: "SERVICE",
        entityId: service.id,
        publicSummary: null,
        customerId: null,
      });
    }
    expect(events[4]?.summary).toBe('Test Admin archived the service "AC Routine Maintenance".');
    expect(events[4]?.metadata).toEqual({ isPublished: false });
  });

  it("records nothing for a rejected transition", async () => {
    const w = await world();
    const service = await created(w);
    await archive(w, service.id, "UNPUBLISHED");
    const count = await prisma.activityEvent.count();

    await archive(w, service.id, "ARCHIVED");
    await restore(w, service.id, "UNPUBLISHED");
    await edit(w, service.id, { isPublished: true });

    expect(await prisma.activityEvent.count()).toBe(count);
  });
});
