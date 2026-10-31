import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { adminRequestIdParamsSchema } from "../requests/requests.admin.schemas.js";
import {
  createQuotationBodySchema,
  quotationIdParamsSchema,
  sendQuotationBodySchema,
  updateQuotationBodySchema,
  voidQuotationBodySchema,
} from "./quotations.schemas.js";
import {
  createQuotation,
  getAdminQuotation,
  sendQuotation,
  updateQuotation,
  voidQuotationByAdmin,
} from "./quotations.service.js";

/**
 * The business's quotation endpoints (FR-040 to FR-047, spec §14.3), mounted on `/api/v1/admin`:
 *
 * - `POST /requests/:id/quotations` starts a draft for a request (optionally replacing a sent one);
 * - `GET /quotations/:id` reads one with its history and the actions allowed now;
 * - `PATCH /quotations/:id` saves a draft (totals are worked out by the server);
 * - `POST /quotations/:id/send` publishes it; `POST /quotations/:id/void` withdraws it.
 *
 * Every endpoint is admin-only (a customer gets `403`, and an admin who has left the allowlist too).
 * The role check is on each route and not on the router, because this router shares the `/admin`
 * prefix with other modules' routers. The customer's view is `GET /api/v1/quotations/:id`.
 */
export function createAdminQuotationsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;
  // Each limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  const write = [requireAdmin, rateLimitByName(deps, "adminWrite", byAdmin)];

  router.post("/requests/:id/quotations", ...write);
  router.post(
    "/requests/:id/quotations",
    validate({ params: adminRequestIdParamsSchema, body: createQuotationBodySchema }),
    async (req, res) => {
      res
        .status(201)
        .json({ data: await createQuotation(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.get("/quotations/:id", requireAdmin);
  router.get("/quotations/:id", validate({ params: quotationIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminQuotation(deps, req.params.id) });
  });

  router.patch("/quotations/:id", ...write);
  router.patch(
    "/quotations/:id",
    validate({ params: quotationIdParamsSchema, body: updateQuotationBodySchema }),
    async (req, res) => {
      res.json({ data: await updateQuotation(deps, req.params.id, req.body) });
    },
  );

  router.post("/quotations/:id/send", ...write);
  router.post(
    "/quotations/:id/send",
    validate({ params: quotationIdParamsSchema, body: sendQuotationBodySchema }),
    async (req, res) => {
      res.json({ data: await sendQuotation(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/quotations/:id/void", ...write);
  router.post(
    "/quotations/:id/void",
    validate({ params: quotationIdParamsSchema, body: voidQuotationBodySchema }),
    async (req, res) => {
      res.json({ data: await voidQuotationByAdmin(deps, authOf(req), req.params.id, req.body) });
    },
  );

  return router;
}
