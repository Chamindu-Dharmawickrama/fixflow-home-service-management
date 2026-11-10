import { type RequestHandler, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { getCustomerInvoice, listMyInvoices } from "./invoices.customer.service.js";
import { getInvoicePdf } from "./invoices.pdf.service.js";
import {
  invoiceIdParamsSchema,
  invoicePdfQuerySchema,
  listMyInvoicesQuerySchema,
} from "./invoices.schemas.js";

/**
 * `/api/v1/invoices` (spec §14.4): invoices as the customer sees them (D-41), and the invoice PDF.
 *
 * - `GET /me` lists the signed-in customer's invoices (never a draft), newest first.
 * - `GET /:id` returns the customer's shape and nothing internal. The owner may read an invoice once it
 *   was issued; every other customer, and the owner of a draft, gets `404` exactly like an id that
 *   does not exist. An admin may read an issued invoice to see what the customer sees.
 * - `GET /:id/pdf` streams the PDF to the same two callers (an admin may also download a draft, which
 *   comes back watermarked). Authorization comes first and no PDF work is done for anyone refused.
 *   Rate-limited per user.
 *
 * Whose invoice it is comes from the session, never from the path. The business's own endpoints are
 * under `/admin/invoices` (`invoices.routes.ts`).
 */
export function createInvoicesRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAuth, requireCustomer } = createAuthMiddleware(deps);
  const byUser = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  // Registered before `/:id`, so "me" is never read as an id.
  router.get("/me", requireCustomer);
  router.get("/me", validate({ query: listMyInvoicesQuerySchema }), async (req, res) => {
    res.json(await listMyInvoices(deps, authOf(req), req.query));
  });

  router.get("/:id", requireAuth);
  router.get("/:id", validate({ params: invoiceIdParamsSchema }), async (req, res) => {
    res.json({ data: await getCustomerInvoice(deps, authOf(req), req.params.id) });
  });

  router.get("/:id/pdf", requireAuth, rateLimitByName(deps, "invoicePdf", byUser));
  router.get(
    "/:id/pdf",
    validate({ params: invoiceIdParamsSchema, query: invoicePdfQuerySchema }),
    async (req, res) => {
      // Nothing is sent until the whole file exists, so a failure is a plain `500` with no PDF headers.
      const { buffer, filename } = await getInvoicePdf(deps, authOf(req), req.params.id);
      res
        .status(200)
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `${req.query.inline ? "inline" : "attachment"}; filename="${filename}"`,
          "Content-Length": String(buffer.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .end(buffer);
    },
  );

  return router;
}
