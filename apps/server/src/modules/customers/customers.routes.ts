import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  addressIdParamsSchema,
  createAddressBodySchema,
  updateAddressBodySchema,
  updateProfileBodySchema,
} from "./customers.schemas.js";
import {
  createAddress,
  deleteAddress,
  getMyProfile,
  listMyAddresses,
  setDefaultAddress,
  updateAddress,
  updateMyProfile,
} from "./customers.service.js";

/**
 * `/api/v1/customers/me*` (FR-013, FR-014, FR-030, spec §14.1): the signed-in customer's own profile
 * and service addresses. Every endpoint works on the caller's own records, found through the
 * session; there is no way to name another customer's. An admin has no customer profile, so every
 * endpoint answers an admin `403`. The admin's view of customers is a separate module (T13).
 */
export function createCustomersRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireCustomer } = createAuthMiddleware(deps);
  const byCustomer = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireCustomer);

  router.get("/me", async (req, res) => {
    res.json({ data: await getMyProfile(deps, authOf(req)) });
  });

  // Each limit runs first, on its own registration: Express cannot type a validated body in a
  // chain that also holds an untyped handler.
  router.patch("/me", rateLimitByName(deps, "customerWrite", byCustomer));
  router.patch("/me", validate({ body: updateProfileBodySchema }), async (req, res) => {
    res.json({ data: await updateMyProfile(deps, authOf(req), req.body) });
  });

  router.get("/me/addresses", async (req, res) => {
    res.json({ data: await listMyAddresses(deps, authOf(req)) });
  });

  router.post("/me/addresses", rateLimitByName(deps, "customerWrite", byCustomer));
  router.post("/me/addresses", validate({ body: createAddressBodySchema }), async (req, res) => {
    res.status(201).json({ data: await createAddress(deps, authOf(req), req.body) });
  });

  router.patch("/me/addresses/:id", rateLimitByName(deps, "customerWrite", byCustomer));
  router.patch(
    "/me/addresses/:id",
    validate({ params: addressIdParamsSchema, body: updateAddressBodySchema }),
    async (req, res) => {
      res.json({ data: await updateAddress(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.delete("/me/addresses/:id", rateLimitByName(deps, "customerWrite", byCustomer));
  router.delete(
    "/me/addresses/:id",
    validate({ params: addressIdParamsSchema }),
    async (req, res) => {
      res.json({ data: await deleteAddress(deps, authOf(req), req.params.id) });
    },
  );

  router.post("/me/addresses/:id/default", rateLimitByName(deps, "customerWrite", byCustomer));
  router.post(
    "/me/addresses/:id/default",
    validate({ params: addressIdParamsSchema }),
    async (req, res) => {
      res.json({ data: await setDefaultAddress(deps, authOf(req), req.params.id) });
    },
  );

  return router;
}
