import { createHmac, randomBytes } from "node:crypto";

/**
 * A fresh secret for a session cookie or a password-reset link: 32 bytes from the operating
 * system's CSPRNG, URL-safe (43 characters). Only its {@link hashToken} is ever stored.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The value stored in the database for a token: HMAC-SHA-256 keyed with `SESSION_SECRET`, as hex.
 * Tokens are high-entropy random strings, so a fast keyed hash is appropriate (a slow password
 * hash would only add latency to every request); the key means a leaked database alone cannot be
 * used to check guesses.
 */
export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
