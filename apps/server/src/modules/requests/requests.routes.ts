import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  createRequestBodySchema,
  listMyRequestsQuerySchema,
  requestIdParamsSchema,
} from "./requests.schemas.js";
import { getRequest, listMyRequests, submitRequest } from "./requests.service.js";

/**
 * `/api/v1/requests` (FR-020 to FR-022, spec §7.1, §14.1): service requests as the customer sees
 * them.
 *
 * - `POST /` submits a request (customers only; an admin gets `403`). `201` when it was created,
 *   `200` when the same `submissionKey` had already created it.
 * - `GET /me` lists the caller's own requests.
 * - `GET /:id` returns one request in the customer's shape. The owner may read it, and so may an
 *   admin (a preview of what the customer sees, D-41); every other customer gets `404`.
 *
 * Whoever the request belongs to comes from the session, never from the body or the path.
 */
export function createRequestsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAuth, requireCustomer } = createAuthMiddleware(deps);
  const byCustomer = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  // The role check and the limit run first, each on its own registration: Express cannot type a
  // validated body in a chain that also holds an untyped handler.
  router.post("/", requireCustomer, rateLimitByName(deps, "requestSubmit", byCustomer));
  router.post("/", validate({ body: createRequestBodySchema }), async (req, res) => {
    const { request, created } = await submitRequest(deps, authOf(req), req.body);
    res.status(created ? 201 : 200).json({ data: request });
  });

  // Registered before `/:id`, so "me" is never read as an id.
  router.get("/me", requireCustomer);
  router.get("/me", validate({ query: listMyRequestsQuerySchema }), async (req, res) => {
    res.json(await listMyRequests(deps, authOf(req), req.query));
  });

  router.get("/:id", requireAuth);
  router.get("/:id", validate({ params: requestIdParamsSchema }), async (req, res) => {
    res.json({ data: await getRequest(deps, authOf(req), req.params.id) });
  });

  return router;
}
