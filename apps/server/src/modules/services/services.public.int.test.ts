import { ErrorCode, type PublicServiceDto } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createBusinessSettings, createService } from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const LIST = "/api/v1/services";
const bySlug = (slug: string) => `/api/v1/services/slug/${slug}`;
const byId = (id: string) => `/api/v1/services/${id}`;

/** Exactly what a visitor may read. */
const PUBLIC_KEYS = [
  "category",
  "currencyCode",
  "estimatedDurationMinutes",
  "fullDescription",
  "id",
  "imageKey",
  "imageUrl",
  "inclusions",
  "name",
  "pricingMode",
  "shortDescription",
  "slug",
  "startingPrice",
];

const ARCHIVED_AT = new Date("2026-10-20T08:00:00.000Z");

/** One service in each state, plus a second active one in another category. */
async function catalogue() {
  await createBusinessSettings(prisma, { currencyCode: "EUR" });
  const active = await createService(prisma, {
    name: "AC Routine Maintenance",
    slug: "ac-routine-maintenance",
    category: "Air conditioning",
    pricingMode: "FIXED",
    startingPrice: "129.00",
    inclusions: ["Filter cleaning", "Refrigerant check"],
    estimatedDurationMinutes: 90,
    imageKey: "air-conditioning",
    sortOrder: 20,
  });
  const cleaning = await createService(prisma, {
    name: "Home Deep Cleaning",
    slug: "home-deep-cleaning",
    category: "Cleaning",
    sortOrder: 50,
  });
  const unpublished = await createService(prisma, {
    name: "Draft Service",
    slug: "draft-service",
    isPublished: false,
  });
  const archived = await createService(prisma, {
    name: "Retired Service",
    slug: "retired-service",
    isPublished: false,
    archivedAt: ARCHIVED_AT,
  });
  // Archived while still flagged published: the worst case must still stay off the website.
  const archivedAndPublished = await createService(prisma, {
    name: "Inconsistent Service",
    slug: "inconsistent-service",
    isPublished: true,
    archivedAt: ARCHIVED_AT,
  });
  const { app } = buildTestApp({ prisma });
  return { app, active, cleaning, unpublished, archived, archivedAndPublished };
}

