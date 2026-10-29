import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashToken } from "../../lib/tokens.js";
import {
  createLocalCustomer,
  OTHER_PASSWORD,
  SESSION_COOKIE,
  signInAs,
  TEST_PASSWORD,
} from "../../test/auth-helpers.js";
import { buildTestApp, TEST_SESSION_SECRET, type TestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createUser } from "../../test/fixtures.js";
import { api, bodyOf, cookieFrom, expectApiError } from "../../test/http.js";
import { createEmailSender } from "../email/email-sender.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const FORGOT = "/api/v1/auth/password/forgot";
const RESET = "/api/v1/auth/password/reset";
const CHANGE = "/api/v1/auth/password/change";
const LOGIN = "/api/v1/auth/login";
const ME = "/api/v1/auth/me";

const NEW_PASSWORD = "copper lantern drifts west";
const ALEX = "alex.morgan@example.test";

/** Asks for a reset, waits for the email, and returns the token from its link. */
async function requestResetToken(test: TestApp, email: string): Promise<string> {
  const response = await api(test.app).post(FORGOT).send({ email });
  expect(response.status).toBe(200);
  await test.deps.background.idle();
  const token = test.emails.lastResetToken();
  if (token === undefined) throw new Error("No reset link was emailed.");
  return token;
}

const resetBody = (token: string, password = NEW_PASSWORD) => ({
  token,
  password,
  passwordConfirmation: password,
});

