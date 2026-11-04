import { CALENDAR_RULES, type CalendarDto, WorkOrderStatus } from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { loadBusiness } from "../requests/requests.service.js";
import { BOOKED_STATUSES } from "../technicians/technicians.domain.js";
import { scheduledRange } from "./work-orders.domain.js";
import { ADMIN_LIST_SELECT, toCalendarItem, toCalendarWaitingJob } from "./work-orders.dto.js";
import type { CalendarQuery } from "./work-orders.schemas.js";

/**
 * The visits that are "on the calendar" (T19): what holds or held a technician's time, that is
 * booked, under way or done. The cancelled jobs and those that need a new time are added on request.
 */
const ON_CALENDAR: readonly WorkOrderStatus[] = [...BOOKED_STATUSES, WorkOrderStatus.COMPLETED];
const NOT_BOOKED: readonly WorkOrderStatus[] = [
  WorkOrderStatus.CANCELLED,
  WorkOrderStatus.NEEDS_RESCHEDULING,
];

const WAITING: readonly WorkOrderStatus[] = [
  WorkOrderStatus.PENDING_SCHEDULING,
  WorkOrderStatus.NEEDS_RESCHEDULING,
];

/**
 * `GET /admin/calendar` (FR-052): the visits whose start falls in the range, and the jobs waiting for
 * a time. The range is read on the business's calendar (`from` from its first instant, `to` up to the
 * first instant of the day after it), so a visit at 23:30 on the last day is in and one at 00:00 the
 * next day is out, whatever the zone of the browser or the server. Three queries however many rows:
 * the visits (one more than the cap, to know whether it was reached), the waiting jobs (capped), and
 * their total.
 */
export async function getCalendar(
  deps: Pick<AppDeps, "prisma">,
  query: CalendarQuery,
): Promise<CalendarDto> {
  const { prisma } = deps;
  const business = await loadBusiness(prisma);
  const range = scheduledRange(query.from, query.to, business.timeZone);
  const statuses = query.includeUnbooked === true ? [...ON_CALENDAR, ...NOT_BOOKED] : ON_CALENDAR;
  const visitsWhere: Prisma.WorkOrderWhereInput = {
    status: { in: [...statuses] },
    scheduledStart: {
      ...(range.from !== undefined && { gte: range.from }),
      ...(range.before !== undefined && { lt: range.before }),
    },
    ...(query.technicianId !== undefined && { technicianId: query.technicianId }),
  };
  // Waiting work is not tied to a week or a technician: a job that has nobody yet is the business's
  // to place, whichever technician's calendar is open.
  const waitingWhere: Prisma.WorkOrderWhereInput = { status: { in: [...WAITING] } };

  const [rows, waitingRows, needsSchedulingTotal] = await Promise.all([
    prisma.workOrder.findMany({
      where: visitsWhere,
      select: ADMIN_LIST_SELECT,
      orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
      take: CALENDAR_RULES.maxItems + 1,
    }),
    prisma.workOrder.findMany({
      where: waitingWhere,
      select: ADMIN_LIST_SELECT,
      // A job that needs a new time has already been promised one, so it comes before a new job:
      // `NEEDS_RESCHEDULING` is declared after `PENDING_SCHEDULING` in the enum, which Postgres
      // orders by, so descending puts it first (an integration test pins this). Then whoever has
      // waited longest.
      orderBy: [{ status: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: CALENDAR_RULES.maxNeedsScheduling,
    }),
    prisma.workOrder.count({ where: waitingWhere }),
  ]);

  return {
    from: query.from,
    to: query.to,
    timeZone: business.timeZone,
    items: rows.slice(0, CALENDAR_RULES.maxItems).flatMap((row) => toCalendarItem(row) ?? []),
    truncated: rows.length > CALENDAR_RULES.maxItems,
    needsScheduling: waitingRows.map(toCalendarWaitingJob),
    needsSchedulingTotal,
  };
}
