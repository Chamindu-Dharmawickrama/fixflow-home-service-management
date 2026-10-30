import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  addRequestNoteBodySchema,
  adminRequestIdParamsSchema,
  adminRequestsQuerySchema,
  changeRequestStatusBodySchema,
} from "./requests.admin.schemas.js";
import {
  addRequestNote,
  changeRequestStatus,
  getAdminRequest,
  listAdminRequests,
} from "./requests.admin.service.js";

/**
 * `/api/v1/admin/requests` (FR-023 to FR-026, spec §14.2): the business's request queue, a request
 * in full, its status changes and its notes. Every endpoint is admin-only (a customer gets `403`,
 * and an admin who has left the allowlist too). These answer with the admin shapes, which carry the
 * customer's contact details, internal notes and reasons; the customer's own endpoints
 * (`/requests`, `requests.routes.ts`) never do.
 */
export function createAdminRequestsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireAdmin);

  router.get("/", validate({ query: adminRequestsQuerySchema }), async (req, res) => {
    res.json(await listAdminRequests(deps, req.query));
  });

  router.get("/:id", validate({ params: adminRequestIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminRequest(deps, req.params.id) });
  });

  // Each limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  router.patch("/:id/status", rateLimitByName(deps, "adminWrite", byAdmin));
  router.patch(
    "/:id/status",
    validate({ params: adminRequestIdParamsSchema, body: changeRequestStatusBodySchema }),
    async (req, res) => {
      res.json({ data: await changeRequestStatus(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/:id/notes", rateLimitByName(deps, "adminWrite", byAdmin));
  router.post(
    "/:id/notes",
    validate({ params: adminRequestIdParamsSchema, body: addRequestNoteBodySchema }),
    async (req, res) => {
      res
        .status(201)
        .json({ data: await addRequestNote(deps, authOf(req), req.params.id, req.body) });
    },
  );

  return router;
}
