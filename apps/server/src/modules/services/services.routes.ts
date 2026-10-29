import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  adminServicesQuerySchema,
  createServiceBodySchema,
  lifecycleBodySchema,
  publicServicesQuerySchema,
  serviceIdParamsSchema,
  serviceSlugParamsSchema,
  updateServiceBodySchema,
} from "./services.schemas.js";
import {
  createService,
  getAdminService,
  getPublicService,
  listAdminServices,
  listPublicServices,
  transitionService,
  updateService,
} from "./services.service.js";

/**
 * The service catalogue (FR-006, FR-101).
 *
 * - `GET /services`, `/services/slug/:slug`, `/services/:id`: public, active services only.
 * - `/admin/services...`: the business admin's full view and the changes: create, edit (including
 *   publishing), archive and restore.
 *
 * Mounted on the API prefix because the two audiences live under different paths.
 */
export function createServicesRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  // ---- Public ---------------------------------------------------------------------------------

  router.get("/services", validate({ query: publicServicesQuerySchema }), async (req, res) => {
    res.json({ data: await listPublicServices(deps, req.query) });
  });

  // Registered before `/services/:id`, so "slug" is never read as an id.
  router.get(
    "/services/slug/:slug",
    validate({ params: serviceSlugParamsSchema }),
    async (req, res) => {
      res.json({ data: await getPublicService(deps, { slug: req.params.slug }) });
    },
  );

  router.get("/services/:id", validate({ params: serviceIdParamsSchema }), async (req, res) => {
    res.json({ data: await getPublicService(deps, { id: req.params.id }) });
  });

  // ---- Admin ----------------------------------------------------------------------------------

  const admin = Router();
  admin.use(requireAdmin);

  admin.get("/", validate({ query: adminServicesQuerySchema }), async (req, res) => {
    res.json(await listAdminServices(deps, req.query));
  });

  admin.get("/:id", validate({ params: serviceIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminService(deps, req.params.id) });
  });

  // The limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  admin.post("/", rateLimitByName(deps, "adminWrite", byAdmin));
  admin.post("/", validate({ body: createServiceBodySchema }), async (req, res) => {
    res.status(201).json({ data: await createService(deps, authOf(req), req.body) });
  });

  admin.patch("/:id", rateLimitByName(deps, "adminWrite", byAdmin));
  admin.patch(
    "/:id",
    validate({ params: serviceIdParamsSchema, body: updateServiceBodySchema }),
    async (req, res) => {
      res.json({ data: await updateService(deps, authOf(req), req.params.id, req.body) });
    },
  );

  for (const action of ["archive", "restore"] as const) {
    admin.post(`/:id/${action}`, rateLimitByName(deps, "adminWrite", byAdmin));
    admin.post(
      `/:id/${action}`,
      validate({ params: serviceIdParamsSchema, body: lifecycleBodySchema }),
      async (req, res) => {
        const service = await transitionService(
          deps,
          authOf(req),
          req.params.id,
          action === "archive" ? "ARCHIVE" : "RESTORE",
          req.body.expectedStatus,
        );
        res.json({ data: service });
      },
    );
  }

  router.use("/admin/services", admin);

  return router;
}
