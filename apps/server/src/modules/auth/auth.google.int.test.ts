import { type ApiErrorBody, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalAdmin,
  createLocalCustomer,
  SESSION_COOKIE,
  signInAs,
  TEST_PASSWORD,
} from "../../test/auth-helpers.js";
import { buildTestApp, TEST_ADMIN_EMAIL } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createUser } from "../../test/fixtures.js";
import { api, bodyOf, cookieFrom, expectApiError, setCookieLine } from "../../test/http.js";
import { GoogleSignInNotConfiguredError } from "./google-verifier.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const GOOGLE = "/api/v1/auth/google";
const ME = "/api/v1/auth/me";
const REGISTER = "/api/v1/auth/register";

interface GoogleBody {
  data: {
    isNewUser: boolean;
    user: { id: string; email: string; role: string; hasPassword: boolean; hasGoogle: boolean };
  };
}

describe("POST /auth/google", () => {
  it("creates a customer with a profile for a new Google account and signs them in", async () => {
    const { app, google, clock } = buildTestApp({ prisma });
    google.accept("cred-new", {
      subject: "sub-alex",
      email: "Alex.Morgan@Example.Test",
      name: "Alex Morgan",
      pictureUrl: "https://lh3.googleusercontent.com/a/alex",
    });

    const response = await api(app).post(GOOGLE).send({ credential: "cred-new" });

    expect(response.status).toBe(200);
    expect(bodyOf<GoogleBody>(response).data).toMatchObject({
      isNewUser: true,
      user: {
        email: "alex.morgan@example.test",
        role: "CUSTOMER",
        hasPassword: false,
        hasGoogle: true,
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "alex.morgan@example.test" },
      include: { customerProfile: true },
    });
    expect(user).toMatchObject({
      role: "CUSTOMER",
      googleSubject: "sub-alex",
      passwordHash: null,
      name: "Alex Morgan",
      avatarUrl: "https://lh3.googleusercontent.com/a/alex",
    });
    expect(user.customerProfile).not.toBeNull();
    expect(user.emailVerifiedAt?.toISOString()).toBe(clock.now().toISOString());
    expect(user.termsAcceptedAt?.toISOString()).toBe(clock.now().toISOString());
    expect(user.lastSignInAt?.toISOString()).toBe(clock.now().toISOString());

    const cookie = cookieFrom(response, SESSION_COOKIE);
    const me = await api(app).get(ME, { cookie });
    expect(me.status).toBe(200);
    expect(bodyOf<{ data: { user: { hasGoogle: boolean } } }>(me).data.user.hasGoogle).toBe(true);
  });

  it("signs in the existing user by Google subject, even if the email on the token changed", async () => {
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred-1", { subject: "sub-alex", email: "alex.morgan@example.test" });
    const first = await api(app).post(GOOGLE).send({ credential: "cred-1" });
    google.accept("cred-2", { subject: "sub-alex", email: "alex.new.address@example.test" });

    const second = await api(app).post(GOOGLE).send({ credential: "cred-2" });

    expect(second.status).toBe(200);
    expect(bodyOf<GoogleBody>(second).data.isNewUser).toBe(false);
    expect(bodyOf<GoogleBody>(second).data.user.id).toBe(bodyOf<GoogleBody>(first).data.user.id);
    expect(bodyOf<GoogleBody>(second).data.user.email).toBe("alex.morgan@example.test");
    expect(await prisma.user.count()).toBe(1);
  });

  it("links to a verified local account by email and keeps its password", async () => {
    const { user } = await createLocalCustomer(prisma, { email: "alex.morgan@example.test" });
    const { app, google } = buildTestApp({ prisma });
    const oldSession = await signInAs(app, "alex.morgan@example.test");
    google.accept("cred", { subject: "sub-alex", email: "Alex.Morgan@Example.Test" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(response.status).toBe(200);
    expect(bodyOf<GoogleBody>(response).data).toMatchObject({
      isNewUser: false,
      user: { id: user.id, hasPassword: true, hasGoogle: true },
    });
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(linked.googleSubject).toBe("sub-alex");
    expect(linked.passwordHash).toBe(user.passwordHash);
    // Nothing is revoked: the existing device stays signed in, and the password still works.
    expect((await api(app).get(ME, { cookie: oldSession })).status).toBe(200);
    expect((await signInAs(app, "alex.morgan@example.test", TEST_PASSWORD)).length).toBeGreaterThan(
      0,
    );
    expect(await prisma.user.count()).toBe(1);
  });

  it("links to an UNVERIFIED local account by clearing its password and revoking its sessions", async () => {
    const { user } = await createLocalCustomer(prisma, {
      email: "alex.morgan@example.test",
      verified: false,
    });
    const { app, google, clock } = buildTestApp({ prisma });
    // Someone who does not own the address registered it first and holds a session.
    const squatterSession = await signInAs(app, "alex.morgan@example.test");
    google.accept("cred", { subject: "sub-alex", email: "alex.morgan@example.test" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(response.status).toBe(200);
    expect(bodyOf<GoogleBody>(response).data.user).toMatchObject({
      id: user.id,
      hasPassword: false,
      hasGoogle: true,
    });
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(linked.passwordHash).toBeNull();
    expect(linked.googleSubject).toBe("sub-alex");
    expect(linked.emailVerifiedAt?.toISOString()).toBe(clock.now().toISOString());

    expect((await api(app).get(ME, { cookie: squatterSession })).status).toBe(401);
    // The squatter's password no longer works either.
    const login = await api(app)
      .post("/api/v1/auth/login")
      .send({ email: "alex.morgan@example.test", password: TEST_PASSWORD });
    expectApiError(login, { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
    // Only the new Google session exists.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await api(app).get(ME, { cookie: cookieFrom(response, SESSION_COOKIE) })).status).toBe(
      200,
    );
  });

  it("makes a new account on the allowlist an admin, without a customer profile", async () => {
    const { app, google } = buildTestApp({
      prisma,
      env: { ADMIN_EMAILS: "owner@coolbreeze.example" },
      authProbeRoutes: true,
    });
    google.accept("cred", { subject: "sub-owner", email: "Owner@CoolBreeze.example" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(bodyOf<GoogleBody>(response).data).toMatchObject({
      isNewUser: true,
      user: { email: "owner@coolbreeze.example", role: "BUSINESS_ADMIN" },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "owner@coolbreeze.example" },
      include: { customerProfile: true },
    });
    expect(user.customerProfile).toBeNull();
    const cookie = cookieFrom(response, SESSION_COOKIE);
    expect((await api(app).get("/api/v1/__probe__/admin", { cookie })).status).toBe(200);
    expect((await api(app).get("/api/v1/__probe__/customer", { cookie })).status).toBe(403);
  });

  it("never promotes an existing customer, even when their email is later allowlisted", async () => {
    const { user } = await createLocalCustomer(prisma, { email: "owner@coolbreeze.example" });
    const { app, google } = buildTestApp({
      prisma,
      env: { ADMIN_EMAILS: "owner@coolbreeze.example" },
    });
    google.accept("cred", { subject: "sub-owner", email: "owner@coolbreeze.example" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(response.status).toBe(200);
    expect(bodyOf<GoogleBody>(response).data.user.role).toBe("CUSTOMER");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("CUSTOMER");
  });

  it("maps one email spelling to one user across local sign-up and Google", async () => {
    const { app, google } = buildTestApp({ prisma });
    await api(app).post(REGISTER).send({
      name: "Alex Morgan",
      email: "Alex.Morgan@Example.Test",
      password: TEST_PASSWORD,
      passwordConfirmation: TEST_PASSWORD,
      acceptTerms: true,
    });
    google.accept("cred", { subject: "sub-alex", email: "alex.morgan@EXAMPLE.test" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(response.status).toBe(200);
    expect(bodyOf<GoogleBody>(response).data.isNewUser).toBe(false);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.customerProfile.count()).toBe(1);
  });

  it("refuses an unverified Google email with 403 and creates nothing", async () => {
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { email: "alex.morgan@example.test", emailVerified: false });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expectApiError(response, { status: 403, code: ErrorCode.GOOGLE_EMAIL_NOT_VERIFIED });
    expect(await prisma.user.count()).toBe(0);
    expect(setCookieLine(response, SESSION_COOKIE)).toBeUndefined();
  });

  it("answers 401 INVALID_GOOGLE_CREDENTIAL when the verifier rejects the token", async () => {
    const { app } = buildTestApp({ prisma });

    const response = await api(app).post(GOOGLE).send({ credential: "forged-or-expired" });

    expectApiError(response, { status: 401, code: ErrorCode.INVALID_GOOGLE_CREDENTIAL });
    expect(await prisma.user.count()).toBe(0);
  });

  it("answers 503 when Google sign-in is not configured on the server", async () => {
    const { app } = buildTestApp({
      prisma,
      googleVerifier: { verify: () => Promise.reject(new GoogleSignInNotConfiguredError()) },
    });

    const response = await api(app).post(GOOGLE).send({ credential: "anything" });

    expectApiError(response, { status: 503, code: ErrorCode.GOOGLE_SIGN_IN_UNAVAILABLE });
  });

  it("refuses a deactivated account, found by subject or by email", async () => {
    await createUser(prisma, {
      email: "by.subject@example.test",
      googleSubject: "sub-subject",
      passwordHash: null,
      isActive: false,
    });
    await createLocalCustomer(prisma, { email: "by.email@example.test", isActive: false });
    const { app, google } = buildTestApp({ prisma });
    google.accept("by-subject", { subject: "sub-subject", email: "by.subject@example.test" });
    google.accept("by-email", { subject: "sub-new", email: "by.email@example.test" });

    for (const credential of ["by-subject", "by-email"]) {
      const response = await api(app).post(GOOGLE).send({ credential });
      expectApiError(response, { status: 403, code: ErrorCode.ACCOUNT_DISABLED });
    }
    expect(await prisma.session.count()).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: "by.email@example.test" } }))
        .googleSubject,
    ).toBeNull();
  });

  it("refuses to link an account that already belongs to a different Google identity", async () => {
    await createUser(prisma, {
      email: "alex.morgan@example.test",
      googleSubject: "sub-original",
      passwordHash: null,
    });
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { subject: "sub-someone-else", email: "alex.morgan@example.test" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expectApiError(response, { status: 409, code: ErrorCode.CONFLICT });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: "alex.morgan@example.test" } }))
        .googleSubject,
    ).toBe("sub-original");
  });

  it("honours PUBLIC_SIGNUP_ENABLED=false for new customers only", async () => {
    await createLocalCustomer(prisma, { email: "existing@example.test" });
    const { app, google } = buildTestApp({
      prisma,
      env: { PUBLIC_SIGNUP_ENABLED: "false", ADMIN_EMAILS: "owner@coolbreeze.example" },
    });
    google.accept("new-customer", { subject: "sub-new", email: "new.customer@example.test" });
    google.accept("existing", { subject: "sub-existing", email: "existing@example.test" });
    google.accept("owner", { subject: "sub-owner", email: "owner@coolbreeze.example" });

    const blocked = await api(app).post(GOOGLE).send({ credential: "new-customer" });
    const existing = await api(app).post(GOOGLE).send({ credential: "existing" });
    const owner = await api(app).post(GOOGLE).send({ credential: "owner" });

    expectApiError(blocked, { status: 403, code: ErrorCode.SIGNUP_DISABLED });
    expect(existing.status).toBe(200);
    expect(owner.status).toBe(200);
    expect(await prisma.user.count({ where: { email: "new.customer@example.test" } })).toBe(0);
  });

  it("creates one account when the same person signs in twice at once", async () => {
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { subject: "sub-alex", email: "alex.morgan@example.test" });

    const [first, second] = await Promise.all([
      api(app).post(GOOGLE).send({ credential: "cred" }),
      api(app).post(GOOGLE).send({ credential: "cred" }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.customerProfile.count()).toBe(1);
    const newUsers = [first, second].filter((r) => bodyOf<GoogleBody>(r).data.isNewUser);
    expect(newUsers).toHaveLength(1);
  });

  it("rejects an unknown key with 422, so a client cannot pick a role", async () => {
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { email: "alex.morgan@example.test" });

    const response = await api(app)
      .post(GOOGLE)
      .send({ credential: "cred", role: "BUSINESS_ADMIN" });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await prisma.user.count()).toBe(0);
  });

  it("does not let a Google sign-in create an admin for an address that is not allowlisted", async () => {
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { subject: "sub-x", email: "someone.else@coolbreeze.example" });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(bodyOf<GoogleBody>(response).data.user.role).toBe("CUSTOMER");
    expect(await prisma.user.count({ where: { role: "BUSINESS_ADMIN" } })).toBe(0);
  });

  it("links an existing allowlisted admin and keeps their role and password", async () => {
    const admin = await createLocalAdmin(prisma);
    const { app, google } = buildTestApp({ prisma });
    google.accept("cred", { subject: "sub-admin", email: TEST_ADMIN_EMAIL });

    const response = await api(app).post(GOOGLE).send({ credential: "cred" });

    expect(bodyOf<GoogleBody>(response).data.user).toMatchObject({
      id: admin.id,
      role: "BUSINESS_ADMIN",
      hasPassword: true,
      hasGoogle: true,
    });
  });

  it("keeps the credential and the token out of the error body and the logs", async () => {
    const { app, logs } = buildTestApp({ prisma, logLevel: "info" });

    const response = await api(app)
      .post(GOOGLE)
      .send({ credential: "eyJ-secret-credential-value" });

    expect(JSON.stringify(bodyOf<ApiErrorBody>(response))).not.toContain("secret-credential");
    expect(logs.text()).not.toContain("secret-credential");
  });
});
