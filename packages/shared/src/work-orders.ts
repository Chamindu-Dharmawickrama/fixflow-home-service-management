import type { AdminTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import { WorkOrderStatus } from "./enums.js";
import { LIMITS } from "./limits.js";
import type { QuotationLineDto } from "./quotations.js";
import type { RequestAddressDto } from "./requests.js";
import type { TechnicianColor } from "./technicians.js";

/**
 * Work orders ("jobs") as the business sees them (FR-050 to FR-057, D-24, D-25, D-43). A work order
 * is made from an accepted quotation and then scheduled with a technician. These are the admin
 * shapes: they carry the customer's contact details, the technician's contact details and the
 * internal history. The customer's own view of a job is a separate set of shapes (T18).
 */

// ---- Status wording --------------------------------------------------------------------------

/** The name of each work-order status (the web badge shows the same words). */
export const WORK_ORDER_STATUS_LABELS = {
  [WorkOrderStatus.PENDING_SCHEDULING]: "Pending scheduling",
  [WorkOrderStatus.SCHEDULED]: "Scheduled",
  [WorkOrderStatus.IN_PROGRESS]: "In progress",
  [WorkOrderStatus.COMPLETED]: "Completed",
  [WorkOrderStatus.CANCELLED]: "Cancelled",
  [WorkOrderStatus.NEEDS_RESCHEDULING]: "Needs rescheduling",
} as const satisfies Record<WorkOrderStatus, string>;

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  return WORK_ORDER_STATUS_LABELS[status];
}

// ---- Actions (D-43) --------------------------------------------------------------------------

/**
 * What an admin can do to a work order from where it stands (D-24, D-43). The server lists these in
 * `availableActions`; the screen offers them and nothing else. `SCHEDULE` and `RESCHEDULE` are
 * performed by `PATCH /admin/work-orders/:id/schedule` (T17); the rest are listed from the same
 * transition table and performed by T18, and the web draws no control for them until then.
 */
export const WorkOrderAction = {
  /** Give a job that has no appointment (new, or one that needs a new time) a time and a technician. */
  SCHEDULE: "SCHEDULE",
  /** Move a scheduled job to another time or technician, with a reason. */
  RESCHEDULE: "RESCHEDULE",
  START: "START",
  MARK_NEEDS_RESCHEDULING: "MARK_NEEDS_RESCHEDULING",
  COMPLETE: "COMPLETE",
  CANCEL: "CANCEL",
} as const;
export type WorkOrderAction = (typeof WorkOrderAction)[keyof typeof WorkOrderAction];

// ---- Scheduling rules (D-25) -----------------------------------------------------------------

/**
 * The limits on an appointment. They are the server's rules (the web form runs the same numbers for
 * early feedback): the visit ends after it starts, lasts at most {@link maxDurationMinutes}, and does
 * not start more than {@link startGraceMinutes} before now, so a job can be booked for "right now"
 * but not for yesterday. The longest a reschedule reason can be is
 * {@link rescheduleReasonMaxLength}; it is kept in the history line, which is short.
 */
export const SCHEDULE_RULES = {
  maxDurationMinutes: LIMITS.appointment.maxDurationMinutes,
  startGraceMinutes: 15,
  rescheduleReasonMinLength: 5,
  rescheduleReasonMaxLength: 200,
  /** The longest window the conflict pre-check accepts: a week is more than any screen shows. */
  maxConflictWindowDays: 7,
} as const;

// ---- Reading ---------------------------------------------------------------------------------

/** The presets of the jobs list: one tab each. */
export const WORK_ORDER_VIEWS = [
  "needs-scheduling",
  "upcoming",
  "in-progress",
  "completed",
  "all",
] as const;
export type WorkOrderView = (typeof WORK_ORDER_VIEWS)[number];

/**
 * The statuses each view holds. `all` is every status, cancelled jobs included; the other views are
 * the working lists.
 */
export const WORK_ORDER_VIEW_STATUSES: Readonly<Record<WorkOrderView, readonly WorkOrderStatus[]>> =
  {
    "needs-scheduling": [WorkOrderStatus.PENDING_SCHEDULING, WorkOrderStatus.NEEDS_RESCHEDULING],
    upcoming: [WorkOrderStatus.SCHEDULED],
    "in-progress": [WorkOrderStatus.IN_PROGRESS],
    completed: [WorkOrderStatus.COMPLETED],
    all: Object.values(WorkOrderStatus),
  };

