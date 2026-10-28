import { type Algorithm, hash, verify } from "@node-rs/argon2";

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
