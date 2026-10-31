import { Router } from "express";

import type { AppDeps } from "../../deps.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { getQuotationQuerySchema, quotationIdParamsSchema } from "./quotations.schemas.js";
import { getCustomerQuotation } from "./quotations.service.js";

/**
 * `/api/v1/quotations` (spec §14.3): quotations as the customer sees them (D-41). `GET /:id` returns
 * the customer's shape and nothing internal. The owner may read a quotation once it has been sent;
 * every other customer, and the owner of a draft, gets `404` exactly like an id that does not exist.
 * An admin may read it to see what the customer sees, and a draft only with `?preview=1`. T15 adds
 * the customer's list and their answer.
 */
export function createQuotationsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddleware(deps);

  router.get("/:id", requireAuth);
  router.get(
    "/:id",
    validate({ params: quotationIdParamsSchema, query: getQuotationQuerySchema }),
    async (req, res) => {
      res.json({ data: await getCustomerQuotation(deps, authOf(req), req.params.id, req.query) });
    },
  );

  return router;
}
