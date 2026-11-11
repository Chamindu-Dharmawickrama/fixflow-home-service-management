import {
  CUSTOMER_OVERVIEW_LIMITS,
  type CustomerOverviewDto,
  OUTSTANDING_INVOICE_STATUSES,
  QuotationStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { AuthContext } from "../auth/auth.types.js";
import { listMyInvoices } from "../invoices/invoices.customer.service.js";
import { listMyInvoicesQuerySchema } from "../invoices/invoices.schemas.js";
import { listMyQuotations } from "../quotations/quotations.decision.service.js";
import { listMyQuotationsQuerySchema } from "../quotations/quotations.schemas.js";
import { listMyRequestsQuerySchema } from "../requests/requests.schemas.js";
import { listMyRequests } from "../requests/requests.service.js";
import { listMyWorkOrders } from "../work-orders/work-orders.customer.service.js";
import { listMyWorkOrdersQuerySchema } from "../work-orders/work-orders.schemas.js";

type OverviewDeps = Pick<AppDeps, "prisma" | "clock">;

/**
 * `GET /customers/me/overview` (spec §9.3, FR-014): what the signed-in customer has to do and what is
 * coming, in one call. It is composed from the customer's own list functions, each of which finds the
 * customer through the session and reads only their records, so no id from the request is involved
 * and every row is already in the customer's shape (D-41). Expired quotations and overdue invoices
 * are saved first by those functions (D-23).
 */
export async function getMyOverview(
  deps: OverviewDeps,
  auth: AuthContext,
): Promise<CustomerOverviewDto> {
  // The schemas read a query string, so the limits are written as one: the defaults of the real
  // endpoints (their sorts and orders) apply, and this cannot drift from them.
  const [quotations, invoices, visits, requests] = await Promise.all([
    listMyQuotations(
      deps,
      auth,
      listMyQuotationsQuerySchema.parse({
        status: QuotationStatus.SENT,
        pageSize: String(CUSTOMER_OVERVIEW_LIMITS.awaitingDecision),
      }),
    ),
    listMyInvoices(
      deps,
      auth,
      listMyInvoicesQuerySchema.parse({
        status: OUTSTANDING_INVOICE_STATUSES.join(","),
        sort: "dueDate",
        order: "asc",
        pageSize: String(CUSTOMER_OVERVIEW_LIMITS.outstandingInvoices),
      }),
    ),
    listMyWorkOrders(
      deps,
      auth,
      listMyWorkOrdersQuerySchema.parse({
        group: "upcoming",
        pageSize: String(CUSTOMER_OVERVIEW_LIMITS.upcomingVisits),
      }),
    ),
    listMyRequests(
      deps,
      auth,
      listMyRequestsQuerySchema.parse({
        pageSize: String(CUSTOMER_OVERVIEW_LIMITS.recentRequests),
      }),
    ),
  ]);

  return {
    actionRequired: {
      quotations: { items: quotations.data, totalItems: quotations.pagination.totalItems },
      invoices: { items: invoices.data, totalItems: invoices.pagination.totalItems },
    },
    upcomingVisits: { items: visits.data, totalItems: visits.pagination.totalItems },
    recentRequests: { items: requests.data, totalItems: requests.pagination.totalItems },
    counts: {
      actionRequired: quotations.pagination.totalItems + invoices.pagination.totalItems,
      upcomingVisits: visits.pagination.totalItems,
      requests: requests.pagination.totalItems,
    },
  };
}
