import type { CookieOptions, Request, Response } from "express";

import type { Config } from "../../config/env.js";
import { readCookie } from "../../lib/cookies.js";

/**
 * The session cookie (D-10): HTTP-only (scripts cannot read it), `SameSite=Lax` (not sent on
 * cross-site POSTs), `Path=/`, `Secure` in production, and **no `Domain`**, so it belongs to the
 * exact host the browser reached. Behind the same-origin proxy (D-06) that host is the web app's.
 * Production uses the `__Host-` prefix, which browsers only accept with `Secure`, `Path=/` and no
 * `Domain`.
 */
function baseOptions(config: Pick<Config, "isProduction">): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.isProduction,
  };
}

export function setSessionCookie(
  res: Response,
  config: Pick<Config, "isProduction" | "auth">,
  token: string,
  expiresAt: Date,
  now: Date,
): void {
  res.cookie(config.auth.cookieName, token, {
    ...baseOptions(config),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearSessionCookie(
  res: Response,
  config: Pick<Config, "isProduction" | "auth">,
): void {
  res.clearCookie(config.auth.cookieName, baseOptions(config));
}

/** The raw session token the browser sent, if any. */
export function readSessionToken(req: Request, config: Pick<Config, "auth">): string | undefined {
  return readCookie(req, config.auth.cookieName);
}
