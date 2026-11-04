import { type CalendarItemDto, WorkOrderStatus } from "@fixflow/shared";

import { formatTimeRange } from "@/lib/formatting/datetime";
import { getStatusMeta } from "@/lib/formatting/status";

import { weekdayName } from "./dates";

/** The words a visit is read with, on a block, a card, in the drawer and by a screen reader. */

/**
 * The accessible name of a block, in the order a person would say it:
 * "Tuesday 10:00 AM – 12:00 PM JOB-2026-00031 AC Routine Maintenance Alex Morgan, assigned to Jordan
 * Lee, Scheduled". The status is always said, so it is never carried by colour alone.
 *
 * The visible text of a block is the time range, the reference, the service and the customer, in that
 * order, and the name contains all of it, in the same order and in the same words (WCAG 2.5.3, Label in
 * Name): a person who speaks "click JOB-2026-00031" or reads the name aloud meets the text they see.
 * The weekday, the technician and the status are added around it, because a block does not draw them
 * in words (its day is its column, its technician is its colour, its status is an icon). The shown
 * pieces are separated by spaces and not by commas: the check for this rule (axe's
 * `label-content-name-mismatch`) drops Unicode punctuation such as the en dash of a time range but not
 * a comma, so a comma between two shown pieces would make the shown text no longer part of the name.
 *
 * @param dateOf The business date (`YYYY-MM-DD`) an instant falls on.
 */
export function visitAccessibleName(
  visit: CalendarItemDto,
  timeZone: string,
  dateOf: (instant: string) => string,
): string {
  const weekday = weekdayName(dateOf(visit.start));
  const technician =
    visit.technician === null ? "no technician assigned" : `assigned to ${visit.technician.name}`;
  const shown = [
    visitTimeRange(visit, timeZone),
    visit.reference,
    visit.serviceName,
    visit.customerName,
  ];
  return [`${weekday} ${shown.join(" ")}`, technician, visit.statusLabel].join(", ");
}

/** "10:00 AM – 12:00 PM" in the business's zone (with the dates when the visit runs past midnight). */
export function visitTimeRange(
  visit: Pick<CalendarItemDto, "start" | "end">,
  timeZone: string,
): string {
  return formatTimeRange(visit.start, visit.end, timeZone);
}

/** How a status looks on the calendar besides its colour: an icon, a dashed edge, a struck-through line. */
export interface VisitLook {
  /** The icon key from the shared status mapping, the same icon the badge uses. */
  icon: ReturnType<typeof getStatusMeta>["icon"];
  /** The visit holds no technician's time (cancelled, or waiting for a new time): its edge is dashed. */
  dashed: boolean;
  /** The visit will not happen: its text is struck through. */
  struck: boolean;
}

export function visitLook(status: WorkOrderStatus): VisitLook {
  return {
    icon: getStatusMeta("workOrder", status).icon,
    dashed: status === WorkOrderStatus.CANCELLED || status === WorkOrderStatus.NEEDS_RESCHEDULING,
    struck: status === WorkOrderStatus.CANCELLED,
  };
}
