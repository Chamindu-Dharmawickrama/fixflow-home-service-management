import { Router } from "express";

import type { AppDeps } from "../../deps.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { getCustomerWorkOrder, listMyWorkOrders } from "./work-orders.customer.service.js";
import { listMyWorkOrdersQuerySchema, workOrderIdParamsSchema } from "./work-orders.schemas.js";

/**
 * `/api/v1/work-orders` (FR-056, spec §14.3): jobs as the customer sees them (D-41).
 *
 * - `GET /me` lists the customer's own jobs, the ones with something still to happen first.
 * - `GET /:id` returns the customer's shape and nothing internal. The owner may read it, and so may an
 *   admin (a preview of what the customer sees); every other customer gets `404` exactly like an id
 *   that does not exist.
 *
 * Whose job it is comes from the session, never from the path. The business's own endpoints are
 * under `/api/v1/admin/work-orders`.
 */
export function createWorkOrdersRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAuth, requireCustomer } = createAuthMiddleware(deps);

  // Registered before `/:id`, so "me" is never read as an id.
  router.get("/me", requireCustomer);
  router.get("/me", validate({ query: listMyWorkOrdersQuerySchema }), async (req, res) => {
    res.json(await listMyWorkOrders(deps, authOf(req), req.query));
  });

  router.get("/:id", requireAuth);
  router.get("/:id", validate({ params: workOrderIdParamsSchema }), async (req, res) => {
    res.json({ data: await getCustomerWorkOrder(deps, authOf(req), req.params.id) });
  });

  return router;
}
