import {
  type AuthMeDto,
  type CustomerProfileDto,
  type DeletedAddressDto,
  ErrorCode,
  type FieldErrors,
  type ServiceAddressDto,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectDbRejection, SqlState } from "../../test/db-assertions.js";
import {
  createAddress as insertAddress,
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

const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";
const ME = "/api/v1/customers/me";
const ADDRESSES = "/api/v1/customers/me/addresses";
const addressPath = (id: string) => `${ADDRESSES}/${id}`;
const defaultPath = (id: string) => `${ADDRESSES}/${id}/default`;
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const NEW_ADDRESS = {
  label: "Rental unit",
  line1: "73 Millrace Court",
  city: "Harbor City",
  region: "NY",
  postalCode: "10998",
};

/** An app with two customers and an admin, each signed in. */
async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  const admin = await createLocalAdmin(prisma);
  const client = api(test.app);
  return {
    ...test,
    client,
    alex,
    priya,
    admin,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function addressesOf(customerId: string) {
  return prisma.serviceAddress.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
  });
}

async function defaultsOf(customerId: string): Promise<string[]> {
  const rows = await prisma.serviceAddress.findMany({ where: { customerId, isDefault: true } });
  return rows.map((row) => row.id);
}

/** Every row and column of a customer's account, to prove a rejected request changed nothing. */
async function snapshotOf(userId: string, customerId: string): Promise<string> {
  const [user, profile, addresses] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.customerProfile.findUniqueOrThrow({ where: { id: customerId } }),
    prisma.serviceAddress.findMany({ where: { customerId }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ user, profile, addresses });
}

function alexAddress(w: World, overrides: Parameters<typeof insertAddress>[2] = {}) {
  return insertAddress(prisma, w.alex.profile.id, overrides);
}

async function postAddress(w: World, body: Record<string, unknown> = NEW_ADDRESS) {
  return w.client.post(ADDRESSES, { cookie: w.alexCookie }).send(body);
}

