import type { Request, RequestHandler, Response } from "express";

import type { AppDeps } from "../../deps.js";
import { forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { clientIp, rateLimitByName } from "../../middleware/rate-limit.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./auth.cookie.js";
import { canActAsAdmin, canActAsCustomer, isDemoAccountEmail } from "./auth.domain.js";
import type { AuthContext } from "./auth.types.js";
import { resolveSession } from "./session.service.js";

type AuthDeps = Pick<
  AppDeps,
  "prisma" | "clock" | "config" | "logger" | "rateLimiter" | "rateLimits"
>;

/** The methods that change something. A shared demo account's use of them is limited (T24). */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const SESSION_REQUIRED_MESSAGE = "Sign in to continue.";

export interface AuthMiddleware {
  /** 401 unless the request carries a valid session; sets `req.auth`. */
  requireAuth: RequestHandler;
  /** `requireAuth`, then 403 unless the caller is a customer with a customer record. */
  requireCustomer: RequestHandler;
  /** `requireAuth`, then 403 unless the caller is an admin who is still on the allowlist. */
  requireAdmin: RequestHandler;
}

/**
 * The authenticated caller, for handlers behind `requireAuth`. It reads only `req.auth`, so it also
 * accepts the request type of a handler behind `validate(...)`.
 */
export function authOf(req: Pick<Request, "auth">): AuthContext {
  if (req.auth === undefined) {
    // A route forgot `requireAuth`: fail closed rather than serve it unauthenticated.
    throw unauthorized(SESSION_REQUIRED_MESSAGE);
  }
  return req.auth;
}

/**
 * Throws `404` unless the resource belongs to the signed-in customer (D-41). A record that is not
 * yours is indistinguishable from one that does not exist, so ids cannot be probed. The customer
 * id always comes from the session, never from the request.
 */
export function assertCustomerOwns(
  resourceCustomerId: string | null | undefined,
  auth: AuthContext,
): void {
  if (
    !canActAsCustomer(auth) ||
    resourceCustomerId === null ||
    resourceCustomerId === undefined ||
    auth.customerId !== resourceCustomerId
  ) {
    throw notFound();
  }
}

/**
 * Session middleware and role guards. The session is looked up per protected route (not for every
 * request), so unauthenticated endpoints such as health and sign-in never touch the database for
 * it. A renewed session re-issues the cookie so its `Max-Age` keeps matching the stored expiry.
 * Failures are thrown from async handlers, which Express 5 forwards to the error handler.
 */
export function createAuthMiddleware(deps: AuthDeps): AuthMiddleware {
  const { config, clock } = deps;

  /**
   * The demo write limit (T24): while `DEMO_MODE` is on, a write made with a session of one of the
   * shared demo accounts counts against `demoWrite` (60 in ten minutes per account and IP address).
   * The 429 comes from the same limiter every other limit uses, so it carries `Retry-After`. It lives
   * here because this is the one place that knows who the caller is, before any handler writes.
   */
  const demoWriteLimit = rateLimitByName(
    deps,
    "demoWrite",
    (req) => `${req.auth?.userId ?? "unknown"}:${clientIp(req)}`,
  );

  function enforceDemoWriteLimit(req: Request, res: Response, auth: AuthContext): Promise<void> {
    if (
      !config.auth.demoMode ||
      !WRITE_METHODS.has(req.method) ||
      !isDemoAccountEmail(auth.email)
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      void demoWriteLimit(req, res, (error?: unknown) => {
        if (error === undefined || error === null) {
          resolve();
        } else {
          reject(error instanceof Error ? error : new Error("The demo write limit failed."));
        }
      });
    });
  }

  async function authenticate(req: Request, res: Response): Promise<AuthContext> {
    const token = readSessionToken(req, config);
    if (token === undefined || token === "") {
      throw unauthorized(SESSION_REQUIRED_MESSAGE);
    }

    const resolved = await resolveSession(deps, token);
    if (resolved === undefined) {
      // The cookie is stale (expired, revoked, tampered): remove it from the browser too.
      clearSessionCookie(res, config);
      throw unauthorized(SESSION_REQUIRED_MESSAGE);
    }

    req.auth = resolved.auth;
    if (resolved.renewedUntil !== undefined) {
      setSessionCookie(res, config, token, resolved.renewedUntil, clock.now());
    }
    await enforceDemoWriteLimit(req, res, resolved.auth);
    return resolved.auth;
  }

  const requireAuth: RequestHandler = async (req, res, next) => {
    await authenticate(req, res);
    next();
  };

  const requireCustomer: RequestHandler = async (req, res, next) => {
    const auth = await authenticate(req, res);
    if (!canActAsCustomer(auth)) {
      throw forbidden();
    }
    next();
  };

  const requireAdmin: RequestHandler = async (req, res, next) => {
    const auth = await authenticate(req, res);
    if (!canActAsAdmin(auth, config.auth.adminEmails)) {
      throw forbidden();
    }
    next();
  };

  return { requireAuth, requireCustomer, requireAdmin };
}
