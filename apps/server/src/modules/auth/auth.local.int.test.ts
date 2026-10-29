import { type ApiErrorBody, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashToken } from "../../lib/tokens.js";
import {
  createLocalAdmin,
  createLocalCustomer,
  OTHER_PASSWORD,
  SESSION_COOKIE,
  TEST_PASSWORD,
} from "../../test/auth-helpers.js";
import { buildTestApp, TEST_ADMIN_EMAIL, TEST_SESSION_SECRET } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createUser } from "../../test/fixtures.js";
import { api, bodyOf, cookieFrom, expectApiError, setCookieLine } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const REGISTER = "/api/v1/auth/register";
const LOGIN = "/api/v1/auth/login";
const ME = "/api/v1/auth/me";

const registration = {
  name: "Alex Morgan",
  email: "Alex.Morgan@Example.Test",
  password: TEST_PASSWORD,
  passwordConfirmation: TEST_PASSWORD,
  acceptTerms: true,
};

interface UserBody {
  data: {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      hasPassword: boolean;
      hasGoogle: boolean;
    };
  };
}

describe("POST /auth/register", () => {
  it("creates a customer with a profile, records the terms, signs them in and sets the cookie", async () => {
    const { app, clock } = buildTestApp({ prisma });

    const response = await api(app).post(REGISTER).send(registration);

    expect(response.status).toBe(201);
    expect(bodyOf<UserBody>(response).data.user).toMatchObject({
      name: "Alex Morgan",
      email: "alex.morgan@example.test",
      role: "CUSTOMER",
      hasPassword: true,
      hasGoogle: false,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "alex.morgan@example.test" },
      include: { customerProfile: true },
    });
    expect(user.role).toBe("CUSTOMER");
    expect(user.customerProfile).not.toBeNull();
    expect(user.termsAcceptedAt?.toISOString()).toBe(clock.now().toISOString());
    expect(user.lastSignInAt?.toISOString()).toBe(clock.now().toISOString());
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.googleSubject).toBeNull();

    // The cookie signs the new customer straight in.
    const cookie = cookieFrom(response, SESSION_COOKIE);
    const me = await api(app).get(ME, { cookie });
    expect(me.status).toBe(200);
    expect(
      bodyOf<{ data: { user: { id: string }; customer: { id: string } } }>(me).data,
    ).toMatchObject({
      user: { id: user.id },
      customer: { id: user.customerProfile?.id },
    });
  });

  it("sets a cookie that is HttpOnly, SameSite=Lax, Path=/ and seven days long, with no Domain", async () => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app).post(REGISTER).send(registration);

    const line = setCookieLine(response, SESSION_COOKIE) ?? "";
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; SameSite=Lax/);
    expect(line).toMatch(/; Path=\//);
    expect(line).toMatch(/; Max-Age=604800/);
    expect(line).not.toMatch(/; Domain=/i);
    expect(line).not.toMatch(/; Secure/);
  });

  it("stores only the HMAC of the session token, never the token itself", async () => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app).post(REGISTER).send(registration);

    const token = cookieFrom(response, SESSION_COOKIE).split("=")[1] ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(hashToken(token, TEST_SESSION_SECRET));
    expect(sessions[0]?.tokenHash).not.toContain(token);
  });

  it("stores an Argon2id hash and never the password, in the database or the response", async () => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app).post(REGISTER).send(registration);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "alex.morgan@example.test" },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(JSON.stringify(user)).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain("argon2");
  });

  it.each([
    [
      "passwords that do not match",
      { passwordConfirmation: "something else entirely" },
      "passwordConfirmation",
    ],
    [
      "a password that is too short",
      { password: "short1", passwordConfirmation: "short1" },
      "password",
    ],
    [
      "a common password",
      { password: "Password123!", passwordConfirmation: "Password123!" },
      "password",
    ],
    [
      "a password equal to the email",
      { password: "alex.morgan@example.test", passwordConfirmation: "alex.morgan@example.test" },
      "password",
    ],
    ["terms not accepted", { acceptTerms: false }, "acceptTerms"],
    ["terms missing", { acceptTerms: undefined }, "acceptTerms"],
    ["an invalid email", { email: "not-an-email" }, "email"],
    ["a name that is too short", { name: "A" }, "name"],
    ["an unknown key: role", { role: "BUSINESS_ADMIN" }, "role"],
    ["an unknown key: customerId", { customerId: "c-1" }, "customerId"],
  ])("rejects %s with 422 and creates nothing", async (_label, change, field) => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app)
      .post(REGISTER)
      .send({ ...registration, ...change });

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors).toHaveProperty(field);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
    expect(setCookieLine(response, SESSION_COOKIE)).toBeUndefined();
  });

  it("answers 409 EMAIL_TAKEN for an existing email, whatever its spelling, and changes nothing", async () => {
    const { user } = await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const { app } = buildTestApp({ prisma });

    for (const email of [
      "alex.morgan@example.test",
      "ALEX.MORGAN@EXAMPLE.TEST",
      "  Alex.Morgan@Example.Test ",
    ]) {
      const response = await api(app)
        .post(REGISTER)
        .send({ ...registration, email });
      const error = expectApiError(response, { status: 409, code: ErrorCode.EMAIL_TAKEN });
      expect(error.message).toBe(
        "An account already exists for this email — sign in or reset your password.",
      );
    }

    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(user.name);
    expect(await prisma.session.count()).toBe(0);
  });

  it("lets only one of two simultaneous registrations for the same email succeed", async () => {
    const { app } = buildTestApp({ prisma });

    const [first, second] = await Promise.all([
      api(app).post(REGISTER).send(registration),
      api(app).post(REGISTER).send(registration),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.customerProfile.count()).toBe(1);
  });

  it("refuses an allowlisted email with the vague admin message, and creates no admin", async () => {
    const { app } = buildTestApp({ prisma, env: { ADMIN_EMAILS: "owner@coolbreeze.example" } });

    for (const email of ["owner@coolbreeze.example", "OWNER@CoolBreeze.example"]) {
      const response = await api(app)
        .post(REGISTER)
        .send({ ...registration, email });
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toEqual({
        email: "This email can't be registered here. Try signing in or resetting your password.",
      });
    }

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.user.count({ where: { role: "BUSINESS_ADMIN" } })).toBe(0);
  });

  it("gives an existing admin the same answer as a new allowlisted address", async () => {
    await createLocalAdmin(prisma);
    const { app } = buildTestApp({ prisma });

    const response = await api(app)
      .post(REGISTER)
      .send({ ...registration, email: TEST_ADMIN_EMAIL });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await prisma.user.count()).toBe(1);
  });

  it("answers 403 SIGNUP_DISABLED when sign-up is closed, before looking at the body", async () => {
    const { app } = buildTestApp({ prisma, env: { PUBLIC_SIGNUP_ENABLED: "false" } });

    const valid = await api(app).post(REGISTER).send(registration);
    const invalid = await api(app).post(REGISTER).send({});

    expectApiError(valid, { status: 403, code: ErrorCode.SIGNUP_DISABLED });
    expectApiError(invalid, { status: 403, code: ErrorCode.SIGNUP_DISABLED });
    expect(await prisma.user.count()).toBe(0);
  });

  it("replaces the session of a browser that was already signed in", async () => {
    const { app } = buildTestApp({ prisma });
    const first = await api(app).post(REGISTER).send(registration);
    const oldCookie = cookieFrom(first, SESSION_COOKIE);

    const second = await api(app)
      .post(REGISTER, { cookie: oldCookie })
      .send({ ...registration, email: "priya.shah@example.test", name: "Priya Shah" });

    expect(second.status).toBe(201);
    expect((await api(app).get(ME, { cookie: oldCookie })).status).toBe(401);
    expect(await prisma.session.count()).toBe(1);
  });
});

