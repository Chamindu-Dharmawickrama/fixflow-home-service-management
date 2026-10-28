import { API_PREFIX } from "@fixflow/shared";
import express, { type Express } from "express";

import { healthRouter } from "./modules/health/health.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(`${API_PREFIX}/health`, healthRouter);

  return app;
}