describe("authentication and roles", () => {
  const ENDPOINTS = [
    ["GET", ME],
    ["PATCH", ME],
    ["GET", ADDRESSES],
    ["POST", ADDRESSES],
    ["PATCH", addressPath(MISSING_ID)],
    ["DELETE", addressPath(MISSING_ID)],
    ["POST", defaultPath(MISSING_ID)],
  ] as const;

  function call(
    client: ReturnType<typeof api>,
    method: (typeof ENDPOINTS)[number][0],
    path: string,
    cookie?: string,
  ) {
    const options = cookie === undefined ? {} : { cookie };
    switch (method) {
      case "GET":
        return client.get(path, options);
      case "PATCH":
        return client.patch(path, options).send({ name: "Someone Else" });
      case "POST":
        return client.post(path, options).send(NEW_ADDRESS);
      case "DELETE":
        return client.delete(path, options);
    }
  }

  it.each(ENDPOINTS)("answers 401 to %s %s without a session", async (method, path) => {
    const { app } = buildTestApp({ prisma });

    const response = await call(api(app), method, path);

    expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it.each(ENDPOINTS)(
    "answers an admin 403 to %s %s (admins have no customer profile)",
    async (method, path) => {
      const w = await world();
      const alexBefore = await snapshotOf(w.alex.user.id, w.alex.profile.id);
      const adminBefore = JSON.stringify(
        await prisma.user.findUniqueOrThrow({ where: { id: w.admin.id } }),
      );

      const response = await call(w.client, method, path, w.adminCookie);

      expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
      expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(alexBefore);
      expect(
        JSON.stringify(await prisma.user.findUniqueOrThrow({ where: { id: w.admin.id } })),
      ).toBe(adminBefore);
      expect(await prisma.serviceAddress.count()).toBe(0);
    },
  );

  it("refuses an unsafe request from another origin (CSRF) and changes nothing", async () => {
    const w = await world();
    const before = await snapshotOf(w.alex.user.id, w.alex.profile.id);

    const patch = await w.client
      .patch(ME, { cookie: w.alexCookie, origin: "https://evil.example.com" })
      .send({ name: "Hijacked" });
    const post = await w.client
      .post(ADDRESSES, { cookie: w.alexCookie, origin: null })
      .send(NEW_ADDRESS);

    expectApiError(patch, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expectApiError(post, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(before);
  });

  it("limits writes per customer (429 with Retry-After) and not reads", async () => {
    const w = await world({ rateLimits: { customerWrite: { limit: 2, windowSeconds: 60 } } });

    await w.client.patch(ME, { cookie: w.alexCookie }).send({ phone: "(212) 555-0101" });
    await w.client.patch(ME, { cookie: w.alexCookie }).send({ phone: "(212) 555-0102" });
    const third = await w.client
      .patch(ME, { cookie: w.alexCookie })
      .send({ phone: "(212) 555-0103" });
    const read = await w.client.get(ME, { cookie: w.alexCookie });
    const otherCustomer = await w.client
      .patch(ME, { cookie: w.priyaCookie })
      .send({ name: "Priya S" });

    expectApiError(third, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect(
      (await prisma.customerProfile.findUniqueOrThrow({ where: { id: w.alex.profile.id } })).phone,
    ).toBe("(212) 555-0102");
    expect(read.status).toBe(200);
    expect(otherCustomer.status).toBe(200);
  });
});

describe("GET /customers/me", () => {
  it("returns the profile and the addresses, default first, and nothing about anyone else", async () => {
    const w = await world();
    const first = await alexAddress(w, {
      label: "Beach house",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const home = await alexAddress(w, {
      label: "Home",
      isDefault: true,
      accessNotes: "Buzz apartment 2B.",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const third = await alexAddress(w, {
      label: "Office",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    await insertAddress(prisma, w.priya.profile.id, {
      label: "Priya's private house",
      isDefault: true,
    });

    const response = await w.client.get(ME, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: CustomerProfileDto }>(response);
    expect(data).toMatchObject({
      name: "Alex Morgan",
      email: ALEX,
      phone: "(212) 555-0100",
      avatarUrl: null,
      hasPassword: true,
      hasGoogle: false,
      passwordChangeLocked: false,
    });
    expect(data.addresses.map((address) => address.id)).toEqual([home.id, first.id, third.id]);
    expect(data.addresses[0]).toMatchObject({
      label: "Home",
      isDefault: true,
      accessNotes: "Buzz apartment 2B.",
    });
    expect(JSON.stringify(data)).not.toContain("Priya");
  });

  it("returns exactly the profile keys: no role, no ids, no credentials", async () => {
    const w = await world();
    await alexAddress(w, { isDefault: true });

    const { data } = bodyOf<{ data: CustomerProfileDto }>(
      await w.client.get(ME, { cookie: w.alexCookie }),
    );
    const json = JSON.stringify(data);

    expect(Object.keys(data).sort()).toEqual([
      "addresses",
      "avatarUrl",
      "email",
      "hasGoogle",
      "hasPassword",
      "name",
      "passwordChangeLocked",
      "phone",
    ]);
    expect(Object.keys(data.addresses[0] ?? {}).sort()).toEqual([
      "accessNotes",
      "city",
      "createdAt",
      "id",
      "isDefault",
      "label",
      "line1",
      "line2",
      "postalCode",
      "region",
      "updatedAt",
    ]);
    expect(json).not.toContain(w.alex.user.id);
    expect(json).not.toContain(w.alex.profile.id);
    expect(json).not.toContain("argon2");
    expect(json).not.toContain("CUSTOMER");
  });

  it("answers an empty list for a customer with no address", async () => {
    const w = await world();

    const { data } = bodyOf<{ data: CustomerProfileDto }>(
      await w.client.get(ME, { cookie: w.priyaCookie }),
    );

    expect(data.addresses).toEqual([]);
  });

  it("reports a Google-only customer as having no password", async () => {
    const w = await world();
    await prisma.user.update({
      where: { id: w.alex.user.id },
      data: { passwordHash: null, googleSubject: "google-subject-alex-123456" },
    });

    const { data } = bodyOf<{ data: CustomerProfileDto }>(
      await w.client.get(ME, { cookie: w.alexCookie }),
    );

    expect(data).toMatchObject({ hasPassword: false, hasGoogle: true });
    expect(JSON.stringify(data)).not.toContain("google-subject-alex-123456");
  });

  it("locks password changes for a demo account only while demo mode is on (D-09)", async () => {
    const demo = await world({ env: { DEMO_MODE: "true" } });
    const ordinary = await createLocalCustomer(prisma, { email: "visitor@example.test" });
    const visitorCookie = await signInAs(demo.app, ordinary.user.email);

    const asDemoAccount = bodyOf<{ data: CustomerProfileDto }>(
      await demo.client.get(ME, { cookie: demo.alexCookie }),
    );
    const asVisitor = bodyOf<{ data: CustomerProfileDto }>(
      await demo.client.get(ME, { cookie: visitorCookie }),
    );
    // The same database and the same session, read by an API that is not in demo mode.
    const notDemoMode = buildTestApp({ prisma });
    const outsideDemo = bodyOf<{ data: CustomerProfileDto }>(
      await api(notDemoMode.app).get(ME, { cookie: demo.alexCookie }),
    );

    expect(asDemoAccount.data.passwordChangeLocked).toBe(true);
    expect(asVisitor.data.passwordChangeLocked).toBe(false);
    expect(outsideDemo.data.passwordChangeLocked).toBe(false);
  });
});

describe("PATCH /customers/me (G.1)", () => {
  it("updates the name and the phone number, trimmed and tidied, and returns the profile", async () => {
    const w = await world();

    const response = await w.client
      .patch(ME, { cookie: w.alexCookie })
      .send({ name: "  Alexandra Morgan ", phone: "  (212)   555-0142 " });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: CustomerProfileDto }>(response).data).toMatchObject({
      name: "Alexandra Morgan",
      phone: "(212) 555-0142",
      email: ALEX,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.alex.user.id } })).name).toBe(
      "Alexandra Morgan",
    );
    expect(
      (await prisma.customerProfile.findUniqueOrThrow({ where: { id: w.alex.profile.id } })).phone,
    ).toBe("(212) 555-0142");
  });

  it("changes only what was sent", async () => {
    const w = await world();

    await w.client.patch(ME, { cookie: w.alexCookie }).send({ phone: "+44 20 7946 0958" });
    const afterPhone = await prisma.user.findUniqueOrThrow({ where: { id: w.alex.user.id } });
    await w.client.patch(ME, { cookie: w.alexCookie }).send({ name: "Alexandra Morgan" });
    const profile = await prisma.customerProfile.findUniqueOrThrow({
      where: { id: w.alex.profile.id },
    });

    expect(afterPhone.name).toBe("Alex Morgan");
    expect(profile.phone).toBe("+44 20 7946 0958");
  });

  it.each([null, "", "   "])("clears the phone number when it is sent as %j", async (phone) => {
    const w = await world();

    const response = await w.client.patch(ME, { cookie: w.alexCookie }).send({ phone });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: CustomerProfileDto }>(response).data.phone).toBeNull();
    expect(
      (await prisma.customerProfile.findUniqueOrThrow({ where: { id: w.alex.profile.id } })).phone,
    ).toBeNull();
  });

  it("shows the new name wherever the account is shown (GET /auth/me)", async () => {
    const w = await world();

    await w.client.patch(ME, { cookie: w.alexCookie }).send({ name: "Alexandra Morgan" });
    const me = await w.client.get("/api/v1/auth/me", { cookie: w.alexCookie });

    expect(bodyOf<{ data: AuthMeDto }>(me).data.user.name).toBe("Alexandra Morgan");
  });

  it.each([
    ["role", { role: "BUSINESS_ADMIN" }],
    ["email", { email: "someone.else@example.test" }],
    ["userId", { userId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["customerId", { customerId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }],
    ["isActive", { isActive: false }],
    ["passwordHash", { passwordHash: "$argon2id$not-mine" }],
    ["emailVerifiedAt", { emailVerifiedAt: "2020-01-01T00:00:00.000Z" }],
    ["an unknown key", { nickname: "Al" }],
  ])(
    "rejects %s with 422, even beside valid fields, and stores nothing (FR-014)",
    async (_name, extra) => {
      const w = await world();
      const before = await snapshotOf(w.alex.user.id, w.alex.profile.id);

      const response = await w.client
        .patch(ME, { cookie: w.alexCookie })
        .send({ name: "Alexandra Morgan", phone: "(212) 555-0199", ...extra });

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {}).join(" ")).toContain(Object.keys(extra)[0]);
      // The valid name and phone were not applied either: the whole request is refused.
      expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(before);
    },
  );

  it("keeps the role as CUSTOMER after every attempt to change it", async () => {
    const w = await world();

    await w.client.patch(ME, { cookie: w.alexCookie }).send({ role: "BUSINESS_ADMIN" });
    const me = await w.client.get("/api/v1/auth/me", { cookie: w.alexCookie });
    const adminProbe = await w.client.get("/api/v1/admin/settings", { cookie: w.alexCookie });

    expect(bodyOf<{ data: AuthMeDto }>(me).data.user.role).toBe("CUSTOMER");
    expectApiError(adminProbe, { status: 403, code: ErrorCode.FORBIDDEN });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.alex.user.id } })).role).toBe(
      "CUSTOMER",
    );
  });

  it.each([
    ["an empty body", {}, "_"],
    ["a name of one character", { name: "A" }, "name"],
    ["a name that is only spaces", { name: "   " }, "name"],
    ["a name of 101 characters", { name: "A".repeat(101) }, "name"],
    ["a name with a line break", { name: "Alex\nMorgan" }, "name"],
    ["a phone number with letters", { phone: "212-CALL-NOW" }, "phone"],
    ["a phone number that is too short", { phone: "555-01" }, "phone"],
    ["a phone number with markup", { phone: "<b>5550142</b>" }, "phone"],
    ["a name that is not text", { name: 42 }, "name"],
  ])(
    "answers 422 with a message beside the field for %s, and changes nothing",
    async (_case, body, field) => {
      const w = await world();
      const before = await snapshotOf(w.alex.user.id, w.alex.profile.id);

      const response = await w.client.patch(ME, { cookie: w.alexCookie }).send(body);

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      const fieldErrors: FieldErrors = error.fieldErrors ?? {};
      expect(Object.keys(fieldErrors).length).toBeGreaterThan(0);
      if (field !== "_") {
        expect(fieldErrors[field]).toBeDefined();
      }
      expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(before);
    },
  );

  it("changes nobody else's profile", async () => {
    const w = await world();
    const priyaBefore = await snapshotOf(w.priya.user.id, w.priya.profile.id);

    await w.client
      .patch(ME, { cookie: w.alexCookie })
      .send({ name: "Alexandra Morgan", phone: "(212) 555-0142" });

    expect(await snapshotOf(w.priya.user.id, w.priya.profile.id)).toBe(priyaBefore);
  });
});