describe("POST /auth/password/forgot", () => {
  it("answers existing and unknown emails with the identical 200 body", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    const existing = await api(test.app).post(FORGOT).send({ email: ALEX });
    const unknown = await api(test.app).post(FORGOT).send({ email: "nobody@example.test" });

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(existing.body);
    expect(bodyOf<{ data: { message: string } }>(existing).data.message).toBe(
      "If an account exists for that email, we've sent a reset link. It works for 60 minutes.",
    );
  });

  it("creates a token, stored as a hash that expires in 60 minutes, only for an existing account", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    await api(test.app).post(FORGOT).send({ email: "nobody@example.test" });
    expect(await prisma.passwordResetToken.count()).toBe(0);

    const token = await requestResetToken(test, ALEX);

    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: user.id, usedAt: null });
    expect(rows[0]?.tokenHash).toBe(hashToken(token, TEST_SESSION_SECRET));
    expect(rows[0]?.tokenHash).not.toContain(token);
    expect(rows[0]?.expiresAt.toISOString()).toBe("2026-03-02T10:00:00.000Z");
  });

  it("emails the link built from PUBLIC_WEB_URL, with the business name from settings", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    await prisma.businessSettings.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        businessName: "CoolBreeze Home Services",
        contactEmail: "hello@coolbreeze.test",
        phone: "(212) 555-0142",
        addressLine1: "48 Harbor Point Road",
        city: "Harbor City",
        postalCode: "10999",
        currencyCode: "USD",
        timeZone: "America/New_York",
        defaultTaxRate: "8.00",
        quotationValidityDays: 14,
        invoiceDueDays: 14,
      },
    });
    const test = buildTestApp({
      prisma,
      env: { PUBLIC_WEB_URL: "https://fixflow.example.com" },
    });

    const token = await requestResetToken(test, ALEX);

    expect(test.emails.sent).toHaveLength(1);
    expect(test.emails.last).toMatchObject({
      to: ALEX,
      subject: "Reset your CoolBreeze Home Services password",
    });
    expect(test.emails.lastLink()).toBe(
      `https://fixflow.example.com/reset-password?token=${token}`,
    );
    expect(test.emails.last?.html).toContain("CoolBreeze Home Services");
  });

  it("records the delivery without the address or the message", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    await requestResetToken(test, ALEX);

    const logs = await prisma.emailDeliveryLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      template: "password-reset",
      recipientMasked: "a***@example.test",
      transport: "log",
      status: "LOGGED",
    });
    expect(JSON.stringify(logs)).not.toContain("alex.morgan");
    expect(logs[0]?.attemptedAt).not.toBeNull();
    expect(logs[0]?.sentAt).toBeNull();
  });

  it("still answers 200 when the email cannot be delivered, and records the failure", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    test.emails.failWith = Object.assign(new Error("connect ECONNREFUSED smtp.internal"), {
      code: "ECONNECTION",
    });

    const response = await api(test.app).post(FORGOT).send({ email: ALEX });
    await test.deps.background.idle();

    expect(response.status).toBe(200);
    const logs = await prisma.emailDeliveryLog.findMany();
    expect(logs[0]).toMatchObject({ status: "FAILED", errorCode: "ECONNECTION" });
  });

  it("invalidates older links when a new one is requested", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const first = await requestResetToken(test, ALEX);
    const second = await requestResetToken(test, ALEX);

    expect(await prisma.passwordResetToken.count()).toBe(1);
    expectApiError(await api(test.app).post(RESET).send(resetBody(first)), {
      status: 400,
      code: ErrorCode.INVALID_RESET_TOKEN,
    });
    expect((await api(test.app).post(RESET).send(resetBody(second))).status).toBe(200);
  });

  it("sends nothing and creates no token for a deactivated account, but answers the same", async () => {
    await createLocalCustomer(prisma, { email: ALEX, isActive: false });
    const test = buildTestApp({ prisma });

    const response = await api(test.app).post(FORGOT).send({ email: ALEX });
    await test.deps.background.idle();

    expect(response.status).toBe(200);
    expect(test.emails.sent).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("lets a Google-only account add a password through the reset flow", async () => {
    await createUser(prisma, {
      email: "gina.google@example.test",
      googleSubject: "sub-gina",
      passwordHash: null,
    });
    const test = buildTestApp({ prisma });

    const token = await requestResetToken(test, "gina.google@example.test");
    expect((await api(test.app).post(RESET).send(resetBody(token))).status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "gina.google@example.test" },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.googleSubject).toBe("sub-gina");
    expect(
      (await signInAs(test.app, "gina.google@example.test", NEW_PASSWORD)).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a malformed email with 422 and unknown keys", async () => {
    const test = buildTestApp({ prisma });

    expectApiError(await api(test.app).post(FORGOT).send({ email: "nope" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(await api(test.app).post(FORGOT).send({ email: ALEX, userId: "u1" }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("writes the link to the outbox directory with the real log transport", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const outboxDir = await mkdtemp(join(tmpdir(), "fixflow-outbox-"));
    try {
      const probe = buildTestApp({ prisma, env: { EMAIL_OUTBOX_DIR: outboxDir } });
      const test = buildTestApp({
        prisma,
        env: { EMAIL_OUTBOX_DIR: outboxDir },
        emailSender: createEmailSender(probe.deps.config, probe.deps.logger, probe.clock),
      });

      await api(test.app).post(FORGOT).send({ email: ALEX });
      await test.deps.background.idle();

      const files = (await readdir(outboxDir)).sort();
      expect(files).toHaveLength(2);
      const text = await readFile(
        join(outboxDir, files.find((f) => f.endsWith(".txt")) ?? ""),
        "utf8",
      );
      expect(text).toContain(`To: ${ALEX}`);
      expect(text).toMatch(/http:\/\/localhost:3000\/reset-password\?token=[A-Za-z0-9_-]{43}/);
      expect((await prisma.emailDeliveryLog.findFirstOrThrow()).status).toBe("LOGGED");
    } finally {
      await rm(outboxDir, { recursive: true, force: true });
    }
  });

  describe("without a mail server in production", () => {
    const productionEnv = {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://fixflow.example.com",
      DATABASE_URL: "postgresql://app:pw@db.example.com:5432/fixflow",
      UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
      RATE_LIMIT_MULTIPLIER: "1",
    };

    it("says reset is unavailable and creates no token", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma, env: productionEnv });

      const response = await api(test.app)
        .post(FORGOT, { origin: productionEnv.WEB_ORIGIN })
        .send({ email: ALEX });
      await test.deps.background.idle();

      expectApiError(response, { status: 503, code: ErrorCode.PASSWORD_RESET_UNAVAILABLE });
      expect(await prisma.passwordResetToken.count()).toBe(0);
      expect(test.emails.sent).toHaveLength(0);
    });

    it("works once SMTP is configured", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({
        prisma,
        env: {
          ...productionEnv,
          // Production requires every SMTP variable (T06), not just the host and the sender.
          SMTP_HOST: "smtp.example.com",
          SMTP_PORT: "587",
          SMTP_SECURE: "false",
          SMTP_USER: "mailer",
          SMTP_PASSWORD: "not-a-real-password",
          EMAIL_FROM: "hello@coolbreeze.example",
        },
      });

      const response = await api(test.app)
        .post(FORGOT, { origin: productionEnv.WEB_ORIGIN })
        .send({ email: ALEX });
      await test.deps.background.idle();

      expect(response.status).toBe(200);
      expect(await prisma.passwordResetToken.count()).toBe(1);
    });
  });

  describe("in demo mode (D-09)", () => {
    it("locks the shared demo accounts with 403 and creates no token", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma, env: { DEMO_MODE: "true" } });

      const response = await api(test.app).post(FORGOT).send({ email: ALEX });
      await test.deps.background.idle();

      expectApiError(response, { status: 403, code: ErrorCode.DEMO_ACCOUNT_LOCKED });
      expect(await prisma.passwordResetToken.count()).toBe(0);
      expect(test.emails.sent).toHaveLength(0);
    });

    it("still resets the password of a visitor's own account", async () => {
      await createLocalCustomer(prisma, { email: "visitor@example.test" });
      const test = buildTestApp({ prisma, env: { DEMO_MODE: "true" } });

      const response = await api(test.app).post(FORGOT).send({ email: "visitor@example.test" });

      expect(response.status).toBe(200);
      expect(await prisma.passwordResetToken.count()).toBe(1);
    });

    it("does not lock the demo accounts when demo mode is off", async () => {
      await createLocalCustomer(prisma, { email: ALEX });
      const test = buildTestApp({ prisma });

      expect((await api(test.app).post(FORGOT).send({ email: ALEX })).status).toBe(200);
    });
  });
});