describe("POST /auth/login", () => {
  it("signs in with the right credentials, normalizing the email, and records the sign-in time", async () => {
    const { user } = await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const { app, clock } = buildTestApp({ prisma });

    const response = await api(app)
      .post(LOGIN)
      .send({ email: "  Alex.Morgan@Example.Test ", password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(bodyOf<UserBody>(response).data.user).toMatchObject({
      id: user.id,
      role: "CUSTOMER",
      hasPassword: true,
    });
    expect(setCookieLine(response, SESSION_COOKIE)).toMatch(/; HttpOnly/);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lastSignInAt?.toISOString()).toBe(clock.now().toISOString());
    expect(JSON.stringify(response.body)).not.toContain("argon2");
  });

  it("answers wrong password, unknown email and a Google-only account with the same 401 body", async () => {
    await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    await createUser(prisma, {
      email: "gina.google@example.test",
      passwordHash: null,
      googleSubject: "google-sub-gina",
    });
    const { app } = buildTestApp({ prisma });

    const attempts = [
      { email: "alex.morgan@example.test", password: "not the right one" },
      { email: "nobody@example.test", password: TEST_PASSWORD },
      { email: "gina.google@example.test", password: TEST_PASSWORD },
    ];
    const errors = [];
    for (const attempt of attempts) {
      const response = await api(app).post(LOGIN).send(attempt);
      errors.push(expectApiError(response, { status: 401, code: ErrorCode.INVALID_CREDENTIALS }));
      expect(setCookieLine(response, SESSION_COOKIE)).toBeUndefined();
    }

    const withoutRequestId = errors.map(({ requestId: _requestId, ...rest }) => rest);
    expect(withoutRequestId[1]).toEqual(withoutRequestId[0]);
    expect(withoutRequestId[2]).toEqual(withoutRequestId[0]);
    expect(errors[0]?.message).toMatch(/Email or password is incorrect/);
    expect(errors[0]?.message).toMatch(/Google/);
    expect(await prisma.session.count()).toBe(0);
  });

  it("takes about as long for an unknown email as for a wrong password", async () => {
    await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const { app } = buildTestApp({ prisma });
    const time = async (email: string): Promise<number> => {
      const start = performance.now();
      await api(app).post(LOGIN).send({ email, password: "not the right one" });
      return performance.now() - start;
    };
    await time("alex.morgan@example.test"); // warm-up: connection, first hash

    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      known.push(await time("alex.morgan@example.test"));
      unknown.push(await time(`nobody-${i}@example.test`));
    }
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[2] ?? 0;

    // Without the dummy hash the unknown path would be an order of magnitude faster.
    expect(median(unknown)).toBeGreaterThan(median(known) / 3);
  });

  it("tells a deactivated account so only after the password is right", async () => {
    await createLocalCustomer(prisma, { email: "alex.morgan@example.test", isActive: false });
    const { app } = buildTestApp({ prisma });

    const right = await api(app)
      .post(LOGIN)
      .send({ email: "alex.morgan@example.test", password: TEST_PASSWORD });
    const wrong = await api(app)
      .post(LOGIN)
      .send({ email: "alex.morgan@example.test", password: OTHER_PASSWORD });

    expectApiError(right, { status: 403, code: ErrorCode.ACCOUNT_DISABLED });
    expectApiError(wrong, { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
    expect(await prisma.session.count()).toBe(0);
  });

  it("rejects unknown keys and missing fields with 422", async () => {
    const { app } = buildTestApp({ prisma });

    const extra = await api(app)
      .post(LOGIN)
      .send({ email: "a@b.co", password: "x", role: "BUSINESS_ADMIN" });
    const missing = await api(app).post(LOGIN).send({ email: "a@b.co" });

    expectApiError(extra, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expectApiError(missing, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("replaces the session the browser already had and leaves other devices alone", async () => {
    const { user } = await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const { app } = buildTestApp({ prisma });
    const credentials = { email: "alex.morgan@example.test", password: TEST_PASSWORD };
    const laptop = cookieFrom(await api(app).post(LOGIN).send(credentials), SESSION_COOKIE);
    const phone = cookieFrom(await api(app).post(LOGIN).send(credentials), SESSION_COOKIE);

    const again = await api(app).post(LOGIN, { cookie: laptop }).send(credentials);

    expect(again.status).toBe(200);
    expect((await api(app).get(ME, { cookie: laptop })).status).toBe(401);
    expect((await api(app).get(ME, { cookie: phone })).status).toBe(200);
    expect((await api(app).get(ME, { cookie: cookieFrom(again, SESSION_COOKIE) })).status).toBe(
      200,
    );
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it("does not leak details in the error body", async () => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app)
      .post(LOGIN)
      .send({ email: "nobody@example.test", password: "hunter2-attempt" });

    const text = JSON.stringify(bodyOf<ApiErrorBody>(response));
    expect(text).not.toContain("hunter2-attempt");
    expect(text).not.toContain("nobody@example.test");
  });
});