describe("POST /customers/me/addresses (G.2)", () => {
  it("creates an address, which becomes the default because it is the first", async () => {
    const w = await world();

    const response = await postAddress(w, {
      ...NEW_ADDRESS,
      accessNotes: "Gate code 4471. Pets inside.",
    });

    expect(response.status).toBe(201);
    const { data } = bodyOf<{ data: ServiceAddressDto }>(response);
    expect(data).toMatchObject({
      label: "Rental unit",
      line1: "73 Millrace Court",
      line2: null,
      city: "Harbor City",
      region: "NY",
      postalCode: "10998",
      accessNotes: "Gate code 4471. Pets inside.",
      isDefault: true,
    });
    const rows = await addressesOf(w.alex.profile.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: data.id, customerId: w.alex.profile.id, isDefault: true });
  });

  it("does not make later addresses the default", async () => {
    const w = await world();
    const first = bodyOf<{ data: ServiceAddressDto }>(await postAddress(w)).data;

    const second = bodyOf<{ data: ServiceAddressDto }>(
      await postAddress(w, { ...NEW_ADDRESS, label: "Office", line1: "9 Dock Street" }),
    ).data;

    expect(second.isDefault).toBe(false);
    expect(await defaultsOf(w.alex.profile.id)).toEqual([first.id]);
  });

  it("keeps the optional fields empty when they are not sent", async () => {
    const w = await world();

    const { data } = bodyOf<{ data: ServiceAddressDto }>(
      await postAddress(w, {
        label: "Home",
        line1: "1 Elm Road",
        city: "Harbor City",
        postalCode: "10001",
      }),
    );

    expect(data).toMatchObject({ line2: null, region: null, accessNotes: null });
  });

  it("owns the new address through the session, whatever the body says", async () => {
    const w = await world();

    const response = await postAddress(w, { ...NEW_ADDRESS, customerId: w.priya.profile.id });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await prisma.serviceAddress.count()).toBe(0);
  });

  it.each([
    ["isDefault", { isDefault: true }],
    ["id", { id: MISSING_ID }],
    ["an unknown key", { country: "US" }],
  ])("rejects %s with 422 and creates nothing", async (_name, extra) => {
    const w = await world();

    const response = await postAddress(w, { ...NEW_ADDRESS, ...extra });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await prisma.serviceAddress.count()).toBe(0);
  });

  it("reports each missing or invalid field beside it", async () => {
    const w = await world();

    const empty = await postAddress(w, {});
    const invalid = await postAddress(w, {
      ...NEW_ADDRESS,
      label: "H",
      postalCode: "10<99>",
      accessNotes: "n".repeat(501),
    });

    expect(
      Object.keys(
        expectApiError(empty, { status: 422, code: ErrorCode.VALIDATION_ERROR }).fieldErrors ?? {},
      ).sort(),
    ).toEqual(["city", "label", "line1", "postalCode"]);
    expect(
      Object.keys(
        expectApiError(invalid, { status: 422, code: ErrorCode.VALIDATION_ERROR }).fieldErrors ??
          {},
      ).sort(),
    ).toEqual(["accessNotes", "label", "postalCode"]);
    expect(await prisma.serviceAddress.count()).toBe(0);
  });

  it("allows ten addresses and refuses the eleventh with 409", async () => {
    const w = await world();
    for (let n = 1; n <= 10; n += 1) {
      const response = await postAddress(w, { ...NEW_ADDRESS, label: `Place ${n}` });
      expect(response.status).toBe(201);
    }

    const eleventh = await postAddress(w, { ...NEW_ADDRESS, label: "Place 11" });

    const error = expectApiError(eleventh, { status: 409, code: ErrorCode.ADDRESS_LIMIT_REACHED });
    expect(error.message).toContain("10");
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(
      10,
    );
    expect(await defaultsOf(w.alex.profile.id)).toHaveLength(1);
  });

  it("counts only the customer's own addresses towards the limit", async () => {
    const w = await world();
    for (let n = 1; n <= 10; n += 1) {
      await insertAddress(prisma, w.priya.profile.id, { isDefault: n === 1 });
    }

    const response = await postAddress(w);

    expect(response.status).toBe(201);
  });

  it("cannot be pushed past ten by simultaneous requests, and still ends with one default", async () => {
    const w = await world();

    const responses = await Promise.all(
      Array.from({ length: 14 }, (_, n) =>
        postAddress(w, { ...NEW_ADDRESS, label: `Place ${n + 1}` }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(10);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(
      10,
    );
    expect(await defaultsOf(w.alex.profile.id)).toHaveLength(1);
  });
});

describe("GET /customers/me/addresses", () => {
  it("lists only the caller's addresses, default first", async () => {
    const w = await world();
    const older = await alexAddress(w, {
      label: "Older",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const home = await alexAddress(w, {
      label: "Home",
      isDefault: true,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await insertAddress(prisma, w.priya.profile.id, { label: "Priya's" });

    const response = await w.client.get(ADDRESSES, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(
      bodyOf<{ data: ServiceAddressDto[] }>(response).data.map((address) => address.id),
    ).toEqual([home.id, older.id]);
  });
});

describe("PATCH /customers/me/addresses/:id", () => {
  it("updates the fields that were sent and leaves the others and the default alone", async () => {
    const w = await world();
    const home = await alexAddress(w, { label: "Home", line2: "Apt 2B", isDefault: true });
    const other = await alexAddress(w, { label: "Office" });

    const response = await w.client
      .patch(addressPath(home.id), { cookie: w.alexCookie })
      .send({ label: " Main home ", city: "Port Alder", accessNotes: "Side gate is latched." });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: ServiceAddressDto }>(response).data).toMatchObject({
      id: home.id,
      label: "Main home",
      line1: home.line1,
      line2: "Apt 2B",
      city: "Port Alder",
      accessNotes: "Side gate is latched.",
      isDefault: true,
    });
    expect(await defaultsOf(w.alex.profile.id)).toEqual([home.id]);
    expect(await prisma.serviceAddress.findUniqueOrThrow({ where: { id: other.id } })).toEqual(
      other,
    );
  });

  it("clears an optional field with null or blank text", async () => {
    const w = await world();
    const home = await alexAddress(w, {
      line2: "Apt 2B",
      region: "NY",
      accessNotes: "Buzz twice.",
    });

    const response = await w.client
      .patch(addressPath(home.id), { cookie: w.alexCookie })
      .send({ line2: null, region: "  ", accessNotes: null });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: ServiceAddressDto }>(response).data).toMatchObject({
      line2: null,
      region: null,
      accessNotes: null,
    });
  });

  // Each body is sent as it is. Where a valid `label` is included, the test also proves that a
  // request with one bad part is refused as a whole and the valid part is not applied.
  it.each([
    ["isDefault", { label: "Changed", isDefault: true }],
    ["customerId", { label: "Changed", customerId: MISSING_ID }],
    ["id", { label: "Changed", id: MISSING_ID }],
    ["an unknown key", { label: "Changed", country: "US" }],
    ["an empty body", {}],
    ["a blank required field", { label: "Changed", line1: "   " }],
    ["a null required field", { label: "Changed", city: null }],
    ["a label of one character", { label: "H" }],
  ])("rejects %s with 422 and changes nothing", async (_name, body) => {
    const w = await world();
    const home = await alexAddress(w, { isDefault: true });
    await alexAddress(w);
    const before = await snapshotOf(w.alex.user.id, w.alex.profile.id);

    const response = await w.client
      .patch(addressPath(home.id), { cookie: w.alexCookie })
      .send(body);

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(before);
  });

  it("does not rewrite a request that was made with the address (D-36)", async () => {
    const w = await world();
    const home = await alexAddress(w, {
      line1: "214 Larkspur Lane",
      accessNotes: "Buzz 2B.",
      isDefault: true,
    });
    const service = await createService(prisma);
    const request = await createServiceRequest(prisma, {
      customerId: w.alex.profile.id,
      serviceId: service.id,
      serviceAddressId: home.id,
      addressLine1: "214 Larkspur Lane",
      accessNotesSnapshot: "Buzz 2B.",
    });

    await w.client
      .patch(addressPath(home.id), { cookie: w.alexCookie })
      .send({ line1: "1 Somewhere Else", accessNotes: "New code 9999." });

    const unchanged = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(unchanged).toMatchObject({
      serviceAddressId: home.id,
      addressLine1: "214 Larkspur Lane",
      accessNotesSnapshot: "Buzz 2B.",
    });
  });
});

describe("POST /customers/me/addresses/:id/default", () => {
  it("makes the address the default and leaves exactly one default", async () => {
    const w = await world();
    const home = await alexAddress(w, { isDefault: true });
    const office = await alexAddress(w);
    const cabin = await alexAddress(w);

    const response = await w.client.post(defaultPath(cabin.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: ServiceAddressDto }>(response).data).toMatchObject({
      id: cabin.id,
      isDefault: true,
    });
    expect(await defaultsOf(w.alex.profile.id)).toEqual([cabin.id]);
    expect(home.id).not.toBe(cabin.id);
    expect(office.id).not.toBe(cabin.id);
  });

  it("is harmless to choose the default again", async () => {
    const w = await world();
    const home = await alexAddress(w, { isDefault: true });
    const before = await prisma.serviceAddress.findUniqueOrThrow({ where: { id: home.id } });

    const response = await w.client.post(defaultPath(home.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(await prisma.serviceAddress.findUniqueOrThrow({ where: { id: home.id } })).toEqual(
      before,
    );
  });

  it("ends with exactly one default when many are chosen at once", async () => {
    const w = await world();
    const rows = [
      await alexAddress(w, { isDefault: true }),
      await alexAddress(w),
      await alexAddress(w),
      await alexAddress(w),
    ];

    const responses = await Promise.all(
      [...rows, ...rows].map((row) => w.client.post(defaultPath(row.id), { cookie: w.alexCookie })),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await defaultsOf(w.alex.profile.id)).toHaveLength(1);
  });

  it("does not change another customer's default", async () => {
    const w = await world();
    const priyaHome = await insertAddress(prisma, w.priya.profile.id, { isDefault: true });
    await alexAddress(w, { isDefault: true });
    const office = await alexAddress(w);

    await w.client.post(defaultPath(office.id), { cookie: w.alexCookie });

    expect(await defaultsOf(w.priya.profile.id)).toEqual([priyaHome.id]);
  });
});

describe("DELETE /customers/me/addresses/:id", () => {
  it("deletes an address that is not the default and keeps the default", async () => {
    const w = await world();
    const home = await alexAddress(w, { isDefault: true });
    const office = await alexAddress(w);

    const response = await w.client.delete(addressPath(office.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: DeletedAddressDto }>(response).data).toEqual({ id: office.id });
    expect((await addressesOf(w.alex.profile.id)).map((row) => row.id)).toEqual([home.id]);
    expect(await defaultsOf(w.alex.profile.id)).toEqual([home.id]);
  });

  it("promotes the most recently updated remaining address when the default is deleted", async () => {
    const w = await world();
    const home = await alexAddress(w, {
      label: "Home",
      isDefault: true,
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    });
    await alexAddress(w, { label: "Oldest", updatedAt: new Date("2026-01-01T00:00:00Z") });
    const newest = await alexAddress(w, {
      label: "Newest",
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    });
    await alexAddress(w, { label: "Middle", updatedAt: new Date("2026-04-01T00:00:00Z") });

    const response = await w.client.delete(addressPath(home.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(await defaultsOf(w.alex.profile.id)).toEqual([newest.id]);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(3);
  });

  it("leaves no address and no default when the last address is deleted, and the next one becomes the default", async () => {
    const w = await world();
    const only = await alexAddress(w, { isDefault: true });

    await w.client.delete(addressPath(only.id), { cookie: w.alexCookie });
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(0);

    const created = await postAddress(w);
    expect(bodyOf<{ data: ServiceAddressDto }>(created).data.isDefault).toBe(true);
  });

  it("is allowed while requests refer to the address: they keep their own copy (D-36)", async () => {
    const w = await world();
    const home = await alexAddress(w, {
      line1: "214 Larkspur Lane",
      accessNotes: "Buzz 2B.",
      isDefault: true,
    });
    const service = await createService(prisma);
    const request = await createServiceRequest(prisma, {
      customerId: w.alex.profile.id,
      serviceId: service.id,
      serviceAddressId: home.id,
      addressLine1: "214 Larkspur Lane",
      accessNotesSnapshot: "Buzz 2B.",
    });

    const response = await w.client.delete(addressPath(home.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const kept = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(kept).toMatchObject({
      serviceAddressId: null,
      addressLine1: "214 Larkspur Lane",
      accessNotesSnapshot: "Buzz 2B.",
    });
  });

  it("answers 404 once the address is gone", async () => {
    const w = await world();
    const home = await alexAddress(w, { isDefault: true });
    await w.client.delete(addressPath(home.id), { cookie: w.alexCookie });

    const again = await w.client.delete(addressPath(home.id), { cookie: w.alexCookie });

    expectApiError(again, { status: 404, code: ErrorCode.NOT_FOUND });
  });

  it("always leaves exactly one default when several are deleted at once", async () => {
    const w = await world();
    const rows = [
      await alexAddress(w, { isDefault: true }),
      await alexAddress(w),
      await alexAddress(w),
      await alexAddress(w),
      await alexAddress(w),
    ];

    const responses = await Promise.all(
      rows.slice(0, 3).map((row) => w.client.delete(addressPath(row.id), { cookie: w.alexCookie })),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await addressesOf(w.alex.profile.id)).toHaveLength(2);
    expect(await defaultsOf(w.alex.profile.id)).toHaveLength(1);
  });
});

describe("ownership: customer B cannot reach customer A's address (G.3)", () => {
  async function aliceAndBob() {
    const w = await world();
    const alexHome = await alexAddress(w, {
      label: "Home",
      accessNotes: "Gate code 4471.",
      isDefault: true,
    });
    const alexOffice = await alexAddress(w, { label: "Office" });
    const priyaHome = await insertAddress(prisma, w.priya.profile.id, {
      label: "Priya's home",
      isDefault: true,
    });
    return { w, alexHome, alexOffice, priyaHome };
  }

  it("answers 404 to updating, deleting or defaulting it, exactly as for an id that does not exist", async () => {
    const { w, alexOffice, priyaHome } = await aliceAndBob();
    const alexBefore = await snapshotOf(w.alex.user.id, w.alex.profile.id);
    const priyaBefore = await snapshotOf(w.priya.user.id, w.priya.profile.id);

    const attempts = await Promise.all([
      w.client
        .patch(addressPath(alexOffice.id), { cookie: w.priyaCookie })
        .send({ label: "Stolen" }),
      w.client.delete(addressPath(alexOffice.id), { cookie: w.priyaCookie }),
      w.client.post(defaultPath(alexOffice.id), { cookie: w.priyaCookie }),
    ]);
    const missing = await Promise.all([
      w.client.patch(addressPath(MISSING_ID), { cookie: w.priyaCookie }).send({ label: "Stolen" }),
      w.client.delete(addressPath(MISSING_ID), { cookie: w.priyaCookie }),
      w.client.post(defaultPath(MISSING_ID), { cookie: w.priyaCookie }),
    ]);

    attempts.forEach((response, index) => {
      const error = expectApiError(response, { status: 404, code: ErrorCode.NOT_FOUND });
      const expected = expectApiError(missing[index]!, { status: 404, code: ErrorCode.NOT_FOUND });
      expect(error.message).toBe(expected.message);
    });
    expect(await snapshotOf(w.alex.user.id, w.alex.profile.id)).toBe(alexBefore);
    expect(await snapshotOf(w.priya.user.id, w.priya.profile.id)).toBe(priyaBefore);
    expect(await defaultsOf(w.priya.profile.id)).toEqual([priyaHome.id]);
  });

  it("never lists it, whatever the caller asks for", async () => {
    const { w, alexHome } = await aliceAndBob();

    const profile = await w.client.get(`${ME}?customerId=${w.alex.profile.id}`, {
      cookie: w.priyaCookie,
    });
    const list = await w.client.get(`${ADDRESSES}?customerId=${w.alex.profile.id}`, {
      cookie: w.priyaCookie,
    });

    for (const response of [profile, list]) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(alexHome.id);
      expect(JSON.stringify(response.body)).not.toContain("Gate code 4471.");
      expect(JSON.stringify(response.body)).not.toContain("Alex");
    }
  });

  it("does not count A's addresses towards B's limit, nor let B add to A", async () => {
    const { w } = await aliceAndBob();

    const created = await w.client.post(ADDRESSES, { cookie: w.priyaCookie }).send(NEW_ADDRESS);

    expect(created.status).toBe(201);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(2);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.priya.profile.id } })).toBe(
      2,
    );
  });

  it("answers 422 to an id that is not a UUID", async () => {
    const { w } = await aliceAndBob();

    for (const response of [
      await w.client
        .patch(addressPath("default"), { cookie: w.alexCookie })
        .send({ label: "Home" }),
      await w.client.delete(addressPath("1;DROP TABLE service_addresses"), {
        cookie: w.alexCookie,
      }),
      await w.client.post(defaultPath("not-an-id"), { cookie: w.alexCookie }),
    ]) {
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    }
  });
});

describe("privacy", () => {
  it("never writes access notes, addresses or the phone number to the logs", async () => {
    const w = await world({ logLevel: "debug" });
    const SECRET_NOTE = "Gate code 7777-SECRET, dog named Biscuit";
    const SECRET_STREET = "1234 Quietwater Boulevard";

    const created = await w.client
      .post(ADDRESSES, { cookie: w.alexCookie })
      .send({ ...NEW_ADDRESS, line1: SECRET_STREET, accessNotes: SECRET_NOTE });
    const id = bodyOf<{ data: ServiceAddressDto }>(created).data.id;
    await w.client
      .patch(addressPath(id), { cookie: w.alexCookie })
      .send({ accessNotes: `${SECRET_NOTE} (updated)` });
    await w.client.patch(ME, { cookie: w.alexCookie }).send({ phone: "(212) 555-0177" });
    // A refused request must not echo what was typed either.
    const refused = await w.client
      .post(ADDRESSES, { cookie: w.alexCookie })
      .send({ ...NEW_ADDRESS, label: "X", accessNotes: SECRET_NOTE });
    await w.client.get(ME, { cookie: w.alexCookie });
    await w.client.delete(addressPath(id), { cookie: w.alexCookie });

    const logs = w.logs.text();
    expect(logs).not.toContain("7777-SECRET");
    expect(logs).not.toContain("Biscuit");
    expect(logs).not.toContain(SECRET_STREET);
    expect(logs).not.toContain("555-0177");
    expect(JSON.stringify(refused.body)).not.toContain("7777-SECRET");
  });
});

describe("the database backstop", () => {
  it("refuses a second default address for one customer, whatever the application does", async () => {
    const w = await world();
    await alexAddress(w, { isDefault: true });

    await expectDbRejection(() => alexAddress(w, { isDefault: true }), {
      sqlState: SqlState.UNIQUE_VIOLATION,
      constraint: "service_addresses_one_default_per_customer_key",
    });
  });
});
