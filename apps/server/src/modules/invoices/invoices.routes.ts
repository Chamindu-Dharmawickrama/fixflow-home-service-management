import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import {
  adminInvoicesQuerySchema,
  createInvoiceBodySchema,
  invoiceIdParamsSchema,
  issueInvoiceBodySchema,
  updateInvoiceBodySchema,
  voidInvoiceBodySchema,
  workOrderIdParamsSchema,
} from "./invoices.schemas.js";
import {
  createInvoiceForWorkOrder,
  getAdminInvoice,
  issueInvoice,
  listAdminInvoices,
  updateInvoice,
  voidInvoiceByAdmin,
} from "./invoices.service.js";
import {
  paymentParamsSchema,
  recordPaymentBodySchema,
  voidPaymentBodySchema,
} from "./payments.schemas.js";
import { recordPayment, voidPayment } from "./payments.service.js";

/**
 * The business's invoice endpoints (FR-070, FR-071, FR-074, FR-076, FR-077, spec §14.4), mounted on
 * `/api/v1/admin`:
 *
 * - `POST /work-orders/:id/invoice` starts a draft for a completed job;
 * - `GET /invoices` lists them (filters, sort, pages, chip counts);
 * - `GET /invoices/:id` reads one with its history and the actions allowed now;
 * - `PATCH /invoices/:id` saves a draft (totals are worked out by the server);
 * - `POST /invoices/:id/issue` gives it its number and locks it; `POST /invoices/:id/void` withdraws it;
 * - `POST /invoices/:id/payments` records money received outside FixFlow (D-27, T21);
 * - `POST /invoices/:id/payments/:paymentId/void` voids a recorded payment with a reason.
 *
 * There is no `DELETE` and no `PATCH` of a payment: an invoice or a payment that exists stays in the
 * history, and a correction is a void plus a new record (BR-16). Every endpoint is
 * admin-only (a customer gets `403`). The role check is on each route and not on the router, because
 * this router shares the `/admin` prefix with other modules' routers.
 */
export function createAdminInvoicesRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;
  // Each limit runs first, on its own registration: Express cannot type a validated body in a chain
  // that also holds an untyped handler.
  const write = [requireAdmin, rateLimitByName(deps, "adminWrite", byAdmin)];

  router.post("/work-orders/:id/invoice", ...write);
  router.post(
    "/work-orders/:id/invoice",
    validate({ params: workOrderIdParamsSchema, body: createInvoiceBodySchema }),
    async (req, res) => {
      res
        .status(201)
        .json({ data: await createInvoiceForWorkOrder(deps, authOf(req), req.params.id) });
    },
  );

  router.get("/invoices", requireAdmin);
  router.get("/invoices", validate({ query: adminInvoicesQuerySchema }), async (req, res) => {
    res.json(await listAdminInvoices(deps, req.query));
  });

  router.get("/invoices/:id", requireAdmin);
  router.get("/invoices/:id", validate({ params: invoiceIdParamsSchema }), async (req, res) => {
    res.json({ data: await getAdminInvoice(deps, req.params.id) });
  });

  router.patch("/invoices/:id", ...write);
  router.patch(
    "/invoices/:id",
    validate({ params: invoiceIdParamsSchema, body: updateInvoiceBodySchema }),
    async (req, res) => {
      res.json({ data: await updateInvoice(deps, req.params.id, req.body) });
    },
  );

  router.post("/invoices/:id/issue", ...write);
  router.post(
    "/invoices/:id/issue",
    validate({ params: invoiceIdParamsSchema, body: issueInvoiceBodySchema }),
    async (req, res) => {
      res.json({ data: await issueInvoice(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/invoices/:id/void", ...write);
  router.post(
    "/invoices/:id/void",
    validate({ params: invoiceIdParamsSchema, body: voidInvoiceBodySchema }),
    async (req, res) => {
      res.json({ data: await voidInvoiceByAdmin(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/invoices/:id/payments", ...write);
  router.post(
    "/invoices/:id/payments",
    validate({ params: invoiceIdParamsSchema, body: recordPaymentBodySchema }),
    async (req, res) => {
      res
        .status(201)
        .json({ data: await recordPayment(deps, authOf(req), req.params.id, req.body) });
    },
  );

  router.post("/invoices/:id/payments/:paymentId/void", ...write);
  router.post(
    "/invoices/:id/payments/:paymentId/void",
    validate({ params: paymentParamsSchema, body: voidPaymentBodySchema }),
    async (req, res) => {
      res.json({
        data: await voidPayment(deps, authOf(req), req.params.id, req.params.paymentId, req.body),
      });
    },
  );

  return router;
}
