import { type AdminSettingsDto, ErrorCode, IDENTITY_SETTINGS_FIELDS } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { BUSINESS_SETTINGS_ID } from "../../lib/db.js";
import {
  createLocalAdmin,
  createLocalCustomer,
  signInAs,
  TEST_PASSWORD,
} from "../../test/auth-helpers.js";
import { buildTestApp, type TestAppOverrides } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createBusinessSettings } from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

/**
 * The safeguards of the public demo (T24, D-09, Q-11): the shared demo accounts' write limit, the
 * stricter limit on new sign-ups, `PUBLIC_SIGNUP_ENABLED` both ways, and the locked business identity.
 */

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ADMIN = "/api/v1/admin/settings";
const PROFILE = "/api/v1/customers/me";
const REGISTER = "/api/v1/auth/register";
const DEMO_ADMIN = "admin@demo.fixflow.test";
const DEMO_CUSTOMER = "alex.morgan@example.test";
const OWNER = "owner@coolbreeze.example";

/** A business, the demo admin and the demo customer, with the app in demo mode unless told otherwise. */
async function demoWorld(options: TestAppOverrides = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({
    prisma,
    ...options,
    env: { DEMO_MODE: "true", ...options.env },
  });
  await createLocalAdmin(prisma, { email: DEMO_ADMIN });
  await createLocalCustomer(prisma, { email: DEMO_CUSTOMER, name: "Alex Morgan" });
  return {
    ...test,
    adminCookie: await signInAs(test.app, DEMO_ADMIN),
    customerCookie: await signInAs(test.app, DEMO_CUSTOMER),
  };
}
type DemoWorld = Awaited<ReturnType<typeof demoWorld>>;

const writeTaxRate = (w: DemoWorld, rate: string) =>
  api(w.app).patch(ADMIN, { cookie: w.adminCookie }).send({ defaultTaxRate: rate });

const writePhone = (w: DemoWorld, phone: string) =>
  api(w.app).patch(PROFILE, { cookie: w.customerCookie }).send({ phone });

const WRITE_LIMIT = { demoWrite: { limit: 3, windowSeconds: 600 } } as const;

describe("the write limit of the shared demo accounts (60 writes in 10 minutes, here 3)", () => {
  it("answers 429 with Retry-After once a demo account has used its writes", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT });

    for (const rate of ["8.10", "8.20", "8.30"]) {
      expect((await writeTaxRate(w, rate)).status).toBe(200);
    }
    const refused = await writeTaxRate(w, "8.40");

    expectApiError(refused, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    // The refused write did not happen.
    const stored = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: BUSINESS_SETTINGS_ID },
    });
    expect(stored.defaultTaxRate.toFixed(2)).toBe("8.30");
  });

  it("limits writes only: reading is never counted", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT });

    for (let index = 0; index < 10; index += 1) {
      expect((await api(w.app).get(ADMIN, { cookie: w.adminCookie })).status).toBe(200);
    }
    expect((await writeTaxRate(w, "8.10")).status).toBe(200);
  });

  it("counts each demo account on its own, so one cannot lock out the other", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT });

    for (const rate of ["8.10", "8.20", "8.30"]) await writeTaxRate(w, rate);
    expect((await writeTaxRate(w, "8.40")).status).toBe(429);

    // The demo customer still has all of theirs.
    expect((await writePhone(w, "(212) 555-0171")).status).toBe(200);
  });

  it("limits the demo customer too", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT });

    for (const phone of ["(212) 555-0171", "(212) 555-0172", "(212) 555-0173"]) {
      expect((await writePhone(w, phone)).status).toBe(200);
    }
    expectApiError(await writePhone(w, "(212) 555-0174"), {
      status: 429,
      code: ErrorCode.RATE_LIMITED,
    });
  });

  it("starts again after the window, by the injected clock", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT });
    for (const rate of ["8.10", "8.20", "8.30"]) await writeTaxRate(w, rate);
    expect((await writeTaxRate(w, "8.40")).status).toBe(429);

    w.clock.advanceSeconds(601);
    // The session outlives ten minutes (it lasts days), so the same cookie still works.
    expect((await writeTaxRate(w, "8.40")).status).toBe(200);
  });

  it("does not apply to a visitor's own account, nor to the owner's admin account", async () => {
    const w = await demoWorld({
      rateLimits: WRITE_LIMIT,
      env: { ADMIN_EMAILS: `${DEMO_ADMIN},${OWNER}` },
    });
    await createLocalCustomer(prisma, { email: "visitor@example.test" });
    const visitor = await signInAs(w.app, "visitor@example.test");
    await createLocalAdmin(prisma, { email: OWNER });
    const owner = await signInAs(w.app, OWNER);

    for (let index = 0; index < 6; index += 1) {
      const phone = `(212) 555-01${String(10 + index)}`;
      expect((await api(w.app).patch(PROFILE, { cookie: visitor }).send({ phone })).status).toBe(
        200,
      );
      const rate = `8.${String(10 + index)}`;
      expect(
        (await api(w.app).patch(ADMIN, { cookie: owner }).send({ defaultTaxRate: rate })).status,
      ).toBe(200);
    }
  });

  it("is off outside demo mode", async () => {
    const w = await demoWorld({ rateLimits: WRITE_LIMIT, env: { DEMO_MODE: "false" } });

    for (const rate of ["8.10", "8.20", "8.30", "8.40", "8.50"]) {
      expect((await writeTaxRate(w, rate)).status).toBe(200);
    }
  });
});

