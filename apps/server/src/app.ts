import { API_PREFIX } from "@fixflow/shared";
import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";

import type { AppDeps } from "./deps.js";
import { createHttpLogger } from "./lib/logger.js";
import { csrfProtection } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { clientIp, rateLimitByName } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createAdminCustomersRouter } from "./modules/customers/customers.admin.routes.js";
import { createCustomersRouter } from "./modules/customers/customers.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { createNotificationsRouter } from "./modules/notifications/notifications.routes.js";
import { createAdminQuotationsRouter } from "./modules/quotations/quotations.admin.routes.js";
import { createQuotationsRouter } from "./modules/quotations/quotations.routes.js";
import { createAdminRequestsRouter } from "./modules/requests/requests.admin.routes.js";
import { createRequestsRouter } from "./modules/requests/requests.routes.js";
import { createServicesRouter } from "./modules/services/services.routes.js";
import { createSettingsRouter } from "./modules/settings/settings.routes.js";
import { createAdminTechniciansRouter } from "./modules/technicians/technicians.routes.js";
import { createAdminWorkOrdersRouter } from "./modules/work-orders/work-orders.routes.js";

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
 * request ID → request logger → helmet → CORS → CSRF → body parsing → global rate limit → routes →
 * 404 → error handler. See `docs/ARCHITECTURE.md` for why.
 */
export function createApp(deps: AppDeps, options: CreateAppOptions = {}): Express {
  const { config } = deps;
  const app = express();

  app.disable("x-powered-by");
  // No ETag: a validator would let a cache or proxy reuse one session's response for another.
  app.set("etag", false);
  app.set("trust proxy", config.trustProxy);

  app.use(requestId);
  app.use(createHttpLogger(deps.logger));
  app.use(helmet());
  // API responses are dynamic and often private (the signed-in user, their records): never cached.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
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
  // Before the body is read: a forged cross-site request costs nothing but the 403.
  app.use(csrfProtection(config));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(rateLimitByName(deps, "global", clientIp));

  app.use(`${API_PREFIX}/health`, createHealthRouter(deps));
  app.use(`${API_PREFIX}/auth`, createAuthRouter(deps));
  app.use(`${API_PREFIX}/customers`, createCustomersRouter(deps));
  app.use(`${API_PREFIX}/notifications`, createNotificationsRouter(deps));
  app.use(`${API_PREFIX}/requests`, createRequestsRouter(deps));
  app.use(`${API_PREFIX}/admin/requests`, createAdminRequestsRouter(deps));
  app.use(`${API_PREFIX}/admin/customers`, createAdminCustomersRouter(deps));
  app.use(`${API_PREFIX}/admin/technicians`, createAdminTechniciansRouter(deps));
  app.use(`${API_PREFIX}/quotations`, createQuotationsRouter(deps));
  // Mounted on `/admin` itself: it serves `/admin/requests/:id/quotations` and `/admin/quotations/...`
  // and puts the role check on each route, so it never answers for another module's `/admin/...` paths.
  app.use(`${API_PREFIX}/admin`, createAdminQuotationsRouter(deps));
  // The same for jobs: `/admin/quotations/:id/work-order` and `/admin/work-orders/...`, role-checked per route.
  app.use(`${API_PREFIX}/admin`, createAdminWorkOrdersRouter(deps));
  // These two serve both the public and the admin paths of their module (`/settings/public` and
  // `/admin/settings`, `/services` and `/admin/services`), so they are mounted on the prefix itself.
  app.use(API_PREFIX, createSettingsRouter(deps));
  app.use(API_PREFIX, createServicesRouter(deps));
  for (const router of options.extraRouters ?? []) {
    app.use(API_PREFIX, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
