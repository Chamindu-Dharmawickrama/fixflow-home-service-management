import { type AdminSettingsDto, ErrorCode, type PublicSettingsDto } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEMO_SETTINGS } from "../../db/seed-data.js";
import { BUSINESS_SETTINGS_ID } from "../../lib/db.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createBusinessSettings } from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const PUBLIC = "/api/v1/settings/public";
const ADMIN = "/api/v1/admin/settings";
const CUSTOMER_EMAIL = "alex.morgan@example.test";

const PUBLIC_KEYS = [
  "address",
  "businessName",
  "contactEmail",
  "currencyCode",
  "logoKey",
  "logoUrl",
  "phone",
  "serviceAreaDescription",
  "tagline",
  "timeZone",
];

const ADMIN_KEYS = [
  "businessName",
  "tagline",
  "logoKey",
  "logoUrl",
  "contactEmail",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "serviceAreaDescription",
  "currencyCode",
  "timeZone",
  "defaultTaxRate",
  "quotationValidityDays",
  "invoiceDueDays",
  "defaultQuotationTerms",
  "paymentInstructions",
  "invoiceFooter",
  "updatedAt",
  "identityLocked",
].sort();

async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma);
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

const patch = (w: World, body: unknown, cookie: string = w.adminCookie) =>
  api(w.app)
    .patch(ADMIN, { cookie })
    .send(body as object);

async function storedSettings() {
  return prisma.businessSettings.findUniqueOrThrow({ where: { id: BUSINESS_SETTINGS_ID } });
}

describe("GET /settings/public", () => {
  it("needs no sign-in and returns the public profile of the business", async () => {
    const { app } = await world();

    const response = await api(app).get(PUBLIC);

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: PublicSettingsDto }>(response);
    expect(data).toEqual({
      businessName: "CoolBreeze Home Services",
      tagline: "Home comfort and repairs, done properly the first time.",
      logoKey: null,
      logoUrl: null,
      contactEmail: "hello@coolbreeze.test",
      phone: "(212) 555-0142",
      address: {
        line1: "48 Harbor Point Road",
        line2: "Unit 3",
        city: "Harbor City",
        region: "NY",
        postalCode: "10999",
      },
      serviceAreaDescription: DEMO_SETTINGS.serviceAreaDescription,
      currencyCode: "USD",
      timeZone: "America/New_York",
    });
  });

  it("has exactly the public keys and nothing internal, whoever asks", async () => {
    const w = await world();
    await patch(w, { logoKey: "breeze" });

    for (const cookie of [undefined, w.customerCookie, w.adminCookie]) {
      const response = await api(w.app).get(PUBLIC, { cookie });
      const { data } = bodyOf<{ data: PublicSettingsDto }>(response);
      expect(Object.keys(data).sort()).toEqual(PUBLIC_KEYS);
      const json = JSON.stringify(response.body);
      for (const hidden of [
        "updatedByUserId",
        w.admin.id,
        BUSINESS_SETTINGS_ID,
        "defaultTaxRate",
        "quotationValidityDays",
        "invoiceDueDays",
        "defaultQuotationTerms",
        "paymentInstructions",
        "invoiceFooter",
      ]) {
        expect(json, hidden).not.toContain(hidden);
      }
    }
  });

  it("is cacheable for a minute, unlike every other API response", async () => {
    const { app } = await world();

    const response = await api(app).get(PUBLIC);

    expect(response.headers["cache-control"]).toBe("public, max-age=60");
    // …but a private endpoint next to it is still never cached.
    const other = await api(app).get("/api/v1/auth/me");
    expect(other.headers["cache-control"]).toBe("no-store");
  });

  it("answers 503 when the business has not been set up", async () => {
    const { app } = buildTestApp({ prisma });

    expectApiError(await api(app).get(PUBLIC), {
      status: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
    });
  });
});

