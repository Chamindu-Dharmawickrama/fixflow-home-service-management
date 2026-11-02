import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  acceptQuotation,
  declineQuotation,
  listMyQuotations,
} from "./quotations.decision.service.js";
import {
  acceptQuotationBodySchema,
  declineQuotationBodySchema,
  getQuotationQuerySchema,
  listMyQuotationsQuerySchema,
  quotationIdParamsSchema,
} from "./quotations.schemas.js";
import { getCustomerQuotation } from "./quotations.service.js";

/**
 * `/api/v1/quotations` (spec §14.3): quotations as the customer sees them (D-41).
 *
 * - `GET /me` lists the customer's quotations (never a draft), the ones awaiting an answer first.
 * - `GET /:id` returns the customer's shape and nothing internal. The owner may read a quotation
 *   once it has been sent; every other customer, and the owner of a draft, gets `404` exactly like an
 *   id that does not exist. An admin may read it to see what the customer sees, and a draft only with
 *   `?preview=1`.
 * - `POST /:id/accept` and `POST /:id/decline` record the customer's answer (T15). Customers only: an
 *   admin gets `403`. Each is rate-limited per customer, and refused with `409` unless the quotation
 *   is sent and in date.
 *
 * Whose quotation it is comes from the session, never from the path.
 */
export function createQuotationsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAuth, requireCustomer } = createAuthMiddleware(deps);
  const byCustomer = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  // Registered before `/:id`, so "me" is never read as an id.
  router.get("/me", requireCustomer);
  router.get("/me", validate({ query: listMyQuotationsQuerySchema }), async (req, res) => {
    res.json(await listMyQuotations(deps, authOf(req), req.query));
  });

  router.get("/:id", requireAuth);
  router.get(
    "/:id",
    validate({ params: quotationIdParamsSchema, query: getQuotationQuerySchema }),
    async (req, res) => {
      res.json({ data: await getCustomerQuotation(deps, authOf(req), req.params.id, req.query) });
    },
  );

  // The role check and the limit run first, each on its own registration (as for a request's
  // submission): Express cannot type a validated body in a chain that also holds an untyped handler.
  router.post(
    "/:id/accept",
    requireCustomer,
    rateLimitByName(deps, "quotationDecision", byCustomer),
  );
  router.post(
    "/:id/accept",
    validate({ params: quotationIdParamsSchema, body: acceptQuotationBodySchema }),
    async (req, res) => {
      res.json({ data: await acceptQuotation(deps, authOf(req), req.params.id) });
    },
  );

  router.post(
    "/:id/decline",
    requireCustomer,
    rateLimitByName(deps, "quotationDecision", byCustomer),
  );
  router.post(
    "/:id/decline",
    validate({ params: quotationIdParamsSchema, body: declineQuotationBodySchema }),
    async (req, res) => {
      res.json({ data: await declineQuotation(deps, authOf(req), req.params.id, req.body) });
    },
  );

  return router;
}
