import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { type RequestHandler, type Response, Router } from "express";

import type { AppDeps } from "../../deps.js";
import { rateLimitByName } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { authOf, createAuthMiddleware } from "../auth/auth.middleware.js";
import { adminInvoicesQuerySchema } from "../invoices/invoices.schemas.js";
import { adminRequestsQuerySchema } from "../requests/requests.admin.schemas.js";
import { adminWorkOrdersQuerySchema } from "../work-orders/work-orders.schemas.js";
import { type CsvExport, exportInvoices, exportJobs, exportRequests } from "./exports.service.js";

/**
 * Sends a CSV as a download, streamed: the headers go out with the first chunk, and the rest follows
 * as it is read. A failure after that point cannot become an error response (the status is sent), so
 * the connection is cut, which a browser shows as a failed download; the error is logged.
 */
async function sendCsv(deps: AppDeps, res: Response, file: CsvExport): Promise<void> {
  res.status(200).set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  try {
    await pipeline(Readable.from(file.chunks, { objectMode: false }), res);
  } catch (error) {
    // A closed connection (the person cancelled the download) is not an error worth a log line.
    if ((error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      deps.logger.error({ err: error }, "A CSV export failed after it had started");
    }
  }
}

/**
 * `/api/v1/admin/exports` (FR-084, spec §14): CSV files of the requests, jobs and invoices the matching
 * list would show, for the same filters. Admin-only, rate-limited per admin, streamed. The query is the
 * list's own (so a screen passes its filters straight through); the page and its size are accepted and
 * ignored, because an export is the whole list.
 */
export function createAdminExportsRouter(deps: AppDeps): Router {
  const router = Router();
  const { requireAdmin } = createAuthMiddleware(deps);
  const byAdmin = (req: Parameters<RequestHandler>[0]) => authOf(req).userId;

  router.use(requireAdmin);
  router.use(rateLimitByName(deps, "adminExport", byAdmin));

  router.get("/requests.csv", validate({ query: adminRequestsQuerySchema }), async (req, res) => {
    await sendCsv(deps, res, await exportRequests(deps, req.query));
  });

  router.get("/jobs.csv", validate({ query: adminWorkOrdersQuerySchema }), async (req, res) => {
    await sendCsv(deps, res, await exportJobs(deps, req.query));
  });

  router.get("/invoices.csv", validate({ query: adminInvoicesQuerySchema }), async (req, res) => {
    await sendCsv(deps, res, await exportInvoices(deps, req.query));
  });

  return router;
}
