import { ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalAdmin,
  createLocalCustomer,
  OTHER_PASSWORD,
  SESSION_COOKIE,
  signInAs,
  TEST_PASSWORD,
} from "../../test/auth-helpers.js";
import { buildTestApp, TEST_ADMIN_EMAIL, type TestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { api, bodyOf, cookieFrom, expectApiError, setCookieLine } from "../../test/http.js";
import { SESSION_LIFETIME_MS, SESSION_RENEW_INTERVAL_MS } from "./auth.domain.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ME = "/api/v1/auth/me";
const LOGIN = "/api/v1/auth/login";
const LOGOUT = "/api/v1/auth/logout";
const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";

const withProbes = (overrides: Parameters<typeof buildTestApp>[0] = {}): TestApp =>
  buildTestApp({ prisma, authProbeRoutes: true, ...overrides });

describe("GET /auth/me", () => {
  it("returns the user and, for a customer, the customer record", async () => {
    const { user, profile } = await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    const response = await api(test.app).get(ME, { cookie: await signInAs(test.app, ALEX) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: ALEX,
          avatarUrl: null,
          role: "CUSTOMER",
          hasPassword: true,
          hasGoogle: false,
        },
        customer: { id: profile.id, phone: "(212) 555-0100" },
      },
    });
  });

  it("returns an admin without a customer key", async () => {
    await createLocalAdmin(prisma);
    const test = buildTestApp({ prisma });

    const response = await api(test.app).get(ME, {
      cookie: await signInAs(test.app, TEST_ADMIN_EMAIL),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: Record<string, unknown> }>(response).data).not.toHaveProperty("customer");
    expect(bodyOf<{ data: { user: { role: string } } }>(response).data.user.role).toBe(
      "BUSINESS_ADMIN",
    );
  });

  it("is never cached and carries no validator", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    const response = await api(test.app).get(ME, { cookie: await signInAs(test.app, ALEX) });

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
  });

  it("answers 401 with no cookie", async () => {
    const test = buildTestApp({ prisma });

    expectApiError(await api(test.app).get(ME), { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it("answers 401 for a tampered or invented cookie, and clears it", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;

    for (const bad of [
      tampered,
      `${SESSION_COOKIE}=${"x".repeat(43)}`,
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}=garbage`,
    ]) {
      const response = await api(test.app).get(ME, { cookie: bad });
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
    const response = await api(test.app).get(ME, { cookie: tampered });
    expect(setCookieLine(response, SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    // The real session is untouched.
    expect((await api(test.app).get(ME, { cookie })).status).toBe(200);
  });

  it("answers 401 for an expired session and deletes it", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    expect(await prisma.session.count()).toBe(1);

    test.clock.advance(SESSION_LIFETIME_MS);
    const response = await api(test.app).get(ME, { cookie });

    expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    expect(await prisma.session.count()).toBe(0);
  });

  it("answers 401 once the user has been deactivated", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expectApiError(await api(test.app).get(ME, { cookie }), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it("drops a user's expired sessions when they sign in again", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    await signInAs(test.app, ALEX);
    test.clock.advance(SESSION_LIFETIME_MS + 1000);

    await signInAs(test.app, ALEX);

    expect(await prisma.session.count()).toBe(1);
  });
});

describe("rolling session renewal (D-10)", () => {
  it("leaves the session alone within the hour, then extends it to seven days from now", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    const started = await prisma.session.findFirstOrThrow();

    test.clock.advance(SESSION_RENEW_INTERVAL_MS - 1000);
    const early = await api(test.app).get(ME, { cookie });
    expect(early.status).toBe(200);
    expect(setCookieLine(early, SESSION_COOKIE)).toBeUndefined();
    expect((await prisma.session.findFirstOrThrow()).expiresAt).toEqual(started.expiresAt);

    test.clock.advance(2000);
    const late = await api(test.app).get(ME, { cookie });
    expect(late.status).toBe(200);
    const renewed = await prisma.session.findFirstOrThrow();
    expect(renewed.expiresAt.getTime()).toBe(test.clock.now().getTime() + SESSION_LIFETIME_MS);
    expect(renewed.lastUsedAt.getTime()).toBe(test.clock.now().getTime());
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(started.expiresAt.getTime());
    // The cookie is re-issued so its Max-Age matches the new expiry.
    expect(setCookieLine(late, SESSION_COOKIE)).toMatch(/Max-Age=604800/);
  });

  it("keeps a regularly used session alive beyond seven days", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);

    for (let day = 0; day < 10; day += 1) {
      test.clock.advance(24 * 60 * 60 * 1000);
      expect((await api(test.app).get(ME, { cookie })).status).toBe(200);
    }
  });
});

describe("POST /auth/logout", () => {
  it("deletes the session, clears the cookie, and the cookie stops working", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);

    const response = await api(test.app).post(LOGOUT, { cookie });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { signedOut: true } });
    expect(setCookieLine(response, SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.session.count()).toBe(0);
    expectApiError(await api(test.app).get(ME, { cookie }), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it("is idempotent: no cookie, a stale cookie and a repeat all succeed", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);

    expect((await api(test.app).post(LOGOUT)).status).toBe(200);
    expect((await api(test.app).post(LOGOUT, { cookie })).status).toBe(200);
    expect((await api(test.app).post(LOGOUT, { cookie })).status).toBe(200);
    expect(
      (await api(test.app).post(LOGOUT, { cookie: `${SESSION_COOKIE}=nonsense` })).status,
    ).toBe(200);
  });

  it("signs out only this device", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const laptop = await signInAs(test.app, ALEX);
    const phone = await signInAs(test.app, ALEX);

    await api(test.app).post(LOGOUT, { cookie: laptop });

    expect((await api(test.app).get(ME, { cookie: phone })).status).toBe(200);
  });
});

describe("role guards and ownership", () => {
  it("answers 401 to everyone without a session", async () => {
    const test = withProbes();

    for (const path of ["auth", "customer", "admin"]) {
      expectApiError(await api(test.app).get(`/api/v1/__probe__/${path}`), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
    }
  });

  it("answers 403 to a customer on the admin probe, and to an admin on the customer probe", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    await createLocalAdmin(prisma);
    const test = withProbes();
    const customer = await signInAs(test.app, ALEX);
    const admin = await signInAs(test.app, TEST_ADMIN_EMAIL);

    expectApiError(await api(test.app).get("/api/v1/__probe__/admin", { cookie: customer }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(await api(test.app).get("/api/v1/__probe__/customer", { cookie: admin }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expect(
      (await api(test.app).get("/api/v1/__probe__/customer", { cookie: customer })).status,
    ).toBe(200);
    expect((await api(test.app).get("/api/v1/__probe__/admin", { cookie: admin })).status).toBe(
      200,
    );
    expect((await api(test.app).get("/api/v1/__probe__/auth", { cookie: admin })).status).toBe(200);
  });

  it("takes identity from the session alone: the probe reports the signed-in user", async () => {
    const { user, profile } = await createLocalCustomer(prisma, { email: ALEX });
    const test = withProbes();

    const response = await api(test.app).get(
      "/api/v1/__probe__/customer?userId=someone-else&role=BUSINESS_ADMIN",
      {
        cookie: await signInAs(test.app, ALEX),
      },
    );

    expect(bodyOf<{ data: Record<string, string> }>(response).data).toMatchObject({
      userId: user.id,
      role: "CUSTOMER",
      customerId: profile.id,
      email: ALEX,
    });
  });

  it("answers 404 for another customer's record and 200 for the caller's own", async () => {
    const alex = await createLocalCustomer(prisma, { email: ALEX });
    const priya = await createLocalCustomer(prisma, { email: PRIYA });
    const test = withProbes();
    const cookie = await signInAs(test.app, ALEX);

    expectApiError(
      await api(test.app).get(`/api/v1/__probe__/records/${priya.profile.id}`, { cookie }),
      { status: 404, code: ErrorCode.NOT_FOUND },
    );
    expectApiError(
      await api(test.app).get("/api/v1/__probe__/records/00000000-0000-4000-8000-00000000dead", {
        cookie,
      }),
      { status: 404, code: ErrorCode.NOT_FOUND },
    );
    expect(
      (await api(test.app).get(`/api/v1/__probe__/records/${alex.profile.id}`, { cookie })).status,
    ).toBe(200);
  });

  it("makes requireAdmin answer 403 once the admin's email leaves ADMIN_EMAILS", async () => {
    await createLocalAdmin(prisma);
    const listed = withProbes();
    const cookie = await signInAs(listed.app, TEST_ADMIN_EMAIL);
    expect((await api(listed.app).get("/api/v1/__probe__/admin", { cookie })).status).toBe(200);

    // The same database and session, but the deployment's allowlist no longer names this admin.
    const delisted = withProbes({ env: { ADMIN_EMAILS: "someone.else@coolbreeze.example" } });

    expectApiError(await api(delisted.app).get("/api/v1/__probe__/admin", { cookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    // The session itself is still valid, but /me tells the web app there is no admin access.
    expect((await api(delisted.app).get("/api/v1/__probe__/auth", { cookie })).status).toBe(200);
    expectApiError(await api(delisted.app).get(ME, { cookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("does not let an empty allowlist leave admins unguarded", async () => {
    await createLocalAdmin(prisma);
    const listed = withProbes();
    const cookie = await signInAs(listed.app, TEST_ADMIN_EMAIL);
    const none = withProbes({ env: { ADMIN_EMAILS: "" } });

    expect((await api(none.app).get("/api/v1/__probe__/admin", { cookie })).status).toBe(403);
  });
});

describe("CSRF defence (D-11)", () => {
  it("rejects an unsafe request with the wrong Origin, and nothing happens", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = withProbes();
    const cookie = await signInAs(test.app, ALEX);

    const evilLogout = await api(test.app).post(LOGOUT, {
      cookie,
      origin: "https://evil.example.com",
    });
    const evilWrite = await api(test.app).post("/api/v1/__probe__/write", {
      cookie,
      origin: "https://evil.example.com",
    });
    const evilRegister = await api(test.app)
      .post("/api/v1/auth/register", { origin: "https://evil.example.com" })
      .send({
        name: "Mallory",
        email: "mallory@example.test",
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
        acceptTerms: true,
      });

    for (const response of [evilLogout, evilWrite, evilRegister]) {
      expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    }
    expect(await prisma.session.count()).toBe(1);
    expect(await prisma.user.count({ where: { email: "mallory@example.test" } })).toBe(0);
    expect((await api(test.app).get(ME, { cookie })).status).toBe(200);
  });

  it("rejects an unsafe request with no Origin, but accepts Sec-Fetch-Site: same-origin", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = withProbes();
    const cookie = await signInAs(test.app, ALEX);

    const none = await api(test.app).post("/api/v1/__probe__/write", { cookie, origin: null });
    const same = await api(test.app)
      .post("/api/v1/__probe__/write", { cookie, origin: null })
      .set("Sec-Fetch-Site", "same-origin");

    expectApiError(none, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(same.status).toBe(200);
  });

  it("never asks for an Origin on a safe request", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);

    expect((await api(test.app).get(ME, { cookie, origin: null })).status).toBe(200);
  });

  it("refuses a form-encoded body to the login endpoint", async () => {
    const test = buildTestApp({ prisma });

    const response = await api(test.app)
      .post(LOGIN)
      .type("form")
      .send({ email: ALEX, password: TEST_PASSWORD });

    expectApiError(response, { status: 400, code: ErrorCode.BAD_REQUEST });
  });
});

describe("rate limits (named and configurable)", () => {
  const rule = (limit: number, windowSeconds = 60) => ({ limit, windowSeconds });

  function expectRetryAfter(response: { headers: Record<string, unknown> }): void {
    expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  }

  describe("login", () => {
    it("blocks an IP + email after its failed attempts, even with the right password, then recovers", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      await createLocalCustomer(prisma, { email: PRIYA });
      const test = buildTestApp({ prisma, rateLimits: { loginFailures: rule(3, 900) } });
      const attempt = (email: string, password: string) =>
        api(test.app).post(LOGIN).send({ email, password });

      for (let i = 0; i < 3; i += 1) {
        expectApiError(await attempt(ALEX, OTHER_PASSWORD), {
          status: 401,
          code: ErrorCode.INVALID_CREDENTIALS,
        });
      }
      const blocked = await attempt(ALEX, TEST_PASSWORD);

      expectApiError(blocked, { status: 429, code: ErrorCode.RATE_LIMITED });
      expectRetryAfter(blocked);
      expect(setCookieLine(blocked, SESSION_COOKIE)).toBeUndefined();
      // Another email from the same IP is unaffected.
      expect((await attempt(PRIYA, TEST_PASSWORD)).status).toBe(200);

      test.clock.advanceSeconds(900);
      expect((await attempt(ALEX, TEST_PASSWORD)).status).toBe(200);
    });

    it("throttles an unknown email exactly like a known one, so the limit reveals nothing", async () => {
      const test = buildTestApp({ prisma, rateLimits: { loginFailures: rule(3, 900) } });
      const attempt = () =>
        api(test.app)
          .post(LOGIN)
          .send({ email: "nobody@example.test", password: "whatever it is" });

      for (let i = 0; i < 3; i += 1) {
        expect((await attempt()).status).toBe(401);
      }

      expectApiError(await attempt(), { status: 429, code: ErrorCode.RATE_LIMITED });
    });

    it("does not count successful sign-ins against the failure allowance", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma, rateLimits: { loginFailures: rule(3, 900) } });

      for (let i = 0; i < 6; i += 1) {
        expect(
          (await api(test.app).post(LOGIN).send({ email: ALEX, password: TEST_PASSWORD })).status,
        ).toBe(200);
      }
      for (let i = 0; i < 3; i += 1) {
        expect(
          (await api(test.app).post(LOGIN).send({ email: ALEX, password: OTHER_PASSWORD })).status,
        ).toBe(401);
      }
    });

    it("limits every attempt per IP", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma, rateLimits: { login: rule(2) } });
      const attempt = () =>
        api(test.app).post(LOGIN).send({ email: ALEX, password: TEST_PASSWORD });

      expect((await attempt()).status).toBe(200);
      expect((await attempt()).status).toBe(200);
      const limited = await attempt();

      expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
      expectRetryAfter(limited);
    });
  });

  it("limits registration per IP, before the body is even read", async () => {
    const test = buildTestApp({ prisma, rateLimits: { register: rule(2, 3600) } });
    const register = (n: number) =>
      api(test.app)
        .post("/api/v1/auth/register")
        .send({
          name: `Visitor ${n}`,
          email: `visitor${n}@example.test`,
          password: TEST_PASSWORD,
          passwordConfirmation: TEST_PASSWORD,
          acceptTerms: true,
        });

    expect((await register(1)).status).toBe(201);
    expect((await register(2)).status).toBe(201);
    const limited = await register(3);

    expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
    expectRetryAfter(limited);
    expect(await prisma.user.count()).toBe(2);
  });

  it("limits Google sign-in per IP", async () => {
    const test = buildTestApp({ prisma, rateLimits: { google: rule(2) } });
    test.google.accept("cred", { email: ALEX });
    const attempt = () => api(test.app).post("/api/v1/auth/google").send({ credential: "cred" });

    expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(200);

    expectApiError(await attempt(), { status: 429, code: ErrorCode.RATE_LIMITED });
  });

  describe("forgot password", () => {
    it("limits each email address, counting unknown addresses too", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma, rateLimits: { forgotEmail: rule(3, 3600) } });
      const forgot = (email: string) =>
        api(test.app).post("/api/v1/auth/password/forgot").send({ email });

      for (const email of [ALEX, "nobody@example.test"]) {
        for (let i = 0; i < 3; i += 1) {
          expect((await forgot(email)).status).toBe(200);
        }
        const limited = await forgot(email);
        expectApiError(limited, { status: 429, code: ErrorCode.RATE_LIMITED });
        expectRetryAfter(limited);
      }
      // A different address is untouched.
      expect((await forgot("someone.else@example.test")).status).toBe(200);
    });

    it("limits each IP across addresses", async () => {
      const test = buildTestApp({ prisma, rateLimits: { forgotIp: rule(2, 3600) } });
      const forgot = (n: number) =>
        api(test.app)
          .post("/api/v1/auth/password/forgot")
          .send({ email: `person${n}@example.test` });

      expect((await forgot(1)).status).toBe(200);
      expect((await forgot(2)).status).toBe(200);

      expectApiError(await forgot(3), { status: 429, code: ErrorCode.RATE_LIMITED });
    });
  });

  it("limits password reset attempts per IP", async () => {
    const test = buildTestApp({ prisma, rateLimits: { reset: rule(2, 3600) } });
    const reset = () =>
      api(test.app)
        .post("/api/v1/auth/password/reset")
        .send({ token: "nope", password: TEST_PASSWORD, passwordConfirmation: TEST_PASSWORD });

    expect((await reset()).status).toBe(400);
    expect((await reset()).status).toBe(400);

    expectApiError(await reset(), { status: 429, code: ErrorCode.RATE_LIMITED });
  });

  it("limits password change attempts per signed-in user", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma, rateLimits: { passwordChange: rule(2, 3600) } });
    const cookie = await signInAs(test.app, ALEX);
    const attempt = () =>
      api(test.app).post("/api/v1/auth/password/change", { cookie }).send({
        currentPassword: OTHER_PASSWORD,
        newPassword: "a brand new passphrase",
        newPasswordConfirmation: "a brand new passphrase",
      });

    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(422);

    expectApiError(await attempt(), { status: 429, code: ErrorCode.RATE_LIMITED });
  });

  it("limits logout", async () => {
    const test = buildTestApp({ prisma, rateLimits: { logout: rule(2) } });

    expect((await api(test.app).post(LOGOUT)).status).toBe(200);
    expect((await api(test.app).post(LOGOUT)).status).toBe(200);

    expectApiError(await api(test.app).post(LOGOUT), { status: 429, code: ErrorCode.RATE_LIMITED });
  });
});

describe("secrets never reach the logs", () => {
  it("keeps passwords, session tokens, reset tokens and Google credentials out of every log line", async () => {
    const test = buildTestApp({ prisma, logLevel: "info" });
    const NEW = "copper lantern drifts west";
    test.google.accept("google-credential-secret-value", {
      subject: "sub-g",
      email: "gina@example.test",
    });

    const register = await api(test.app).post("/api/v1/auth/register").send({
      name: "Alex Morgan",
      email: ALEX,
      password: TEST_PASSWORD,
      passwordConfirmation: TEST_PASSWORD,
      acceptTerms: true,
    });
    const cookie = cookieFrom(register, SESSION_COOKIE);
    const sessionToken = cookie.split("=")[1] ?? "";
    await api(test.app).get(ME, { cookie });
    await api(test.app).post(LOGOUT, { cookie });
    await api(test.app).post(LOGIN).send({ email: ALEX, password: TEST_PASSWORD });
    await api(test.app).post(LOGIN).send({ email: ALEX, password: "wrong-password-attempt" });
    await api(test.app)
      .post("/api/v1/auth/google")
      .send({ credential: "google-credential-secret-value" });
    await api(test.app).post("/api/v1/auth/password/forgot").send({ email: ALEX });
    await test.deps.background.idle();
    const resetToken = test.emails.lastResetToken() ?? "missing";
    await api(test.app)
      .post("/api/v1/auth/password/reset")
      .send({ token: resetToken, password: NEW, passwordConfirmation: NEW });
    const second = await signInAs(test.app, ALEX, NEW);
    await api(test.app).post("/api/v1/auth/password/change", { cookie: second }).send({
      currentPassword: NEW,
      newPassword: "yet another passphrase",
      newPasswordConfirmation: "yet another passphrase",
    });

    const text = test.logs.text();
    expect(text.length).toBeGreaterThan(0);
    expect(resetToken).not.toBe("missing");
    for (const secret of [
      TEST_PASSWORD,
      NEW,
      "wrong-password-attempt",
      "yet another passphrase",
      "google-credential-secret-value",
      sessionToken,
      resetToken,
      second.split("=")[1] ?? "never",
      ALEX, // email addresses are masked in delivery logs, and bodies are never logged
    ]) {
      expect(text, `the logs contain "${secret}"`).not.toContain(secret);
    }
  });
});
