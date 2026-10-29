import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { forbidden } from "../../lib/errors.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { canActAsAdmin, canActAsCustomer } from "../auth/auth.domain.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from "./notifications.schemas.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service.js";

/**
 * `/api/v1/notifications/*` (FR-091, spec §14.4, D-40). Every endpoint works on the caller's own
 * notifications, found through the session: there is no way to name another user's.
 */
export function createNotificationsRouter(deps: AppDeps): Router {
  const { config } = deps;
  const router = Router();
  const { requireAuth } = createAuthMiddleware(deps);

  /**
   * Both roles may read their notifications, but an admin who has been removed from the allowlist
   * is treated as having no access (D-71), so they cannot read what was sent to admins.
   */
  const requireNotificationAccess: RequestHandler = (req, _res, next) => {
    const auth = authOf(req);
    next(
      canActAsAdmin(auth, config.auth.adminEmails) || canActAsCustomer(auth)
        ? undefined
        : forbidden(),
    );
  };

  const byUser = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireAuth, requireNotificationAccess);

  // Registered on its own: Express cannot type a validated `req.query` in a chain that also holds
  // an untyped handler, so the limit runs first and the validated route follows.
  router.get("/me", rateLimitByName(deps, "notificationsRead", byUser));
  router.get("/me", validate({ query: listNotificationsQuerySchema }), async (req, res) => {
    res.json(await listNotifications(deps, authOf(req).userId, req.query));
  });

  router.post(
    "/me/read-all",
    rateLimitByName(deps, "notificationsWrite", byUser),
    async (req, res) => {
      res.json({ data: await markAllNotificationsRead(deps, authOf(req).userId) });
    },
  );

  router.patch(
    "/:id/read",
    rateLimitByName(deps, "notificationsWrite", byUser),
    validate({ params: notificationIdParamsSchema }),
    async (req, res) => {
      res.json({ data: await markNotificationRead(deps, authOf(req).userId, req.params.id) });
    },
  );

  return router;
}
