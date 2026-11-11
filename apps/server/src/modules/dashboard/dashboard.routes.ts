import { Router } from "express";

import type { AppDeps } from "../../deps.js";
import { validate } from "../../middleware/validate.js";
import { createAuthMiddleware } from "../auth/auth.middleware.js";
import { dashboardSummaryQuerySchema } from "./dashboard.schemas.js";
import { getDashboardSummary } from "./dashboard.service.js";

/**
 * `/api/v1/admin/dashboard` (FR-080 to FR-085, spec §9.2): the business's operational overview.
 * Admin-only (a customer gets `403`, and an admin who has left the allowlist too). It is read-only,
 * so it has no write limit; the global per-IP limit applies as everywhere.
 */
export function createAdminDashboardRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);

  router.use(requireAdmin);

  router.get("/summary", validate({ query: dashboardSummaryQuerySchema }), async (req, res) => {
    res.json({ data: await getDashboardSummary(deps, req.query) });
  });

  return router;
}