describe("GET /services", () => {
  it("needs no sign-in and returns active services only", async () => {
    const { app } = await catalogue();

    const response = await api(app).get(LIST);

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: PublicServiceDto[] }>(response);
    expect(data.map((service) => service.slug)).toEqual([
      "ac-routine-maintenance",
      "home-deep-cleaning",
    ]);
  });

  it("is a plain list in the success envelope, never cached", async () => {
    const { app } = await catalogue();

    const response = await api(app).get(LIST);

    expect(Object.keys(response.body as object)).toEqual(["data"]);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("orders by display order, then by name", async () => {
    const { app, active, cleaning } = await catalogue();
    await prisma.service.update({
      where: { id: cleaning.id },
      data: { sortOrder: 20, name: "A Cleaning" },
    });
    await prisma.service.update({ where: { id: active.id }, data: { sortOrder: 20 } });
    await createService(prisma, { name: "First Service", slug: "first-service", sortOrder: 5 });

    const { data } = bodyOf<{ data: PublicServiceDto[] }>(await api(app).get(LIST));

    expect(data.map((service) => service.name)).toEqual([
      "First Service",
      "A Cleaning",
      "AC Routine Maintenance",
    ]);
  });

  it("filters by category, ignoring case", async () => {
    const { app } = await catalogue();

    for (const category of ["Cleaning", "cleaning", "CLEANING"]) {
      const { data } = bodyOf<{ data: PublicServiceDto[] }>(
        await api(app).get(`${LIST}?category=${category}`),
      );
      expect(
        data.map((service) => service.slug),
        category,
      ).toEqual(["home-deep-cleaning"]);
    }
    const none = bodyOf<{ data: PublicServiceDto[] }>(
      await api(app).get(`${LIST}?category=Plumbing`),
    );
    expect(none.data).toEqual([]);
  });

  it("does not leak an inactive service through a category filter", async () => {
    const { app } = await catalogue();
    await createService(prisma, {
      slug: "hidden-cleaning",
      category: "Cleaning",
      isPublished: false,
    });

    const { data } = bodyOf<{ data: PublicServiceDto[] }>(
      await api(app).get(`${LIST}?category=Cleaning`),
    );

    expect(data.map((service) => service.slug)).toEqual(["home-deep-cleaning"]);
  });

  it("returns an empty list, not an error, when nothing is published", async () => {
    await createBusinessSettings(prisma);
    const { app } = buildTestApp({ prisma });

    const response = await api(app).get(LIST);

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: unknown[] }>(response).data).toEqual([]);
  });

  it("has exactly the public keys on every service, and no lifecycle or staff field", async () => {
    const { app } = await catalogue();

    const response = await api(app).get(LIST);

    for (const service of bodyOf<{ data: PublicServiceDto[] }>(response).data) {
      expect(Object.keys(service).sort()).toEqual(PUBLIC_KEYS);
    }
    const json = JSON.stringify(response.body);
    for (const hidden of [
      "isPublished",
      "archivedAt",
      "sortOrder",
      "createdAt",
      "updatedAt",
      "availableActions",
      "isActive",
      "status",
    ]) {
      expect(json, hidden).not.toContain(hidden);
    }
  });

  it("serializes the price as a decimal string beside the business currency", async () => {
    const { app } = await catalogue();

    const { data } = bodyOf<{ data: PublicServiceDto[] }>(await api(app).get(LIST));

    expect(data[0]).toMatchObject({
      pricingMode: "FIXED",
      startingPrice: "129.00",
      currencyCode: "EUR",
      estimatedDurationMinutes: 90,
      inclusions: ["Filter cleaning", "Refrigerant check"],
      imageKey: "air-conditioning",
      imageUrl: null,
    });
    expect(data[1]).toMatchObject({ pricingMode: "QUOTE_REQUIRED", startingPrice: null });
  });

  it("looks the same to an admin and a customer: the website view has no admin variant", async () => {
    const { app } = await catalogue();
    await createLocalAdmin(prisma);
    await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const anonymous = bodyOf<{ data: PublicServiceDto[] }>(await api(app).get(LIST)).data;

    for (const email of ["admin@demo.fixflow.test", "alex.morgan@example.test"]) {
      const cookie = await signInAs(app, email);
      const seen = bodyOf<{ data: PublicServiceDto[] }>(await api(app).get(LIST, { cookie })).data;
      expect(seen).toEqual(anonymous);
    }
  });

  it("is 422 for a category that is too long", async () => {
    const { app } = await catalogue();

    expectApiError(await api(app).get(`${LIST}?category=${"x".repeat(51)}`), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

describe("GET /services/slug/:slug", () => {
  it("returns an active service", async () => {
    const { app } = await catalogue();

    const response = await api(app).get(bySlug("ac-routine-maintenance"));

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: PublicServiceDto }>(response);
    expect(Object.keys(data).sort()).toEqual(PUBLIC_KEYS);
    expect(data).toMatchObject({ name: "AC Routine Maintenance", startingPrice: "129.00" });
  });

  it.each(["draft-service", "retired-service", "inconsistent-service", "no-such-service"])(
    "is 404 for %s: unpublished, archived and missing look the same",
    async (slug) => {
      const { app } = await catalogue();

      const error = expectApiError(await api(app).get(bySlug(slug)), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      expect(error.message).toBe("That service is not available.");
    },
  );

  it("is 422 for something that is not a slug", async () => {
    const { app } = await catalogue();

    expectApiError(await api(app).get(bySlug("Not_A_Slug")), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await api(app).get(bySlug("a".repeat(81))), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

describe("GET /services/:id", () => {
  it("returns an active service", async () => {
    const { app, active } = await catalogue();

    const response = await api(app).get(byId(active.id));

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: PublicServiceDto }>(response).data.slug).toBe("ac-routine-maintenance");
  });

  it("is 404 for an unpublished, an archived and an unknown service, even to an admin", async () => {
    const { app, unpublished, archived, archivedAndPublished } = await catalogue();
    await createLocalAdmin(prisma);
    const adminCookie = await signInAs(app, "admin@demo.fixflow.test");

    for (const id of [
      unpublished.id,
      archived.id,
      archivedAndPublished.id,
      "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    ]) {
      expectApiError(await api(app).get(byId(id), { cookie: adminCookie }), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
    }
  });

  it("is 422 for an id that is not a UUID", async () => {
    const { app } = await catalogue();

    expectApiError(await api(app).get(byId("ac-routine-maintenance")), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("does not shadow the slug route: 'slug' is never read as an id", async () => {
    const { app } = await catalogue();

    const response = await api(app).get("/api/v1/services/slug");

    expect(response.status).toBe(422);
  });
});
