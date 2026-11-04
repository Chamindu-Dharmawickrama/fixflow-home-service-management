import type { WorkOrderStatus } from "./enums.js";
import type { WorkOrderAction, WorkOrderTechnicianRefDto } from "./work-orders.js";

/**
 * The scheduling calendar (T19, FR-052, FR-053, UX-QB-CAL). One read-only endpoint feeds the week, day
 * and agenda views: `GET /admin/calendar?from&to&technicianId`. The range is two days on the
 * business's calendar, both inclusive, so "Monday to Sunday" is the week whatever the zone of the
 * browser or the server. Rescheduling from the calendar is the T17 schedule endpoint, unchanged.
 */

export const CALENDAR_RULES = {
  /** The longest range, in days, both ends included: six weeks, what a month grid needs. */
  maxSpanDays: 42,
  /** The most visits one answer carries; beyond it the answer says it was cut (`truncated`). */
  maxItems: 500,
  /** The most jobs the "needs scheduling" list carries; `needsSchedulingTotal` counts them all. */
  maxNeedsScheduling: 20,
} as const;

/**
 * One visit on the calendar. Compact on purpose: what a block and its drawer show, and nothing the
 * job page holds (no address, no phone numbers, no notes). `start` and `end` are UTC instants; the
 * screen places them on the business's clocks.
 */
export interface CalendarItemDto {
  id: string;
  /** `JOB-YYYY-NNNNN`. */
  reference: string;
  status: WorkOrderStatus;
  statusLabel: string;
  /** ISO 8601 instants, `[start, end)`. */
  start: string;
  end: string;
  /** A visit that is on the calendar always has a technician; `null` only for a damaged row. */
  technician: WorkOrderTechnicianRefDto | null;
  customerName: string;
  /** The service's name when the job was made. */
  serviceName: string;
  /** The city of the service address. */
  city: string;
  /** What the admin may do now (D-43): the drawer offers "Reschedule" only when it is listed. */
  availableActions: WorkOrderAction[];
}

/**
 * A job that is waiting for a time (new, or one that needs a new time). The appointment a job that
 * needs a new time used to have is kept as a reference; it holds no technician's time any more.
 */
export interface CalendarWaitingJobDto {
  id: string;
  reference: string;
  status: WorkOrderStatus;
  statusLabel: string;
  serviceName: string;
  customerName: string;
  city: string;
  /** The old appointment of a job that needs a new time; `null` for a job never scheduled. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** The technician it had, if any, to start the dialog from. */
  technician: WorkOrderTechnicianRefDto | null;
}

export interface CalendarDto {
  /** The range asked for, `YYYY-MM-DD`, both inclusive. */
  from: string;
  to: string;
  /** The business time zone (IANA) the range was read in. */
  timeZone: string;
  /** Visits whose start falls in the range, earliest first. */
  items: CalendarItemDto[];
  /** True when more than {@link CALENDAR_RULES.maxItems} visits matched and the rest were left out. */
  truncated: boolean;
  /** Jobs waiting for a time, whatever the range and the technician filter: oldest first. */
  needsScheduling: CalendarWaitingJobDto[];
  /** How many jobs wait in all (the list above holds at most {@link CALENDAR_RULES.maxNeedsScheduling}). */
  needsSchedulingTotal: number;
}

export type CalendarResponse = { data: CalendarDto };