describe("POST /auth/password/reset", () => {
  it("sets the new password, marks the email verified and spends the token", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX, verified: false });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);

    const response = await api(test.app).post(RESET).send(resetBody(token));

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: { passwordReset: boolean } }>(response).data.passwordReset).toBe(true);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.passwordHash).not.toBe(user.passwordHash);
    expect(updated.passwordHash).toMatch(/^\$argon2id\$/);
    expect(updated.emailVerifiedAt?.toISOString()).toBe(test.clock.now().toISOString());
    expect((await prisma.passwordResetToken.findFirstOrThrow()).usedAt).not.toBeNull();

    // Old password out, new password in.
    expectApiError(await api(test.app).post(LOGIN).send({ email: ALEX, password: TEST_PASSWORD }), {
      status: 401,
      code: ErrorCode.INVALID_CREDENTIALS,
    });
    expect((await signInAs(test.app, ALEX, NEW_PASSWORD)).length).toBeGreaterThan(0);
  });

  it("revokes every session of the account, and no other account's", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    await createLocalCustomer(prisma, { email: "priya.shah@example.test" });
    const test = buildTestApp({ prisma });
    const laptop = await signInAs(test.app, ALEX);
    const phone = await signInAs(test.app, ALEX);
    const priya = await signInAs(test.app, "priya.shah@example.test");
    const token = await requestResetToken(test, ALEX);

    const response = await api(test.app).post(RESET, { cookie: laptop }).send(resetBody(token));

    expect(response.status).toBe(200);
    expect((await api(test.app).get(ME, { cookie: laptop })).status).toBe(401);
    expect((await api(test.app).get(ME, { cookie: phone })).status).toBe(401);
    expect((await api(test.app).get(ME, { cookie: priya })).status).toBe(200);
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("works once: the same link cannot be used again", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);
    expect((await api(test.app).post(RESET).send(resetBody(token))).status).toBe(200);

    const again = await api(test.app).post(RESET).send(resetBody(token, "another passphrase here"));

    expectApiError(again, { status: 400, code: ErrorCode.INVALID_RESET_TOKEN });
    expect((await signInAs(test.app, ALEX, NEW_PASSWORD)).length).toBeGreaterThan(0);
  });

  it("lets only one of two simultaneous uses succeed", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);

    const [a, b] = await Promise.all([
      api(test.app).post(RESET).send(resetBody(token, "first passphrase wins")),
      api(test.app).post(RESET).send(resetBody(token, "second passphrase wins")),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it("expires 60 minutes after it was issued (clock test)", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);

    test.clock.advance(60 * 60 * 1000 - 1);
    const stillValid = await api(test.app).post(RESET).send(resetBody(token));
    expect(stillValid.status).toBe(200);

    const second = buildTestApp({ prisma });
    const secondToken = await requestResetToken(second, ALEX);
    second.clock.advance(60 * 60 * 1000);
    expectApiError(await api(second.app).post(RESET).send(resetBody(secondToken)), {
      status: 400,
      code: ErrorCode.INVALID_RESET_TOKEN,
    });
  });

  it("answers an unknown, garbage or empty-looking token with the same 400", async () => {
    const test = buildTestApp({ prisma });

    const bodies = [];
    for (const token of ["not-a-real-token", "x".repeat(43), "A".repeat(500)]) {
      const response = await api(test.app).post(RESET).send(resetBody(token));
      const error = expectApiError(response, { status: 400, code: ErrorCode.INVALID_RESET_TOKEN });
      bodies.push({ code: error.code, message: error.message });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("rejects a weak, mismatched or email-equal password without spending the link", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);

    const weak = await api(test.app).post(RESET).send(resetBody(token, "short"));
    const common = await api(test.app).post(RESET).send(resetBody(token, "Password123!"));
    const mismatch = await api(test.app)
      .post(RESET)
      .send({ ...resetBody(token), passwordConfirmation: "something else entirely" });
    const sameAsEmail = await api(test.app).post(RESET).send(resetBody(token, ALEX));

    for (const response of [weak, common, mismatch, sameAsEmail]) {
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    }
    expect((await prisma.passwordResetToken.findFirstOrThrow()).usedAt).toBeNull();
    // The same link still works afterwards.
    expect((await api(test.app).post(RESET).send(resetBody(token))).status).toBe(200);
  });

  it("refuses a link for an account that has since been deactivated", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const token = await requestResetToken(test, ALEX);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expectApiError(await api(test.app).post(RESET).send(resetBody(token)), {
      status: 400,
      code: ErrorCode.INVALID_RESET_TOKEN,
    });
  });

  it("rejects unknown keys", async () => {
    const test = buildTestApp({ prisma });

    const response = await api(test.app)
      .post(RESET)
      .send({ ...resetBody("t"), email: "someone@example.test" });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });
});

