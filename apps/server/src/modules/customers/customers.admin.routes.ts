import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  addCustomerNoteBodySchema,
  adminCustomerIdParamsSchema,
  adminCustomersQuerySchema,
  customerHistoryQuerySchema,
} from "./customers.admin.schemas.js";
import {
  addCustomerNote,
  getAdminCustomer,
  listAdminCustomers,
  listCustomerHistory,
} from "./customers.admin.service.js";

/**
 * `/api/v1/admin/customers` (FR-031, FR-033, spec §14.2): the business's directory of customers, a
 * customer in full, their history record by record, and the team's private notes about them. Every
 * endpoint is admin-only (a customer gets `403`, and an admin who has left the allowlist too). These
 * answer with the admin shapes, which carry the whole history, the balance and the internal notes;
 * the customer's own endpoints (`/customers/me`, `customers.routes.ts`) never do.
 */
export function createAdminCustomersRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireAdmin);

  router.get("/", validate({ query: adminCustomersQuerySchema }), async (req, res) => {
    res.json(await listAdminCustomers(deps, req.query));
  });

  router.get("/:id", validate({ params: adminCustomerIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminCustomer(deps, req.params.id) });
  });

  router.get(
    "/:id/history",
    validate({ params: adminCustomerIdParamsSchema, query: customerHistoryQuerySchema }),
    async (req, res) => {
      res.json(await listCustomerHistory(deps, req.params.id, req.query));
    },
  );

  // The limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  router.post("/:id/notes", rateLimitByName(deps, "adminWrite", byAdmin));
  router.post(
    "/:id/notes",
    validate({ params: adminCustomerIdParamsSchema, body: addCustomerNoteBodySchema }),
    async (req, res) => {
      res
        .status(201)
        .json({ data: await addCustomerNote(deps, authOf(req), req.params.id, req.body) });
    },
  );

  return router;
}
