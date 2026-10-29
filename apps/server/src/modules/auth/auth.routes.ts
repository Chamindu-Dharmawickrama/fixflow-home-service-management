import { ErrorCode } from "@fixflow/shared";
import { type Request, type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { AppError } from "../../lib/errors.js";
import { clientIp, rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./auth.cookie.js";
import { emailKeyPart } from "./auth.domain.js";
import { authOf, createAuthMiddleware } from "./auth.middleware.js";
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  googleBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "./auth.schemas.js";
import {
  changePassword,
  getCurrentUser,
  loginWithPassword,
  registerCustomer,
  requestPasswordReset,
  resetPassword,
  signInWithGoogle,
  signOut,
} from "./auth.service.js";

/** The rate-limit key for the email in an already-validated request body. */
function bodyEmailKey(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return emailKeyPart(typeof email === "string" ? email : "");
}

/**
 * `/api/v1/auth/*` (FR-010 to FR-015, D-07 to D-11, D-51). Identity comes from the session cookie
 * alone; every body schema is strict, so a client cannot name its own role or user id.
 */
export function createAuthRouter(deps: AppDeps): Router {
  const { config, clock } = deps;
  const router = Router();
  const { requireAuth } = createAuthMiddleware(deps);

  /** Starts a session: puts the cookie on the response, replacing any session this browser had. */
  const startSession = async (
    req: Request,
    res: Parameters<RequestHandler>[1],
    session: { token: string; expiresAt: Date },
  ): Promise<void> => {
    await signOut(deps, readSessionToken(req, config));
    setSessionCookie(res, config, session.token, session.expiresAt, clock.now());
  };

  const signupGate: RequestHandler = (_req, _res, next) => {
    next(
      config.auth.publicSignupEnabled
        ? undefined
        : new AppError(
            403,
            ErrorCode.SIGNUP_DISABLED,
            "New accounts can't be created right now. Please contact the business.",
          ),
    );
  };

  router.post(
    "/register",
    rateLimitByName(deps, "register", clientIp),
    signupGate,
    validate({ body: registerBodySchema }),
    async (req, res) => {
      const { user, session } = await registerCustomer(deps, req.body);
      await startSession(req, res, session);
      res.status(201).json({ data: { user } });
    },
  );

  router.post(
    "/login",
    rateLimitByName(deps, "login", clientIp),
    validate({ body: loginBodySchema }),
    async (req, res) => {
      const { user, session } = await loginWithPassword(deps, req.body, { ip: clientIp(req) });
      await startSession(req, res, session);
      res.json({ data: { user } });
    },
  );

  router.post(
    "/google",
    rateLimitByName(deps, "google", clientIp),
    validate({ body: googleBodySchema }),
    async (req, res) => {
      const { user, session, isNewUser } = await signInWithGoogle(deps, req.body.credential);
      await startSession(req, res, session);
      res.json({ data: { user, isNewUser } });
    },
  );

  router.post(
    "/password/forgot",
    rateLimitByName(deps, "forgotIp", clientIp),
    validate({ body: forgotPasswordBodySchema }),
    rateLimitByName(deps, "forgotEmail", bodyEmailKey),
    async (req, res) => {
      res.json({ data: await requestPasswordReset(deps, req.body.email) });
    },
  );

  router.post(
    "/password/reset",
    rateLimitByName(deps, "reset", clientIp),
    validate({ body: resetPasswordBodySchema }),
    async (req, res) => {
      await resetPassword(deps, req.body);
      // Every session of the account was revoked; drop this browser's cookie too.
      clearSessionCookie(res, config);
      res.json({ data: { passwordReset: true } });
    },
  );

  router.post(
    "/password/change",
    requireAuth,
    rateLimitByName(deps, "passwordChange", (req) => authOf(req).userId),
    validate({ body: changePasswordBodySchema }),
    async (req, res) => {
      await changePassword(deps, authOf(req), req.body);
      res.json({ data: { passwordChanged: true } });
    },
  );

  router.post("/logout", rateLimitByName(deps, "logout", clientIp), async (req, res) => {
    await signOut(deps, readSessionToken(req, config));
    clearSessionCookie(res, config);
    res.json({ data: { signedOut: true } });
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json({ data: await getCurrentUser(deps, authOf(req)) });
  });

  return router;
}