describe("new accounts in the public demo (3 an hour per IP address, here 2)", () => {
  const registration = (index: number) => ({
    name: `Visitor ${String(index)}`,
    email: `visitor${String(index)}@example.test`,
    password: TEST_PASSWORD,
    passwordConfirmation: TEST_PASSWORD,
    acceptTerms: true,
  });
  const LIMIT = { demoRegister: { limit: 2, windowSeconds: 3600 } } as const;

  it("answers 429 once an IP address has registered its share, and creates nothing", async () => {
    const w = await demoWorld({ rateLimits: LIMIT });

    expect((await api(w.app).post(REGISTER).send(registration(1))).status).toBe(201);
    expect((await api(w.app).post(REGISTER).send(registration(2))).status).toBe(201);
    const refused = await api(w.app).post(REGISTER).send(registration(3));

    expectApiError(refused, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(await prisma.user.count({ where: { email: "visitor3@example.test" } })).toBe(0);
  });

  it("is not applied outside demo mode", async () => {
    const w = await demoWorld({ rateLimits: LIMIT, env: { DEMO_MODE: "false" } });

    for (const index of [1, 2, 3, 4]) {
      expect((await api(w.app).post(REGISTER).send(registration(index))).status).toBe(201);
    }
  });

  it("has a default of three an hour", async () => {
    // No override: the real rule, scaled up by the test multiplier but with the same window.
    const w = await demoWorld({ env: { RATE_LIMIT_MULTIPLIER: "1" } });

    for (const index of [1, 2, 3]) {
      expect((await api(w.app).post(REGISTER).send(registration(index))).status).toBe(201);
    }
    expect((await api(w.app).post(REGISTER).send(registration(4))).status).toBe(429);
  });
});

describe("PUBLIC_SIGNUP_ENABLED, both ways (D-09)", () => {
  const visitor = {
    name: "Visitor One",
    email: "visitor1@example.test",
    password: TEST_PASSWORD,
    passwordConfirmation: TEST_PASSWORD,
    acceptTerms: true,
  };

  it("lets a visitor create an account while it is true (the default)", async () => {
    const w = await demoWorld();

    expect((await api(w.app).post(REGISTER).send(visitor)).status).toBe(201);
    expect(await prisma.user.count({ where: { email: visitor.email } })).toBe(1);
  });

  it("answers 403 SIGNUP_DISABLED while it is false, and creates no account", async () => {
    const w = await demoWorld({ env: { PUBLIC_SIGNUP_ENABLED: "false" } });

    expectApiError(await api(w.app).post(REGISTER).send(visitor), {
      status: 403,
      code: ErrorCode.SIGNUP_DISABLED,
    });
    expect(await prisma.user.count({ where: { email: visitor.email } })).toBe(0);
  });

  it("leaves the existing demo accounts able to sign in when sign-up is closed", async () => {
    const w = await demoWorld({ env: { PUBLIC_SIGNUP_ENABLED: "false" } });

    expect((await api(w.app).get("/api/v1/auth/me", { cookie: w.customerCookie })).status).toBe(
      200,
    );
    expect(await signInAs(w.app, DEMO_ADMIN)).toContain("fixflow_session=");
  });
});

describe("the demo accounts' passwords stay locked (T05, verified here)", () => {
  it("answers 403 DEMO_ACCOUNT_LOCKED to a password change by a demo account", async () => {
    const w = await demoWorld();

    for (const cookie of [w.adminCookie, w.customerCookie]) {
      const response = await api(w.app).post("/api/v1/auth/password/change", { cookie }).send({
        currentPassword: TEST_PASSWORD,
        newPassword: "copper lantern drifts west",
        newPasswordConfirmation: "copper lantern drifts west",
      });
      expectApiError(response, { status: 403, code: ErrorCode.DEMO_ACCOUNT_LOCKED });
    }
  });
});

describe("the business identity is locked for the shared demo admin (Q-11)", () => {
  type SettingsBody = { data: AdminSettingsDto };

  const stored = () =>
    prisma.businessSettings.findUniqueOrThrow({ where: { id: BUSINESS_SETTINGS_ID } });

  it("tells the demo admin that it is locked, and tells the owner that it is not", async () => {
    const w = await demoWorld({ env: { ADMIN_EMAILS: `${DEMO_ADMIN},${OWNER}` } });
    await createLocalAdmin(prisma, { email: OWNER });
    const owner = await signInAs(w.app, OWNER);

    const asDemo = await api(w.app).get(ADMIN, { cookie: w.adminCookie });
    const asOwner = await api(w.app).get(ADMIN, { cookie: owner });

    expect(bodyOf<SettingsBody>(asDemo).data.identityLocked).toBe(true);
    expect(bodyOf<SettingsBody>(asOwner).data.identityLocked).toBe(false);
  });

  it("is not locked when demo mode is off", async () => {
    const w = await demoWorld({ env: { DEMO_MODE: "false" } });

    expect(
      bodyOf<SettingsBody>(await api(w.app).get(ADMIN, { cookie: w.adminCookie })).data
        .identityLocked,
    ).toBe(false);
    const response = await api(w.app)
      .patch(ADMIN, { cookie: w.adminCookie })
      .send({ businessName: "Renamed Co" });
    expect(response.status).toBe(200);
    expect((await stored()).businessName).toBe("Renamed Co");
  });

  // A valid new value for each field the public website shows.
  const NEW_VALUE: Record<(typeof IDENTITY_SETTINGS_FIELDS)[number], string | null> = {
    businessName: "Hijacked Plumbing",
    tagline: "Pay us in gift cards.",
    logoKey: "snowflake",
    logoUrl: "https://example.test/logo.png",
    contactEmail: "scam@example.test",
    phone: "(212) 555-0199",
    addressLine1: "1 Nowhere Road",
    addressLine2: "Suite 9",
    city: "Elsewhere",
    region: "CA",
    postalCode: "90001",
    serviceAreaDescription: "Everywhere, probably.",
  };

  it.each([...IDENTITY_SETTINGS_FIELDS])(
    "refuses a change to %s with 403 DEMO_ACCOUNT_LOCKED and leaves the settings untouched",
    async (field) => {
      const w = await demoWorld();
      const before = JSON.stringify(await stored());
      const eventsBefore = await prisma.activityEvent.count();

      const response = await api(w.app)
        .patch(ADMIN, { cookie: w.adminCookie })
        .send({ [field]: NEW_VALUE[field] });

      const error = expectApiError(response, { status: 403, code: ErrorCode.DEMO_ACCOUNT_LOCKED });
      expect(error.message).toContain("locked");
      expect(Object.keys(error.fieldErrors ?? {})).toEqual([field]);
      expect(JSON.stringify(await stored())).toBe(before);
      expect(await prisma.activityEvent.count()).toBe(eventsBefore);
    },
  );

  it("refuses the whole change when it mixes a locked field with an allowed one", async () => {
    const w = await demoWorld();

    const response = await api(w.app)
      .patch(ADMIN, { cookie: w.adminCookie })
      .send({ businessName: "Hijacked Plumbing", defaultTaxRate: "9.99" });

    expectApiError(response, { status: 403, code: ErrorCode.DEMO_ACCOUNT_LOCKED });
    const row = await stored();
    expect(row.businessName).toBe("CoolBreeze Home Services");
    expect(row.defaultTaxRate.toFixed(2)).toBe("8.00");
  });

  it("still lets the demo admin change everything else, and says it is still locked", async () => {
    const w = await demoWorld();

    const response = await api(w.app).patch(ADMIN, { cookie: w.adminCookie }).send({
      defaultTaxRate: "9.50",
      quotationValidityDays: 21,
      invoiceDueDays: 7,
      defaultQuotationTerms: "Valid for three weeks.",
      paymentInstructions: "Pay by bank transfer.",
      invoiceFooter: "Thanks!",
    });

    expect(response.status).toBe(200);
    const { data } = bodyOf<SettingsBody>(response);
    expect(data).toMatchObject({
      defaultTaxRate: "9.50",
      quotationValidityDays: 21,
      identityLocked: true,
    });
    expect((await stored()).businessName).toBe("CoolBreeze Home Services");
  });

  it("does not count repeating a stored value as a change", async () => {
    const w = await demoWorld();

    const response = await api(w.app)
      .patch(ADMIN, { cookie: w.adminCookie })
      .send({ businessName: "CoolBreeze Home Services", defaultTaxRate: "8.50" });

    expect(response.status).toBe(200);
  });

  it("lets the owner's own admin account change the identity, even in the demo", async () => {
    const w = await demoWorld({ env: { ADMIN_EMAILS: `${DEMO_ADMIN},${OWNER}` } });
    await createLocalAdmin(prisma, { email: OWNER });
    const owner = await signInAs(w.app, OWNER);

    const response = await api(w.app)
      .patch(ADMIN, { cookie: owner })
      .send({ businessName: "CoolBreeze & Sons" });

    expect(response.status).toBe(200);
    expect((await stored()).businessName).toBe("CoolBreeze & Sons");
  });

  it("is not reachable by a customer at all", async () => {
    const w = await demoWorld();

    const response = await api(w.app)
      .patch(ADMIN, { cookie: w.customerCookie })
      .send({ businessName: "Hijacked" });

    expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
  });
});
