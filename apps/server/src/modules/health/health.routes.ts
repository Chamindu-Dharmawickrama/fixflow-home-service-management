import { Router } from "express";

import type { AppDeps } from "../../deps.js";
import { serviceUnavailable } from "../../lib/errors.js";
import { isDatabaseReady } from "./health.service.js";

/**
 * - `GET /` is the liveness check. It deliberately does not touch any dependency (D-14), so a
 *   database outage cannot make the platform restart a healthy API, and Render's health check
 *   does not keep Neon's compute awake.
 * - `GET /ready` is the readiness check for diagnostics: `200` when the database answers a
 *   trivial query, `503` otherwise.
 */
export function createHealthRouter(deps: AppDeps): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  router.get("/ready", async (_req, res) => {
    if (!(await isDatabaseReady(deps.prisma, deps.logger))) {
      throw serviceUnavailable("The service is not ready to handle requests.", {
        details: { database: "unreachable" },
      });
    }
    res.json({ data: { status: "ready" } });
  });

  return router;
}
