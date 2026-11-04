import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { transitionWorkOrderStatus } from "./work-orders.lifecycle.service.js";
import {
  adminWorkOrdersQuerySchema,
  conflictsQuerySchema,
  quotationIdParamsSchema,
  scheduleWorkOrderBodySchema,
  transitionWorkOrderBodySchema,
  workOrderIdParamsSchema,
} from "./work-orders.schemas.js";
import {
  checkSchedulingConflicts,
  convertToWorkOrder,
  getAdminWorkOrder,
  listAdminWorkOrders,
  scheduleWorkOrder,
} from "./work-orders.service.js";

/**
 * The business's job endpoints (FR-050 to FR-057, spec §14.3), mounted on `/api/v1/admin`:
 *
 * - `POST /quotations/:id/work-order` turns an accepted quotation into a job (`201`, or `200` with the
 *   job that already exists, so repeating it is safe);
 * - `GET /work-orders` lists jobs, `GET /work-orders/:id` reads one with its history;
 * - `GET /work-orders/conflicts` is the read-only pre-check the scheduling dialog runs;
 * - `PATCH /work-orders/:id/schedule` schedules or reschedules a job with a technician;
 * - `POST /work-orders/:id/transitions` starts, completes, cancels or marks a job as needing a new
 *   time (T18), with the notes and reasons each needs. The answer carries `meta.startedBeforeSchedule`.
 *
 * Every endpoint is admin-only (a customer gets `403`, and an admin who has left the allowlist too).
 * The role check is on each route and not on the router, because this router shares the `/admin`
 * prefix with other modules' routers. The customer's own view of a job is `work-orders.customer.routes.ts`.
 */
export function createAdminWorkOrdersRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;
  // Each limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  const write = [requireAdmin, rateLimitByName(deps, "adminWrite", byAdmin)];

  router.post("/quotations/:id/work-order", ...write);
  router.post(
    "/quotations/:id/work-order",
    validate({ params: quotationIdParamsSchema }),
    async (req, res) => {
      const { workOrder, created } = await convertToWorkOrder(deps, authOf(req), req.params.id);
      res.status(created ? 201 : 200).json({ data: workOrder });
    },
  );

  router.get("/work-orders", requireAdmin);
  router.get("/work-orders", validate({ query: adminWorkOrdersQuerySchema }), async (req, res) => {
    res.json(await listAdminWorkOrders(deps, req.query));
  });

  // Registered before `/work-orders/:id`, so "conflicts" is never read as an id.
  router.get("/work-orders/conflicts", requireAdmin);
  router.get(
    "/work-orders/conflicts",
    validate({ query: conflictsQuerySchema }),
    async (req, res) => {
      res.json({ data: await checkSchedulingConflicts(deps, req.query) });
    },
  );

  router.get("/work-orders/:id", requireAdmin);
  router.get(
    "/work-orders/:id",
    validate({ params: workOrderIdParamsSchema }),
    async (req, res) => {
      res.json({ data: await getAdminWorkOrder(deps, req.params.id) });
    },
  );

  router.patch("/work-orders/:id/schedule", ...write);
  router.patch(
    "/work-orders/:id/schedule",
    validate({ params: workOrderIdParamsSchema, body: scheduleWorkOrderBodySchema }),
    async (req, res) => {
      res.json({ data: await scheduleWorkOrder(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/work-orders/:id/transitions", ...write);
  router.post(
    "/work-orders/:id/transitions",
    validate({ params: workOrderIdParamsSchema, body: transitionWorkOrderBodySchema }),
    async (req, res) => {
      const { workOrder, startedBeforeSchedule } = await transitionWorkOrderStatus(
        deps,
        authOf(req),
        req.params.id,
        req.body,
      );
      res.json({ data: workOrder, meta: { startedBeforeSchedule } });
    },
  );

  return router;
}
