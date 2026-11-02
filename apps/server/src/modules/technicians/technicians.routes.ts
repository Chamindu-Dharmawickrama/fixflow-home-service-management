import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  adminTechniciansQuerySchema,
  createTechnicianBodySchema,
  technicianIdParamsSchema,
  updateTechnicianBodySchema,
} from "./technicians.schemas.js";
import {
  activateTechnician,
  createTechnician,
  deactivateTechnician,
  getAdminTechnician,
  listAdminTechnicians,
  listAssignableTechnicians,
  updateTechnician,
} from "./technicians.service.js";

/**
 * `/api/v1/admin/technicians` (FR-060 to FR-062, spec §14): the business's technician resources,
 * who they are, what they have coming up, and who can be given a new job. Technicians cannot sign
 * in, so there is no technician-facing side: every endpoint is admin-only (a customer gets `403`,
 * a visitor `401`).
 */
export function createAdminTechniciansRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireAdmin);

  router.get("/", validate({ query: adminTechniciansQuerySchema }), async (req, res) => {
    res.json(await listAdminTechnicians(deps, req.query));
  });

  // Registered before `/:id`, so "assignable" is never read as an id.
  router.get("/assignable", async (_req, res) => {
    res.json({ data: await listAssignableTechnicians(deps) });
  });

  router.get("/:id", validate({ params: technicianIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminTechnician(deps, req.params.id) });
  });

  // The limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  router.post("/", rateLimitByName(deps, "adminWrite", byAdmin));
  router.post("/", validate({ body: createTechnicianBodySchema }), async (req, res) => {
    res.status(201).json({ data: await createTechnician(deps, authOf(req), req.body) });
  });

  router.patch("/:id", rateLimitByName(deps, "adminWrite", byAdmin));
  router.patch(
    "/:id",
    validate({ params: technicianIdParamsSchema, body: updateTechnicianBodySchema }),
    async (req, res) => {
      res.json({ data: await updateTechnician(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/:id/deactivate", rateLimitByName(deps, "adminWrite", byAdmin));
  router.post(
    "/:id/deactivate",
    validate({ params: technicianIdParamsSchema }),
    async (req, res) => {
      res.json({ data: await deactivateTechnician(deps, authOf(req), req.params.id) });
    },
  );

  router.post("/:id/activate", rateLimitByName(deps, "adminWrite", byAdmin));
  router.post("/:id/activate", validate({ params: technicianIdParamsSchema }), async (req, res) => {
    res.json({ data: await activateTechnician(deps, authOf(req), req.params.id) });
  });

  return router;
}
