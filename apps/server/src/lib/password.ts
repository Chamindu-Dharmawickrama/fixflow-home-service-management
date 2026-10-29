import { randomBytes } from "node:crypto";

import { LIMITS } from "@fixflow/shared";
import { type Algorithm, hash, verify } from "@node-rs/argon2";

import { isCommonPassword } from "./common-passwords.js";
import { normalizeEmail } from "./email-address.js";

/**
 * Argon2id parameters from the OWASP Password Storage Cheat Sheet (19 MiB of memory, 2 passes,
 * 1 lane). They are fixed here rather than taken from the library's defaults so the cost does not
 * change silently with a dependency upgrade. The parameters are stored inside every hash, so
 * raising them later still verifies old hashes.
 */
const ARGON2_OPTIONS = {
  // `Algorithm` is an ambient const enum, which cannot be imported under isolatedModules; 2 is
  // Argon2id. The password test asserts the "$argon2id$" prefix of the result.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a password with Argon2id (D-51). The result is a self-describing PHC string with its own salt. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Checks a password against a stored hash. A malformed or foreign hash is "no match", never an
 * exception, so callers cannot tell a corrupt row from a wrong password by the error.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real password check and always reports "no match". Sign-in calls it
 * when there is no password to check (an unknown email, or a Google-only account), so the response
 * time does not reveal which case it was.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}

export type PasswordPolicyViolation = "TOO_SHORT" | "TOO_LONG" | "SAME_AS_EMAIL" | "TOO_COMMON";

export const PASSWORD_POLICY_MESSAGES: Readonly<Record<PasswordPolicyViolation, string>> = {
  TOO_SHORT: `Use at least ${LIMITS.password.minLength} characters.`,
  TOO_LONG: `Use no more than ${LIMITS.password.maxLength} characters.`,
  SAME_AS_EMAIL: "Your password can't be the same as your email address.",
  TOO_COMMON: "That password is too common. Choose something harder to guess.",
};

/**
 * The password policy (D-51, NIST SP 800-63B style): 10 to 128 characters, no composition rules,
 * not the account's own email address, and not one of the bundled common passwords. Returns the
 * first violation, or `undefined` when the password is acceptable.
 */
export function checkPasswordPolicy(
  password: string,
  context: { email?: string | undefined } = {},
): PasswordPolicyViolation | undefined {
  if (password.length < LIMITS.password.minLength) return "TOO_SHORT";
  if (password.length > LIMITS.password.maxLength) return "TOO_LONG";
  if (context.email !== undefined && normalizeEmail(password) === normalizeEmail(context.email)) {
    return "SAME_AS_EMAIL";
  }
  if (isCommonPassword(password)) return "TOO_COMMON";
  return undefined;
}

/** The user-facing message for a policy violation, or `undefined` when the password is fine. */
export function passwordPolicyMessage(
  password: string,
  context: { email?: string | undefined } = {},
): string | undefined {
  const violation = checkPasswordPolicy(password, context);
  return violation === undefined ? undefined : PASSWORD_POLICY_MESSAGES[violation];
}