/** The columns the jobs list can be sorted by. A job with no appointment sorts after the others. */
export const ADMIN_WORK_ORDER_SORT_FIELDS = ["scheduledStart", "createdAt", "status"] as const;
export type AdminWorkOrderSortField = (typeof ADMIN_WORK_ORDER_SORT_FIELDS)[number];

/** The technician on a job, as the list shows them. */
export interface WorkOrderTechnicianRefDto {
  id: string;
  name: string;
  calendarColor: TechnicianColor;
}

/** One row of the jobs list. */
export interface AdminWorkOrderListItemDto {
  id: string;
  /** `JOB-YYYY-NNNNN`. */
  reference: string;
  status: WorkOrderStatus;
  statusLabel: string;
  /** The service's name when the job was made. */
  serviceName: string;
  customerName: string;
  /** The city of the service address. */
  city: string;
  /** ISO 8601 instants; `null` until the job is scheduled. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technician: WorkOrderTechnicianRefDto | null;
  createdAt: string;
}

export interface AdminWorkOrderListMeta {
  /**
   * Jobs per view for the search, technician, customer and date filters in force, **ignoring the
   * view and the status filter**, so each tab can say how many jobs choosing it would show.
   */
  viewCounts: Record<WorkOrderView, number>;
}

/** `GET /admin/work-orders`: the standard list envelope plus the tab counts. */
export interface AdminWorkOrderListResponse extends PaginatedResponse<AdminWorkOrderListItemDto> {
  meta: AdminWorkOrderListMeta;
}

/** The technician on a job, in full: the business may call them. Never in a customer-facing shape. */
export interface AdminWorkOrderTechnicianDto extends WorkOrderTechnicianRefDto {
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

/** The customer behind a job, with what the business needs to reach them. */
export interface AdminWorkOrderCustomerDto {
  /** The customer's profile id, for the customer pages. */
  id: string;
  name: string;
  email: string;
  /** `null` when the customer gave none. */
  phone: string | null;
}

/** The request and the accepted quotation a job was made from. */
export interface AdminWorkOrderSourceDto {
  id: string;
  reference: string;
}

/** The accepted quotation, with the lines that say what was agreed. */
export interface AdminWorkOrderQuotationDto extends AdminWorkOrderSourceDto {
  currencyCode: string;
  subtotal: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  totalAmount: string;
  lines: QuotationLineDto[];
}

/**
 * `GET /admin/work-orders/:id`: a job in full, for the business. `scheduledStart` and `scheduledEnd`
 * are UTC instants; the screen shows them on the business's clocks.
 */
export interface AdminWorkOrderDto {
  id: string;
  reference: string;
  status: WorkOrderStatus;
  statusLabel: string;
  /** What the job is for, written when it was made from the request and the accepted quotation. */
  scopeDescription: string;
  /** The service as it is now. */
  serviceId: string;
  /** The service's name when the job was made. */
  serviceName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technician: AdminWorkOrderTechnicianDto | null;
  customer: AdminWorkOrderCustomerDto;
  /** The service address as it was when the request was made, with the access notes. */
  address: RequestAddressDto;
  request: AdminWorkOrderSourceDto;
  quotation: AdminWorkOrderQuotationDto;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { name: string };
  createdAt: string;
  updatedAt: string;
  /** The history with internal summaries and the staff who acted, oldest first. */
  timeline: AdminTimelineEventDto[];
  /** What the admin may do now, the most likely next step first (D-43). */
  availableActions: WorkOrderAction[];
}

// ---- Bodies ----------------------------------------------------------------------------------

/**
 * `PATCH /admin/work-orders/:id/schedule` (FR-053, FR-054, FR-057). The times are UTC instants
 * (ISO 8601, with `Z` or an offset): the web form turns the business-clock date and time the person
 * typed into them with `wallClockToInstant`.
 */
export interface ScheduleWorkOrderBody {
  scheduledStart: string;
  scheduledEnd: string;
  technicianId: string;
  /** The status the screen showed. A different current status is `409 STALE_STATE` (D-46). */
  expectedStatus: WorkOrderStatus;
  /** Required when the job is already `SCHEDULED` (a reschedule), 5 to 200 characters, internal. */
  reason?: string;
}

/** A job that already holds a technician's time, as the pre-check and a conflict report it. */
export interface SchedulingConflictDto {
  id: string;
  reference: string;
  status: WorkOrderStatus;
  /** ISO 8601 instants. */
  scheduledStart: string;
  scheduledEnd: string;
  serviceName: string;
  customerName: string;
}

/** `GET /admin/work-orders/conflicts`: the jobs that overlap, earliest first (empty when none do). */
export type SchedulingConflictsResponse = { data: SchedulingConflictDto[] };
