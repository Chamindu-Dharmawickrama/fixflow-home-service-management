import { API_PREFIX } from "@fixflow/shared";
import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";

import type { AppDeps } from "./deps.js";
import { createHttpLogger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { clientIp, rateLimitByName } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { healthRouter } from "./modules/health/health.routes.js";

/** Largest JSON body accepted; larger requests get `413 PAYLOAD_TOO_LARGE`. */
const JSON_BODY_LIMIT = "100kb";
/** How long a browser may cache a CORS preflight answer. */
const CORS_MAX_AGE_SECONDS = 600;

export interface CreateAppOptions {
  /** Extra routers mounted under the API prefix. For tests only (the harness adds throwaway routes). */
  extraRouters?: readonly Router[];
}

/**
 * Builds the Express app from its dependencies. The middleware order is deliberate:
 * request ID → request logger → helmet → CORS → body parsing → global rate limit → routes →
 * 404 → error handler. See `docs/ARCHITECTURE.md` for why.
 */
export function createApp(deps: AppDeps, options: CreateAppOptions = {}): Express {
  const { config } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(requestId);
  app.use(createHttpLogger(deps.logger));
  app.use(helmet());
  app.use(
    cors({
      // A function (not a string) so that other origins get no CORS headers at all.
      origin: (origin, callback) => {
        callback(null, origin === config.webOrigin);
      },
      credentials: true,
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(rateLimitByName(deps, "global", clientIp));

  app.use(`${API_PREFIX}/health`, healthRouter);
  for (const router of options.extraRouters ?? []) {
    app.use(API_PREFIX, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