describe("GET /admin/settings", () => {
  it("is 401 without a session and 403 for a customer", async () => {
    const w = await world();

    expectApiError(await api(w.app).get(ADMIN), { status: 401, code: ErrorCode.UNAUTHENTICATED });
    expectApiError(await api(w.app).get(ADMIN, { cookie: w.customerCookie }), {
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

  it("returns every editable field to the admin, with decimals as strings", async () => {
    const w = await world();

    const response = await api(w.app).get(ADMIN, { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { data } = bodyOf<{ data: AdminSettingsDto }>(response);
    expect(Object.keys(data).sort()).toEqual(ADMIN_KEYS);
    expect(data).toMatchObject({
      defaultTaxRate: "8.00",
      quotationValidityDays: 14,
      invoiceDueDays: 14,
      timeZone: "America/New_York",
    });
    expect(JSON.stringify(response.body)).not.toContain("updatedByUserId");
  });
});

describe("PATCH /admin/settings: access", () => {
  it("is 401 without a session and 403 for a customer, and changes nothing", async () => {
    const w = await world();
    const before = await storedSettings();

    expectApiError(await api(w.app).patch(ADMIN).send({ phone: "(212) 555-0199" }), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await patch(w, { phone: "(212) 555-0199" }, w.customerCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });

    expect(await storedSettings()).toEqual(before);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("refuses a request from another origin (CSRF)", async () => {
    const w = await world();

    const response = await api(w.app)
      .patch(ADMIN, { cookie: w.adminCookie, origin: "https://evil.example.com" })
      .send({ phone: "(212) 555-0199" });

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect((await storedSettings()).phone).toBe("(212) 555-0142");
  });

  it("is rate limited per admin (429)", async () => {
    const w = await world({ rateLimits: { adminWrite: { limit: 2, windowSeconds: 60 } } });

    expect((await patch(w, { phone: "(212) 555-0150" })).status).toBe(200);
    expect((await patch(w, { phone: "(212) 555-0151" })).status).toBe(200);
    const limited = await patch(w, { phone: "(212) 555-0152" });

    expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await storedSettings()).phone).toBe("(212) 555-0151");
  });
});

describe("PATCH /admin/settings: a valid update", () => {
  it("persists, returns the new settings, and shows on the public endpoint", async () => {
    const w = await world();

    const response = await patch(w, {
      phone: "(212) 555-0199",
      tagline: "Cool air, fair prices.",
      defaultTaxRate: "9.25",
      quotationValidityDays: 30,
      currencyCode: "cad",
      timeZone: "America/Toronto",
    });

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: AdminSettingsDto }>(response);
    expect(data).toMatchObject({
      phone: "(212) 555-0199",
      tagline: "Cool air, fair prices.",
      defaultTaxRate: "9.25",
      quotationValidityDays: 30,
      currencyCode: "CAD",
      timeZone: "America/Toronto",
      businessName: "CoolBreeze Home Services",
    });

    const publicData = bodyOf<{ data: PublicSettingsDto }>(await api(w.app).get(PUBLIC)).data;
    expect(publicData).toMatchObject({
      phone: "(212) 555-0199",
      tagline: "Cool air, fair prices.",
      currencyCode: "CAD",
      timeZone: "America/Toronto",
    });
    const stored = await storedSettings();
    expect(stored.defaultTaxRate.toFixed(2)).toBe("9.25");
    expect(stored.quotationValidityDays).toBe(30);
    expect(stored.updatedByUserId).toBe(w.admin.id);
  });

  it("normalizes text: trims, lower-cases the email, keeps a two-decimal tax rate", async () => {
    const w = await world();

    const response = await patch(w, {
      businessName: "  CoolBreeze Home Services Ltd  ",
      contactEmail: " Office@CoolBreeze.TEST ",
      defaultTaxRate: "7.5",
    });

    expect(bodyOf<{ data: AdminSettingsDto }>(response).data).toMatchObject({
      businessName: "CoolBreeze Home Services Ltd",
      contactEmail: "office@coolbreeze.test",
      defaultTaxRate: "7.50",
    });
  });

  it("clears optional fields with null or blank text, and keeps the rest", async () => {
    const w = await world();

    const response = await patch(w, {
      tagline: null,
      addressLine2: "  ",
      serviceAreaDescription: "",
    });

    expect(response.status).toBe(200);
    const stored = await storedSettings();
    expect(stored.tagline).toBeNull();
    expect(stored.addressLine2).toBeNull();
    expect(stored.serviceAreaDescription).toBeNull();
    expect(stored.businessName).toBe("CoolBreeze Home Services");
  });

  it("accepts the boundary values", async () => {
    const w = await world();

    const response = await patch(w, {
      defaultTaxRate: "100",
      quotationValidityDays: 90,
      invoiceDueDays: 0,
    });

    expect(bodyOf<{ data: AdminSettingsDto }>(response).data).toMatchObject({
      defaultTaxRate: "100.00",
      quotationValidityDays: 90,
      invoiceDueDays: 0,
    });
    expect(
      (await patch(w, { defaultTaxRate: "0", quotationValidityDays: 1, invoiceDueDays: 90 }))
        .status,
    ).toBe(200);
  });

  it("selects a bundled logo, then swaps it for a web address, then removes it", async () => {
    const w = await world();

    await patch(w, { logoKey: "snowflake" });
    expect(await storedSettings()).toMatchObject({ logoKey: "snowflake", logoUrl: null });

    await patch(w, { logoKey: null, logoUrl: "https://cdn.example.test/logo.svg" });
    expect(await storedSettings()).toMatchObject({
      logoKey: null,
      logoUrl: "https://cdn.example.test/logo.svg",
    });

    await patch(w, { logoUrl: null });
    expect(await storedSettings()).toMatchObject({ logoKey: null, logoUrl: null });
  });
});

describe("PATCH /admin/settings: validation (422 with fieldErrors)", () => {
  it.each([
    ["an invalid time zone", { timeZone: "Mars/Olympus" }, "timeZone"],
    ["a time zone alias that is not canonical", { timeZone: "EST" }, "timeZone"],
    ["a currency that is not supported", { currencyCode: "XXX" }, "currencyCode"],
    ["a zero-decimal currency", { currencyCode: "JPY" }, "currencyCode"],
    ["a tax rate above 100", { defaultTaxRate: "100.01" }, "defaultTaxRate"],
    ["a negative tax rate", { defaultTaxRate: "-1" }, "defaultTaxRate"],
    ["a tax rate with three decimals", { defaultTaxRate: "8.255" }, "defaultTaxRate"],
    ["a tax rate sent as a number", { defaultTaxRate: 8.25 }, "defaultTaxRate"],
    ["a plain-http logo address", { logoUrl: "http://example.test/logo.png" }, "logoUrl"],
    ["a script logo address", { logoUrl: "javascript:alert(1)" }, "logoUrl"],
    ["a logo key that is not bundled", { logoKey: "my-own-logo" }, "logoKey"],
    ["a logo key that is a path", { logoKey: "../logo.png" }, "logoKey"],
    ["quotation validity of 0 days", { quotationValidityDays: 0 }, "quotationValidityDays"],
    ["quotation validity of 91 days", { quotationValidityDays: 91 }, "quotationValidityDays"],
    ["a fractional quotation validity", { quotationValidityDays: 14.5 }, "quotationValidityDays"],
    ["a negative invoice term", { invoiceDueDays: -1 }, "invoiceDueDays"],
    ["an invoice term of 91 days", { invoiceDueDays: 91 }, "invoiceDueDays"],
    ["an invalid email address", { contactEmail: "not-an-email" }, "contactEmail"],
    ["an invalid phone number", { phone: "call us" }, "phone"],
    ["a business name that is too long", { businessName: "x".repeat(101) }, "businessName"],
    ["a blank business name", { businessName: "   " }, "businessName"],
    ["a tagline that is too long", { tagline: "x".repeat(161) }, "tagline"],
    [
      "terms that are too long",
      { defaultQuotationTerms: "x".repeat(2001) },
      "defaultQuotationTerms",
    ],
    ["a postal code with symbols", { postalCode: "<109>" }, "postalCode"],
    ["a key that does not exist", { updatedByUserId: "x" }, "updatedByUserId"],
  ] as const)("rejects %s", async (_name, body, field) => {
    const w = await world();
    const before = await storedSettings();

    const response = await patch(w, body);

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(typeof error.fieldErrors?.[field]).toBe("string");
    // Nothing was written, and nothing was recorded.
    expect(await storedSettings()).toEqual(before);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("reports every invalid field in one response", async () => {
    const w = await world();

    const response = await patch(w, {
      timeZone: "Mars/Olympus",
      currencyCode: "JPY",
      defaultTaxRate: "101",
      logoUrl: "http://example.test/a.png",
    });

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      "currencyCode",
      "defaultTaxRate",
      "logoUrl",
      "timeZone",
    ]);
  });

  it("rejects an empty body and one that is not JSON", async () => {
    const w = await world();

    expectApiError(await patch(w, {}), { status: 422, code: ErrorCode.VALIDATION_ERROR });
    const notJson = await api(w.app)
      .patch(ADMIN, { cookie: w.adminCookie })
      .set("Content-Type", "text/plain")
      .send("phone=1");
    expect(notJson.status).toBe(400);
  });

  it("refuses a bundled logo and a web address together, whether in one request or across two", async () => {
    const w = await world();

    const both = await patch(w, {
      logoKey: "breeze",
      logoUrl: "https://cdn.example.test/logo.svg",
    });
    expect(
      expectApiError(both, { status: 422, code: ErrorCode.VALIDATION_ERROR }).fieldErrors?.logoUrl,
    ).toBe("Choose either a bundled logo or a web address, not both.");
    expect(await storedSettings()).toMatchObject({ logoKey: null, logoUrl: null });

    await patch(w, { logoKey: "breeze" });
    const second = await patch(w, { logoUrl: "https://cdn.example.test/logo.svg" });
    expectApiError(second, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await storedSettings()).toMatchObject({ logoKey: "breeze", logoUrl: null });
  });
});

describe("PATCH /admin/settings: activity (D-29)", () => {
  it("records one SETTINGS event naming the changed fields, never their values", async () => {
    const w = await world();

    await patch(w, {
      phone: "(212) 555-0199",
      contactEmail: "private-address@coolbreeze.test",
      defaultTaxRate: "9.00",
    });

    const events = await prisma.activityEvent.findMany();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "SETTINGS",
      entityId: BUSINESS_SETTINGS_ID,
      action: "settings.updated",
      publicSummary: null,
      customerId: null,
      requestId: null,
      metadata: { changedFields: ["contactEmail", "phone", "defaultTaxRate"] },
    });
    expect(event?.summary).toContain("Test Admin updated the business settings");
    // No value anywhere in the history.
    const stored = JSON.stringify(events);
    for (const value of ["(212) 555-0199", "private-address@coolbreeze.test", "9.00"]) {
      expect(stored, value).not.toContain(value);
    }
  });

  it("records nothing when the values sent are the ones already stored", async () => {
    const w = await world();
    const before = await storedSettings();

    const response = await patch(w, {
      phone: "(212) 555-0142",
      defaultTaxRate: "8",
      businessName: "CoolBreeze Home Services",
    });

    expect(response.status).toBe(200);
    expect(await prisma.activityEvent.count()).toBe(0);
    // Not even the modification time moved.
    expect(await storedSettings()).toEqual(before);
  });

  it("records an event per change, with only the fields that changed that time", async () => {
    const w = await world();

    await patch(w, { phone: "(212) 555-0199" });
    await patch(w, { phone: "(212) 555-0199", tagline: "New tagline for the van." });

    const events = await prisma.activityEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.metadata)).toEqual([
      { changedFields: ["phone"] },
      { changedFields: ["tagline"] },
    ]);
  });

  it("never lets a customer or the public see settings history", async () => {
    const w = await world();
    await patch(w, { phone: "(212) 555-0199" });

    const event = await prisma.activityEvent.findFirstOrThrow();
    expect(event.publicSummary).toBeNull();
    expect(event.customerId).toBeNull();
  });
});
