import { Router } from "express";

export const healthRouter: Router = Router();

/** Liveness check. It deliberately does not touch any dependency (D-14). */
healthRouter.get("/", (_req, res) => {
  res.json({ data: { status: "ok" } });
});
