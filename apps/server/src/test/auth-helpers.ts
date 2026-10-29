import type { Express } from "express";

import type { PrismaClient } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";
import { TEST_ADMIN_EMAIL } from "./build-test-app.js";
import { createAdmin, createCustomer } from "./fixtures.js";
import { api, cookieFrom } from "./http.js";

/** A password that passes the policy, shared by the fixtures below. */
export const TEST_PASSWORD = "violet teapot sails home";
export const OTHER_PASSWORD = "copper lantern drifts west";

/** The session cookie name outside production. */
export const SESSION_COOKIE = "fixflow_session";

/** A customer with a profile and a real Argon2id password. Their email is verified unless told otherwise. */
export async function createLocalCustomer(
  prisma: PrismaClient,
  overrides: {
    email?: string;
    name?: string;
    password?: string;
    verified?: boolean;
    isActive?: boolean;
  } = {},
) {
  const { email, name, password = TEST_PASSWORD, verified = true, isActive = true } = overrides;
  return createCustomer(prisma, {
    ...(email !== undefined && { email }),
    ...(name !== undefined && { name }),
    passwordHash: await hashPassword(password),
    emailVerifiedAt: verified ? new Date("2026-01-01T00:00:00.000Z") : null,
    isActive,
  });
}

/** An admin whose email is on the test apps' allowlist by default. */
export async function createLocalAdmin(
  prisma: PrismaClient,
  overrides: { email?: string; password?: string } = {},
) {
  const { email = TEST_ADMIN_EMAIL, password = TEST_PASSWORD } = overrides;
  return createAdmin(prisma, {
    email,
    passwordHash: await hashPassword(password),
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

/** Signs in through the real endpoint and returns the `Cookie` header value for later requests. */
export async function signInAs(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const response = await api(app).post("/api/v1/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in as ${email} failed with ${response.status}`);
  }
  return cookieFrom(response, SESSION_COOKIE);
}