describe("POST /auth/password/change", () => {
  it("needs a session", async () => {
    const test = buildTestApp({ prisma });

    const response = await api(test.app).post(CHANGE).send({
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      newPasswordConfirmation: NEW_PASSWORD,
    });

    expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  const change = (cookie: string, body: Record<string, unknown>, test: TestApp) =>
    api(test.app).post(CHANGE, { cookie }).send(body);

  it("changes the password and signs out every other device, keeping this one", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const here = await signInAs(test.app, ALEX);
    const elsewhere = await signInAs(test.app, ALEX);

    const response = await change(
      here,
      {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      },
      test,
    );

    expect(response.status).toBe(200);
    expect((await api(test.app).get(ME, { cookie: here })).status).toBe(200);
    expect((await api(test.app).get(ME, { cookie: elsewhere })).status).toBe(401);
    expectApiError(await api(test.app).post(LOGIN).send({ email: ALEX, password: TEST_PASSWORD }), {
      status: 401,
      code: ErrorCode.INVALID_CREDENTIALS,
    });
    expect((await signInAs(test.app, ALEX, NEW_PASSWORD)).length).toBeGreaterThan(0);
  });

  it("requires the correct current password and changes nothing otherwise", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    const other = await signInAs(test.app, ALEX);

    const response = await change(
      cookie,
      {
        currentPassword: OTHER_PASSWORD,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      },
      test,
    );

    const error = expectApiError(response, {
      status: 422,
      code: ErrorCode.INVALID_CURRENT_PASSWORD,
    });
    expect(error.fieldErrors).toEqual({ currentPassword: "Your current password is incorrect." });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(
      user.passwordHash,
    );
    expect((await api(test.app).get(ME, { cookie: other })).status).toBe(200);
  });

  it("applies the password policy to the new password, including 'not your email'", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });
    const cookie = await signInAs(test.app, ALEX);
    const attempt = (password: string) =>
      change(
        cookie,
        {
          currentPassword: TEST_PASSWORD,
          newPassword: password,
          newPasswordConfirmation: password,
        },
        test,
      );

    for (const password of ["short", "Password123!", ALEX]) {
      const error = expectApiError(await attempt(password), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(error.fieldErrors).toHaveProperty("newPassword");
    }
    expect(
      expectApiError(
        await change(
          cookie,
          {
            currentPassword: TEST_PASSWORD,
            newPassword: NEW_PASSWORD,
            newPasswordConfirmation: "x",
          },
          test,
        ),
        { status: 422, code: ErrorCode.VALIDATION_ERROR },
      ).fieldErrors,
    ).toHaveProperty("newPasswordConfirmation");
  });

  it("tells a Google-only account to set a password first", async () => {
    await createUser(prisma, {
      email: "gina.google@example.test",
      googleSubject: "sub-gina",
      passwordHash: null,
    });
    const test = buildTestApp({ prisma });
    test.google.accept("cred", { subject: "sub-gina", email: "gina.google@example.test" });
    const cookie = cookieFrom(
      await api(test.app).post("/api/v1/auth/google").send({ credential: "cred" }),
      SESSION_COOKIE,
    );

    const response = await change(
      cookie,
      {
        currentPassword: "anything at all",
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      },
      test,
    );

    expectApiError(response, { status: 409, code: ErrorCode.PASSWORD_NOT_SET });
  });

  it("locks the shared demo accounts in demo mode, and only then (D-09)", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const locked = buildTestApp({ prisma, env: { DEMO_MODE: "true" } });
    const body = {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      newPasswordConfirmation: NEW_PASSWORD,
    };

    const lockedResponse = await change(await signInAs(locked.app, ALEX), body, locked);
    expectApiError(lockedResponse, { status: 403, code: ErrorCode.DEMO_ACCOUNT_LOCKED });
    expect((await signInAs(locked.app, ALEX, TEST_PASSWORD)).length).toBeGreaterThan(0);

    const open = buildTestApp({ prisma });
    expect((await change(await signInAs(open.app, ALEX), body, open)).status).toBe(200);
  });

  it("lets an ordinary visitor account change its password in demo mode", async () => {
    await createLocalCustomer(prisma, { email: "visitor@example.test" });
    const test = buildTestApp({ prisma, env: { DEMO_MODE: "true" } });

    const response = await change(
      await signInAs(test.app, "visitor@example.test"),
      {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
      },
      test,
    );

    expect(response.status).toBe(200);
  });

  it("rejects unknown keys", async () => {
    await createLocalCustomer(prisma, { email: ALEX });
    const test = buildTestApp({ prisma });

    const response = await change(
      await signInAs(test.app, ALEX),
      {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        newPasswordConfirmation: NEW_PASSWORD,
        userId: "someone-else",
      },
      test,
    );

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });
});
