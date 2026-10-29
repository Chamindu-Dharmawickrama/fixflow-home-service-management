import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { updateSettingsBodySchema } from "./settings.schemas.js";
import { getAdminSettings, getPublicSettings, updateSettings } from "./settings.service.js";

/** How long a browser or CDN may reuse the public settings; an edit shows up within this time. */
const PUBLIC_SETTINGS_MAX_AGE_SECONDS = 60;

/**
 * The business settings (FR-002, FR-100): `GET /settings/public` for anyone, and
 * `GET`/`PATCH /admin/settings` for the business admin. Mounted on the API prefix because the two
 * audiences live under different paths.
 */
export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.get("/settings/public", async (_req, res) => {
    const settings = await getPublicSettings(deps);
    // The one cacheable API response: it is the same for everyone and changes rarely.
    res.setHeader("Cache-Control", `public, max-age=${PUBLIC_SETTINGS_MAX_AGE_SECONDS}`);
    res.json({ data: settings });
  });

  router.get("/admin/settings", requireAdmin, async (_req, res) => {
    res.json({ data: await getAdminSettings(deps) });
  });

  router.patch(
    "/admin/settings",
    requireAdmin,
    rateLimitByName(deps, "adminWrite", byAdmin),
    validate({ body: updateSettingsBodySchema }),
    async (req, res) => {
      res.json({ data: await updateSettings(deps, authOf(req), req.body) });
    },
  );

  return router;
}
