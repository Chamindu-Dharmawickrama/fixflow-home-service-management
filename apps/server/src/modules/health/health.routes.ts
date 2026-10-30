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

  // T09-DEBUG (temporary, removed after the client-IP check in docs/DEPLOYMENT.md): echoes what the
  // API sees of the caller's address behind Vercel and Render.
  router.get("/__debug-ip", (req, res) => {
    const header = (name: string) => req.get(name) ?? null;
    res.json({
      data: {
        trustProxy: deps.config.trustProxy,
        ip: req.ip ?? null,
        ips: req.ips,
        socket: req.socket.remoteAddress ?? null,
        xForwardedFor: header("x-forwarded-for"),
        xRealIp: header("x-real-ip"),
        xVercelForwardedFor: header("x-vercel-forwarded-for"),
        forwarded: header("forwarded"),
        cfConnectingIp: header("cf-connecting-ip"),
        trueClientIp: header("true-client-ip"),
        origin: header("origin"),
      },
    });
  });

  return router;
}
