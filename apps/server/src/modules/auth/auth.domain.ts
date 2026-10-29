import { createHash } from "node:crypto";

import { Role } from "@fixflow/shared";

import { DEMO_ACCOUNTS } from "../../db/seed-data.js";
import { normalizeEmail } from "../../lib/email-address.js";
import type { AuthContext } from "./auth.types.js";

/** Pure authentication rules (D-07, D-08, D-10, D-51): no I/O, so they are unit-tested directly. */

export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** A session is extended at most once per hour of activity (D-10). */
export const SESSION_RENEW_INTERVAL_MS = 60 * 60 * 1000;
export const RESET_TOKEN_LIFETIME_MINUTES = 60;
export const RESET_TOKEN_LIFETIME_MS = RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000;

export const GENERIC_CREDENTIALS_MESSAGE =
  "Email or password is incorrect. If you signed up with Google, use Continue with Google, or reset your password.";

/** Shown when someone registers with an address on the admin allowlist (D-08). Deliberately vague. */
export const ADMIN_REGISTRATION_MESSAGE =
  "This email can't be registered here. Try signing in or resetting your password.";

export const PASSWORD_RESET_REQUESTED_MESSAGE =
  "If an account exists for that email, we've sent a reset link. It works for 60 minutes.";

/**
 * A fixed-length, non-reversible stand-in for an email address in rate-limit keys, so the counter
 * store (Redis) never holds addresses.
 */
export function emailKeyPart(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_LIFETIME_MS);
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** True when the session was last renewed more than an hour ago, so its expiry should move out. */
export function shouldRenewSession(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() > SESSION_RENEW_INTERVAL_MS;
}

/** `ADMIN_EMAILS` membership (D-08). The list is already normalized; the email is normalized here. */
export function isAdminEmail(email: string, adminEmails: readonly string[]): boolean {
  return adminEmails.includes(normalizeEmail(email));
}

/** The role a brand-new Google account gets: an allowlisted email becomes an admin, anyone else a customer. */
export function roleForNewAccount(email: string, adminEmails: readonly string[]): Role {
  return isAdminEmail(email, adminEmails) ? Role.BUSINESS_ADMIN : Role.CUSTOMER;
}

/**
 * Whether the caller may use admin endpoints: the stored role must be admin **and** the email
 * must still be on the allowlist, with no exemptions (D-08). Removing an email from `ADMIN_EMAILS`
 * revokes access at the next request.
 */
export function canActAsAdmin(
  auth: Pick<AuthContext, "role" | "email">,
  adminEmails: readonly string[],
): boolean {
  return auth.role === Role.BUSINESS_ADMIN && isAdminEmail(auth.email, adminEmails);
}

/** Whether the caller may use customer endpoints: a customer with a customer record. */
export function canActAsCustomer(auth: Pick<AuthContext, "role" | "customerId">): boolean {
  return auth.role === Role.CUSTOMER && auth.customerId !== undefined;
}

const DEMO_ACCOUNT_EMAILS: ReadonlySet<string> = new Set(
  DEMO_ACCOUNTS.map((account) => normalizeEmail(account.email)),
);

/** The documented demo accounts (D-09), whose passwords are locked while `DEMO_MODE` is on. */
export function isDemoAccountEmail(email: string): boolean {
  return DEMO_ACCOUNT_EMAILS.has(normalizeEmail(email));
}

export interface ExistingAccountForGoogle {
  googleSubject: string | null;
  emailVerifiedAt: Date | null;
}

export type GoogleLinkDecision =
  /** The account already belongs to this Google identity. */
  | { kind: "already-linked" }
  /** The account is linked to a different Google identity; refuse rather than take it over. */
  | { kind: "conflict" }
  /**
   * Link this Google identity to the existing account (D-51). When the account's email was never
   * verified, a password may have been set by someone who does not own the address
   * ("pre-hijacking"), so the password is cleared and every session revoked.
   */
  | { kind: "link"; clearPasswordAndSessions: boolean };

export function decideGoogleLink(
  existing: ExistingAccountForGoogle,
  googleSubject: string,
): GoogleLinkDecision {
  if (existing.googleSubject !== null) {
    return existing.googleSubject === googleSubject
      ? { kind: "already-linked" }
      : { kind: "conflict" };
  }
  return { kind: "link", clearPasswordAndSessions: existing.emailVerifiedAt === null };
}
