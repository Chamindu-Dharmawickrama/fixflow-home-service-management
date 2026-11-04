import type { AdminTimelineEventDto, CustomerTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import { WorkOrderStatus } from "./enums.js";
import { LIMITS } from "./limits.js";
import type { QuotationLineDto } from "./quotations.js";
import type { RequestAddressDto } from "./requests.js";
import type { TechnicianColor } from "./technicians.js";

/**
 * Work orders ("jobs") as the business sees them (FR-050 to FR-057, D-24, D-25, D-43). A work order
 * is made from an accepted quotation and then scheduled with a technician. The admin shapes carry
 * the customer's contact details, the technician's contact details, the internal notes and the
 * internal history. The customer's own view of a job (T18) is a separate set of shapes at the end of
 * this file, built from a short allowlist of fields.
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

/**
 * What each status means to the customer, in plain words (spec §5.3). Every sentence says only what
 * the status records: "started work" is said of a job whose start the business recorded, and no
 * sentence promises a time or a person the business has not given.
 */
export const WORK_ORDER_CUSTOMER_EXPLANATIONS = {
  [WorkOrderStatus.PENDING_SCHEDULING]:
    "Your job is set up. We have not booked a time for the visit yet, and we will let you know as soon as we do.",
  [WorkOrderStatus.SCHEDULED]:
    "Your visit is booked for the time shown below. We will tell you if anything changes.",
  [WorkOrderStatus.IN_PROGRESS]: "Your technician has started work.",
  [WorkOrderStatus.COMPLETED]: "The work is finished. What was done is described below.",
  [WorkOrderStatus.CANCELLED]: "This job was cancelled, so no visit will take place.",
  [WorkOrderStatus.NEEDS_RESCHEDULING]:
    "We need to find a new time for your visit. We will let you know as soon as a new time is booked.",
} as const satisfies Record<WorkOrderStatus, string>;

export function workOrderCustomerExplanation(status: WorkOrderStatus): string {
  return WORK_ORDER_CUSTOMER_EXPLANATIONS[status];
}

// ---- Actions (D-43) --------------------------------------------------------------------------

/**
 * What an admin can do to a work order from where it stands (D-24, D-43). The server lists these in
 * `availableActions`; the screen offers them and nothing else. `SCHEDULE` and `RESCHEDULE` are
 * performed by `PATCH /admin/work-orders/:id/schedule` (T17); the other four by
 * `POST /admin/work-orders/:id/transitions` (T18).
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

/** The actions the transitions endpoint performs: the four that change a job's status (D-24). */
export const WORK_ORDER_TRANSITION_ACTIONS = [
  WorkOrderAction.START,
  WorkOrderAction.MARK_NEEDS_RESCHEDULING,
  WorkOrderAction.COMPLETE,
  WorkOrderAction.CANCEL,
] as const;
export type WorkOrderTransitionAction = (typeof WORK_ORDER_TRANSITION_ACTIONS)[number];

/**
 * The limits on what an admin writes when a job moves on. The completion note is read by the
 * customer, so it must say something; the internal note and every reason stay with the business. A
 * reason for a job that needs a new time is kept in the history line, which is short, so it is
 * shorter than a cancellation reason, which has a column of its own.
 */
export const TRANSITION_RULES = {
  completionNote: { minLength: 10, maxLength: 2000 },
  internalNote: { maxLength: LIMITS.notes.maxLength },
  needsReschedulingReason: { minLength: LIMITS.reason.minLength, maxLength: 200 },
  cancelReason: { minLength: LIMITS.reason.minLength, maxLength: LIMITS.reason.maxLength },
  customerMessage: { maxLength: LIMITS.reason.maxLength },
} as const;

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

/**
 * The presets of the jobs list: one tab each. `ready-to-invoice` is the completed jobs that have no
 * invoice yet (workflow 7.5): a completed job leaves it once an invoice other than a voided one exists.
 */
export const WORK_ORDER_VIEWS = [
  "needs-scheduling",
  "upcoming",
  "in-progress",
  "ready-to-invoice",
  "completed",
  "all",
] as const;
export type WorkOrderView = (typeof WORK_ORDER_VIEWS)[number];

/**
 * The statuses each view holds. `all` is every status, cancelled jobs included; the other views are
 * the working lists. `ready-to-invoice` holds completed jobs too: the server narrows it to those
 * without an invoice, which a status alone cannot say.
 */
export const WORK_ORDER_VIEW_STATUSES: Readonly<Record<WorkOrderView, readonly WorkOrderStatus[]>> =
  {
    "needs-scheduling": [WorkOrderStatus.PENDING_SCHEDULING, WorkOrderStatus.NEEDS_RESCHEDULING],
    upcoming: [WorkOrderStatus.SCHEDULED],
    "in-progress": [WorkOrderStatus.IN_PROGRESS],
    "ready-to-invoice": [WorkOrderStatus.COMPLETED],
    completed: [WorkOrderStatus.COMPLETED],
    all: Object.values(WorkOrderStatus),
  };

/**
 * The columns the jobs list can be sorted by. A job with no appointment (or, for `completedAt`, one
 * that is not completed) sorts after the others.
 */
export const ADMIN_WORK_ORDER_SORT_FIELDS = [
  "scheduledStart",
  "createdAt",
  "completedAt",
  "status",
] as const;
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
  /**
   * ISO 8601 instants; `null` until the job is scheduled. A job that needs a new time keeps the
   * appointment it had, as a reference: it holds no technician's time any more.
   */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technician: WorkOrderTechnicianRefDto | null;
  /** When the work was finished; `null` until then. */
  completedAt: string | null;
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
  /** What the customer reads when the job is done (null until then). */
  completionNote: string | null;
  /** For the team only. Never in a customer-facing shape. */
  internalCompletionNote: string | null;
  cancelledAt: string | null;
  /** Why the job was cancelled; for the team only. */
  cancelReason: string | null;
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

/**
 * `POST /admin/work-orders/:id/transitions` (FR-055, D-24). Which fields go with which action:
 *
 * | action | needs | may also carry |
 * |---|---|---|
 * | `START` | | |
 * | `MARK_NEEDS_RESCHEDULING` | `reason` (internal) | `customerMessage` |
 * | `COMPLETE` | `completionNote` (the customer reads it) | `internalNote` |
 * | `CANCEL` | `reason` (internal) | `customerMessage` |
 *
 * A field that does not belong to the action is refused (`422`). The reasons and the internal note
 * stay with the business; the customer reads the completion note and the optional message only.
 */
export interface TransitionWorkOrderBody {
  action: WorkOrderTransitionAction;
  /** The status the screen showed. A different current status is `409 STALE_STATE` (D-46). */
  expectedStatus: WorkOrderStatus;
  completionNote?: string;
  internalNote?: string;
  reason?: string;
  customerMessage?: string;
}

/**
 * The answer to a transition: the job as the business now sees it, and the warnings a screen may
 * surface. `startedBeforeSchedule` is true when the job was started before its scheduled start,
 * which is allowed (D-24) but worth saying.
 */
export interface WorkOrderTransitionResponse {
  data: AdminWorkOrderDto;
  meta: { startedBeforeSchedule: boolean };
}

// ---- The customer's view (T18, D-41) ---------------------------------------------------------

/**
 * A job as its customer sees it. These shapes are built field by field on the server, from a query
 * that selects only these columns: there is no internal note, no cancellation reason, no staff
 * identity and no technician contact detail to leak, whatever the table gains later (BR-19).
 * The technician is a first name and nothing else.
 */

/** The technician as a customer sees them: a first name, never a phone number, an email or an id. */
export interface CustomerWorkOrderTechnicianDto {
  displayName: string;
}

/** One card of the customer's job list. */
export interface CustomerWorkOrderListItemDto {
  id: string;
  /** `JOB-YYYY-NNNNN`. */
  reference: string;
  status: WorkOrderStatus;
  statusLabel: string;
  serviceName: string;
  /**
   * The visit's window as UTC instants, while there is one: a scheduled, started or finished job.
   * `null` for a job still waiting for a time, one that needs a new time, and a cancelled one.
   */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Only for a job that has a visit (see above), and only their first name. */
  technician: CustomerWorkOrderTechnicianDto | null;
  completedAt: string | null;
}

/** The customer's list: upcoming visits first, then finished and cancelled jobs. */
export type CustomerWorkOrderListResponse = PaginatedResponse<CustomerWorkOrderListItemDto>;

/**
 * The two sections of the customer's list: `upcoming` is a job that still has something to happen
 * (a booked or started visit, then one waiting for a time), `past` is one that is finished or
 * cancelled.
 */
export const CUSTOMER_WORK_ORDER_GROUPS = ["upcoming", "past"] as const;
export type CustomerWorkOrderGroup = (typeof CUSTOMER_WORK_ORDER_GROUPS)[number];

/** A record the job came from, to link back to. */
export interface CustomerWorkOrderSourceDto {
  id: string;
  reference: string;
}

/**
 * `GET /work-orders/:id`: a job in full, for its owner (an admin who opens the same address gets this
 * same shape, as a preview of what the customer sees). The times are UTC instants; `timeZone` is the
 * business's, in which they are shown.
 */
export interface CustomerWorkOrderDto extends CustomerWorkOrderListItemDto {
  /** What the status means for the customer, in plain words. */
  statusExplanation: string;
  /** The business time zone (IANA) the times are shown in. */
  timeZone: string;
  /** What the job is for, written from the customer's request and the quotation they accepted. */
  scopeDescription: string;
  /** The service address, as it was on the request. */
  address: RequestAddressDto;
  /**
   * The visit this job had before it was cancelled or needed a new time. It is history, not a
   * booking: the screen labels it so. `null` for any other job.
   */
  previouslyScheduled: { start: string; end: string } | null;
  startedAt: string | null;
  cancelledAt: string | null;
  /** What was done, written for the customer; only once the job is completed. */
  completionNote: string | null;
  request: CustomerWorkOrderSourceDto;
  quotation: CustomerWorkOrderSourceDto;
  /** The invoice for this job once there is one (T22); `null` until then. */
  invoice: CustomerWorkOrderSourceDto | null;
  /** What happened to the job, written for the customer, oldest first. */
  timeline: CustomerTimelineEventDto[];
}
