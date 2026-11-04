import {
  ActivityEntityType,
  type CustomerWorkOrderDto,
  type CustomerWorkOrderListResponse,
  WorkOrderStatus,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { paginated } from "../../lib/pagination.js";
import { getTimeline } from "../activity/activity.service.js";
import { canActAsAdmin, canActAsCustomer } from "../auth/auth.domain.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import { customerIdOf } from "../customers/customers.service.js";
import { loadBusiness } from "../requests/requests.service.js";
import {
  CUSTOMER_DETAIL_SELECT,
  CUSTOMER_LIST_SELECT,
  type CustomerListRow,
  toCustomerWorkOrderDto,
  toCustomerWorkOrderListItem,
} from "./work-orders.customer.dto.js";
import type { ListMyWorkOrdersQuery } from "./work-orders.schemas.js";

/**
 * The customer's side of a job (T18, spec §7.7, FR-056): their list, and one job in the shape they
 * are allowed to see. Whose jobs they are comes from the session, never from the request.
 */

/**
 * One stretch of the customer's list: the jobs it holds and the order they come in. The list reads
 * its stretches one after the other.
 */
interface Segment {
  where: Prisma.WorkOrderWhereInput;
  orderBy: Prisma.WorkOrderOrderByWithRelationInput[];
}

/**
 * The stretches of a customer's list, in the order they are shown (T18):
 *
 * 1. **visits**: a visit that is booked or under way, the soonest first;
 * 2. **awaiting a time**: a job that has no time (new, or one that needs a new one), the one that has
 *    waited longest first. A job that needs a new time keeps its old appointment in the table, but
 *    that time no longer applies, so it must not decide where the job stands;
 * 3. **past**: finished and cancelled jobs, the most recent visit first.
 */
function segmentsFor(customerId: string): Record<"visits" | "awaiting" | "past", Segment> {
  const statuses = (...list: WorkOrderStatus[]): Prisma.WorkOrderWhereInput => ({
    customerId,
    status: { in: list },
  });
  return {
    visits: {
      where: statuses(WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PROGRESS),
      orderBy: [
        { scheduledStart: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    },
    awaiting: {
      where: statuses(WorkOrderStatus.NEEDS_RESCHEDULING, WorkOrderStatus.PENDING_SCHEDULING),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
    past: {
      where: statuses(WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED),
      orderBy: [
        { scheduledStart: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "asc" },
      ],
    },
  };
}

/**
 * Reads one page across stretches as if they were a single list: a page that starts in one stretch
 * and ends in the next takes the rest of its rows from the next, so a row is never repeated or lost
 * between pages. It counts every stretch (in parallel), then reads only the stretches the page
 * touches (in parallel).
 */
async function readPage(
  prisma: Pick<AppDeps["prisma"], "workOrder">,
  segments: readonly Segment[],
  page: { skip: number; take: number },
): Promise<{ rows: CustomerListRow[]; totalItems: number }> {
  const counts = await Promise.all(
    segments.map((segment) => prisma.workOrder.count({ where: segment.where })),
  );
  let offset = page.skip;
  let remaining = page.take;
  const reads: Promise<CustomerListRow[]>[] = [];
  segments.forEach((segment, index) => {
    const count = counts[index] ?? 0;
    if (offset >= count) {
      offset -= count;
      return;
    }
    const take = Math.min(remaining, count - offset);
    reads.push(
      prisma.workOrder.findMany({
        where: segment.where,
        select: CUSTOMER_LIST_SELECT,
        orderBy: segment.orderBy,
        skip: offset,
        take,
      }),
    );
    remaining -= take;
    offset = 0;
  });
  const rows = (await Promise.all(reads)).flat();
  return { rows, totalItems: counts.reduce((sum, count) => sum + count, 0) };
}

/**
 * `GET /work-orders/me`: the signed-in customer's jobs, the ones with something still to happen
 * first (a booked visit, soonest first; then a job waiting for a time), then the finished and
 * cancelled ones (most recent first). With `group` only that section is listed.
 */
export async function listMyWorkOrders(
  deps: Pick<AppDeps, "prisma">,
  auth: AuthContext,
  query: ListMyWorkOrdersQuery,
): Promise<CustomerWorkOrderListResponse> {
  const { visits, awaiting, past } = segmentsFor(customerIdOf(auth));
  const segments =
    query.group === "upcoming"
      ? [visits, awaiting]
      : query.group === "past"
        ? [past]
        : [visits, awaiting, past];

  const { rows, totalItems } = await readPage(deps.prisma, segments, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return paginated(rows.map(toCustomerWorkOrderListItem), query, totalItems);
}

/**
 * One job, in the shape its customer sees (D-41). The owner gets it; so does an admin, who is
 * previewing what the customer sees. Any other customer gets `404`, exactly like an id that does not
 * exist, and the reference is never a way in: only the id is looked up, and ownership is checked
 * every time (BR-21).
 */
export async function getCustomerWorkOrder(
  deps: Pick<AppDeps, "prisma" | "config">,
  auth: AuthContext,
  id: string,
): Promise<CustomerWorkOrderDto> {
  const { prisma } = deps;
  // Authorize first, from the owner's id alone: nothing else is read for a caller who may not see it.
  const owner = await prisma.workOrder.findUnique({ where: { id }, select: { customerId: true } });
  if (canActAsCustomer(auth)) {
    assertCustomerOwns(owner?.customerId, auth);
  } else if (!canActAsAdmin(auth, deps.config.auth.adminEmails)) {
    throw forbidden();
  }
  if (owner === null) {
    throw notFound();
  }

  const row = await prisma.workOrder.findUnique({ where: { id }, select: CUSTOMER_DETAIL_SELECT });
  if (row === null) {
    throw notFound();
  }
  const [timeline, business] = await Promise.all([
    getTimeline(
      prisma,
      { entityType: ActivityEntityType.WORK_ORDER, entityId: id },
      "customer",
      row.customerId,
    ),
    loadBusiness(prisma),
  ]);
  return toCustomerWorkOrderDto({ row, timeline, timeZone: business.timeZone });
}
