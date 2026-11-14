import { randomBytes } from "node:crypto";

import { isUniqueViolation } from "../../apps/server/src/lib/db.js";
import { hashPassword } from "../../apps/server/src/lib/password.js";
import { createE2ePrisma } from "../../apps/server/src/test/e2e-db.js";
import { createAdmin, createCustomer } from "../../apps/server/src/test/fixtures.js";
import { credentials, E2E_SETTINGS_ADMIN_EMAIL } from "../support/env.js";

/**
 * Scenario fixtures for the E2E suite: rows inserted directly into the E2E database with the
 * same factories the API integration tests use. There is no test-only endpoint in the product.
 * Every account gets a unique address, so tests can run in parallel and never clash.
 */

export interface FixtureAccount {
  id: string;
  email: string;
  name: string;
  password: string;
}

/** A passphrase that satisfies the password policy, different every call. */
export function newPassphrase(): string {
  return `Fixture-${randomBytes(9).toString("base64url")}-7`;
}

function uniqueEmail(prefix: string, domain: string): string {
  return `${prefix}.${randomBytes(4).toString("hex")}@${domain}`;
}

export async function withDatabase<T>(
  run: (prisma: ReturnType<typeof createE2ePrisma>) => Promise<T>,
): Promise<T> {
  const prisma = createE2ePrisma();
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** A customer with a profile and a local password, who is not one of the shared demo accounts. */
export async function createCustomerAccount(
  options: { name?: string; password?: string } = {},
): Promise<FixtureAccount> {
  const name = options.name ?? "Casey Fixture";
  const password = options.password ?? newPassphrase();
  const email = uniqueEmail("casey", "example.test");

  return withDatabase(async (prisma) => {
    const { user } = await createCustomer(prisma, {
      email,
      name,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    });
    return { id: user.id, email, name, password };
  });
}

/** An administrator whose address is on the E2E API's allowlist (see `E2E_SECOND_ADMIN_EMAIL`). */
export async function createAdminAccount(
  email: string,
  options: { name?: string; password?: string } = {},
): Promise<FixtureAccount> {
  const name = options.name ?? "Jamie Fixture";
  const password = options.password ?? newPassphrase();

  return withDatabase(async (prisma) => {
    const passwordHash = await hashPassword(password);
    // Idempotent: a retried test finds the address already there and resets its password.
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing !== null) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name } });
      return { id: existing.id, email, name, password };
    }
    const user = await createAdmin(prisma, {
      email,
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
    });
    return { id: user.id, email, name, password };
  });
}

/**
 * An administrator who is not a shared demo account, so the demo-mode lock on the business identity
 * (T24, Q-11) does not apply to them. Unlike {@link createAdminAccount} it never touches an existing
 * account, its password or its sessions: every spec that needs it signs in separately, in parallel, and
 * none may sign another out. Its password is this run's demo admin password.
 */
export async function ensureSettingsAdmin(): Promise<{ email: string; password: string }> {
  const password = credentials.demoAdminPassword;
  await withDatabase(async (prisma) => {
    const existing = await prisma.user.findUnique({
      where: { email: E2E_SETTINGS_ADMIN_EMAIL },
      select: { id: true },
    });
    if (existing !== null) return;
    try {
      await createAdmin(prisma, {
        email: E2E_SETTINGS_ADMIN_EMAIL,
        name: "Jamie Settings",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
      });
    } catch (error) {
      // Another worker made it a moment ago.
      if (!isUniqueViolation(error)) throw error;
    }
  });
  return { email: E2E_SETTINGS_ADMIN_EMAIL, password };
}

/** An admin account whose address is NOT on the allowlist: signed in, but with no access (D-08). */
export async function createDelistedAdminAccount(): Promise<FixtureAccount> {
  return createAdminAccount(uniqueEmail("former.admin", "coolbreeze.test"), {
    name: "Former Admin",
  });
}

/** A fresh, unused address for a visitor who is about to register. */
export function newVisitorEmail(): string {
  return uniqueEmail("visitor", "example.test");
}
