import {
  addDaysToDateOnly,
  ErrorCode,
  type FieldErrors,
  SCHEDULE_RULES,
  WORK_ORDER_STATUS_LABELS,
  WorkOrderAction,
  WorkOrderStatus,
  type WorkOrderStatusAction,
  type WorkOrderTransitionAction,
} from "@fixflow/shared";

import { startOfBusinessDay } from "../../lib/business-day.js";
import { AppError, conflict } from "../../lib/errors.js";
import { formatEmailWindow } from "../email/email.format.js";

/**
 * Pure rules for work orders (spec §6.4, §7.4, D-24, D-25): which status changes are allowed, the
 * scheduling rules (does an appointment overlap another, is it a sensible length and not in the past),
 * and the words of the history, the notification and the scope. Nothing here reads a database or a
 * clock; the services pass everything in.
 */

// ---- Status transitions (D-24, spec §6.4) --------------------------------------------------------

export interface WorkOrderTransition {
  from: WorkOrderStatus;
  to: WorkOrderStatus;
  /** The admin action that makes it. */
  action: WorkOrderStatusAction;
}

const S = WorkOrderStatus;
const A = WorkOrderAction;

/**
 * Every allowed change of a work order's status, as data (D-24). A pair that is not in this list is
 * not allowed, whoever asks. Creating a job (it starts `PENDING_SCHEDULING`) is not a transition: a
 * work order has no earlier status. `COMPLETED` and `CANCELLED` have no way out, and an
 * `IN_PROGRESS` job cannot be cancelled: it is completed with a note instead. T17 performs the first
 * three rows; T18 performs the others from this same table.
 */
export const WORK_ORDER_TRANSITIONS: readonly WorkOrderTransition[] = [
  { from: S.PENDING_SCHEDULING, to: S.SCHEDULED, action: A.SCHEDULE },
  { from: S.NEEDS_RESCHEDULING, to: S.SCHEDULED, action: A.SCHEDULE },
  { from: S.SCHEDULED, to: S.SCHEDULED, action: A.RESCHEDULE },
  { from: S.SCHEDULED, to: S.IN_PROGRESS, action: A.START },
  { from: S.SCHEDULED, to: S.NEEDS_RESCHEDULING, action: A.MARK_NEEDS_RESCHEDULING },
  { from: S.IN_PROGRESS, to: S.NEEDS_RESCHEDULING, action: A.MARK_NEEDS_RESCHEDULING },
  { from: S.IN_PROGRESS, to: S.COMPLETED, action: A.COMPLETE },
  { from: S.PENDING_SCHEDULING, to: S.CANCELLED, action: A.CANCEL },
  { from: S.SCHEDULED, to: S.CANCELLED, action: A.CANCEL },
  { from: S.NEEDS_RESCHEDULING, to: S.CANCELLED, action: A.CANCEL },
];

/** The status each admin action leads to. */
export const WORK_ORDER_ACTION_TARGET: Readonly<Record<WorkOrderStatusAction, WorkOrderStatus>> = {
  [A.SCHEDULE]: S.SCHEDULED,
  [A.RESCHEDULE]: S.SCHEDULED,
  [A.START]: S.IN_PROGRESS,
  [A.MARK_NEEDS_RESCHEDULING]: S.NEEDS_RESCHEDULING,
  [A.COMPLETE]: S.COMPLETED,
  [A.CANCEL]: S.CANCELLED,
};

/** The most likely next step first, the destructive one last. */
const ACTION_ORDER: readonly WorkOrderStatusAction[] = [
  A.SCHEDULE,
  A.RESCHEDULE,
  A.START,
  A.COMPLETE,
  A.MARK_NEEDS_RESCHEDULING,
  A.CANCEL,
];

/** Whether the admin action is allowed in this status (it looks at the action, not only the target). */
export function canPerformWorkOrderAction(
  status: WorkOrderStatus,
  action: WorkOrderStatusAction,
): boolean {
  return WORK_ORDER_TRANSITIONS.some(
    (transition) => transition.from === status && transition.action === action,
  );
}

export interface WorkOrderActionContext {
  /** The job has an invoice that is not void. Leave out where it is not known. */
  hasLiveInvoice?: boolean;
}

/**
 * What an admin may do to a work order in this status (D-43), computed from the transition table so
 * the screen and the endpoints cannot disagree. A job that has an appointment can be rescheduled; one
 * that needs a time is scheduled.
 */
export function availableWorkOrderActions(
  status: WorkOrderStatus,
  context: WorkOrderActionContext = {},
): WorkOrderAction[] {
  const actions: WorkOrderAction[] = ACTION_ORDER.filter((action) =>
    canPerformWorkOrderAction(status, action),
  );
  // A completed job with no invoice that is still live is ready for one (D-26). Without the
  // answer (the calendar does not ask) the action is not listed.
  if (status === S.COMPLETED && context.hasLiveInvoice === false) {
    actions.push(A.CREATE_INVOICE);
  }
  return actions;
}

/**
 * The action that schedules a job in this status: `SCHEDULE` for one with no appointment (new, or
 * one that needs a new time) and `RESCHEDULE` for one that already has one. `undefined` when the job
 * cannot be given a time at all (under way, done or cancelled).
 */
export function scheduleActionFor(status: WorkOrderStatus): WorkOrderStatusAction | undefined {
  return [A.SCHEDULE, A.RESCHEDULE].find((action) => canPerformWorkOrderAction(status, action));
}

const ACTION_PHRASES: Readonly<Record<WorkOrderStatusAction, string>> = {
  [A.SCHEDULE]: "scheduled",
  [A.RESCHEDULE]: "rescheduled",
  [A.START]: "started",
  [A.MARK_NEEDS_RESCHEDULING]: "marked as needing a new time",
  [A.COMPLETE]: "completed",
  [A.CANCEL]: "cancelled",
};

/** `409 INVALID_STATE_TRANSITION`: the action is not allowed in the job's current status. */
export function invalidWorkOrderAction(
  status: WorkOrderStatus,
  action: WorkOrderStatusAction,
): AppError {
  const label = WORK_ORDER_STATUS_LABELS[status].toLowerCase();
  const hasOutgoing = WORK_ORDER_TRANSITIONS.some((transition) => transition.from === status);
  const message = hasOutgoing
    ? `A job that is ${label} cannot be ${ACTION_PHRASES[action]}.`
    : `This job is ${label}, so it can no longer be changed.`;
  return conflict(message, {
    code: ErrorCode.INVALID_STATE_TRANSITION,
    details: { currentStatus: status, requestedStatus: WORK_ORDER_ACTION_TARGET[action] },
  });
}

/** `409 INVALID_STATE_TRANSITION` unless the admin action is allowed in this status. */
export function assertWorkOrderAction(
  status: WorkOrderStatus,
  action: WorkOrderStatusAction,
): void {
  if (!canPerformWorkOrderAction(status, action)) {
    throw invalidWorkOrderAction(status, action);
  }
}

export const STALE_WORK_ORDER_MESSAGE =
  "This job was updated by someone else. Refresh to see the latest status.";

/** `409 STALE_STATE`: the caller acted on a status the job is no longer in (D-46). */
export function staleWorkOrderError(currentStatus: WorkOrderStatus): AppError {
  return conflict(STALE_WORK_ORDER_MESSAGE, {
    code: ErrorCode.STALE_STATE,
    details: { currentStatus },
  });
}

// ---- The appointment (D-25) ----------------------------------------------------------------------

/** A half-open interval of time, `[start, end)`. */
export interface TimeInterval {
  start: Date;
  end: Date;
}

/**
 * Whether two appointments claim some of the same time. The intervals are half-open, `[start, end)`,
 * so one that ends at the moment another starts does not overlap it: back-to-back visits are fine
 * (D-25). Two identical intervals, one inside the other, or one that starts before the other ends
 * and ends after it starts all overlap. Both intervals must be non-empty (`end` after `start`),
 * which {@link validateSchedule} guarantees for every appointment that is stored.
 */
export function overlaps(a: TimeInterval, b: TimeInterval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

const MINUTE = 60_000;

export const SCHEDULE_END_AFTER_START_MESSAGE = "The visit must end after it starts.";
export const SCHEDULE_TOO_LONG_MESSAGE = `A visit can last at most ${SCHEDULE_RULES.maxDurationMinutes / 60} hours.`;
export const SCHEDULE_IN_THE_PAST_MESSAGE = "The visit cannot start in the past.";

/**
 * The problems with an appointment, as `fieldErrors` (empty when it is fine): it must end after it
 * starts, last at most 12 hours, and not start more than 15 minutes before `now`. A start exactly 15
 * minutes ago is allowed. `now` is the injected clock's.
 */
export function validateSchedule(input: { start: Date; end: Date; now: Date }): FieldErrors {
  const { start, end, now } = input;
  const errors: FieldErrors = {};

  if (start.getTime() < now.getTime() - SCHEDULE_RULES.startGraceMinutes * MINUTE) {
    errors.scheduledStart = SCHEDULE_IN_THE_PAST_MESSAGE;
  }
  if (end.getTime() <= start.getTime()) {
    errors.scheduledEnd = SCHEDULE_END_AFTER_START_MESSAGE;
  } else if (end.getTime() - start.getTime() > SCHEDULE_RULES.maxDurationMinutes * MINUTE) {
    errors.scheduledEnd = SCHEDULE_TOO_LONG_MESSAGE;
  }
  return errors;
}

/** The job another appointment collides with, as the error and the pre-check report it. */
export interface ConflictingJob extends TimeInterval {
  id: string;
  reference: string;
}

/**
 * `409 SCHEDULING_CONFLICT`: the technician already has a job in that time. The message names the
 * first one and when it is; `details` carries it for the client (`conflictJobId`,
 * `conflictReference`, `conflictStart`, `conflictEnd`) and how many there are.
 */
export function schedulingConflictError(input: {
  technicianName: string;
  conflicts: readonly [ConflictingJob, ...ConflictingJob[]];
  timeZone: string;
}): AppError {
  const [first] = input.conflicts;
  const others = input.conflicts.length - 1;
  const window = formatEmailWindow(first.start, first.end, input.timeZone);
  const more = others === 0 ? "" : ` (and ${others} more)`;
  return new AppError(
    409,
    ErrorCode.SCHEDULING_CONFLICT,
    `${input.technicianName} is already booked for ${first.reference} on ${window}${more}. Choose another time or technician.`,
    {
      details: {
        conflictJobId: first.id,
        conflictReference: first.reference,
        conflictStart: first.start.toISOString(),
        conflictEnd: first.end.toISOString(),
        conflictCount: input.conflicts.length,
      },
    },
  );
}

/** `422 TECHNICIAN_INACTIVE`: an inactive technician cannot be given new work (FR-061). */
export function technicianInactiveError(technicianName: string): AppError {
  const message = `${technicianName} is inactive, so they cannot be given jobs. Choose another technician or reactivate them first.`;
  return new AppError(422, ErrorCode.TECHNICIAN_INACTIVE, message, {
    fieldErrors: { technicianId: message },
  });
}

export const RESCHEDULE_REASON_REQUIRED_MESSAGE = `Enter a reason of ${SCHEDULE_RULES.rescheduleReasonMinLength} to ${SCHEDULE_RULES.rescheduleReasonMaxLength} characters, so the history says why the visit moved.`;
export const NOTHING_TO_CHANGE_MESSAGE =
  "The job already has this time and technician. Choose a different time or technician.";

// ---- The scope --------------------------------------------------------------------------------

/**
 * What the job is for: the customer's description of the problem, then the work agreed in the
 * accepted quotation, one line each. It is written once, when the job is made (FR-050); the
 * quotation's lines are also shown on the job as they were.
 */
export function buildScopeDescription(input: {
  requestDescription: string;
  lineDescriptions: readonly string[];
}): string {
  const description = input.requestDescription.trim();
  const lines = input.lineDescriptions.map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length === 0) {
    return description;
  }
  return `${description}\n\nAgreed work:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

// ---- The words ----------------------------------------------------------------------------------

/** A job's history line must fit the activity limit; names and the reason are shortened if they do not. */
const SUMMARY_BUDGET = 395;

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export interface ConversionTexts {
  /** The job's own event: staff and customer. */
  job: { staff: string; customer: string };
  /** The request's event (staff-only): the system moved it on. */
  request: { staff: string };
}

/** The words used when a job is made from an accepted quotation (the customer reads only the job's line). */
export function conversionTexts(input: {
  jobReference: string;
  requestReference: string;
  quotationReference: string;
}): ConversionTexts {
  return {
    job: {
      staff: `created job ${input.jobReference} from quotation ${input.quotationReference} for request ${input.requestReference}`,
      customer: `created job ${input.jobReference} for your request`,
    },
    request: { staff: `moved request ${input.requestReference} on to job ${input.jobReference}` },
  };
}

export interface ScheduleTexts {
  /** The event's staff phrase (behind the admin's name) and the customer's, or none for a staff-only event. */
  staff: string;
  customer?: string;
}

/**
 * The history line of a schedule, a reschedule or a change of technician. Staff read the old and new
 * times, the technician and (for a reschedule) the reason; the customer reads the date and window and
 * nothing else: no technician, no reason. A change of technician alone leaves nothing for the
 * customer, who sees no technician.
 */
export function scheduleTexts(input: {
  kind: "scheduled" | "rescheduled" | "reassigned";
  reference: string;
  start: Date;
  end: Date;
  timeZone: string;
  technicianName: string;
  previousTechnicianName?: string | null;
  previous?: TimeInterval | null;
  reason?: string | null;
}): ScheduleTexts {
  const window = formatEmailWindow(input.start, input.end, input.timeZone);
  const technician = shorten(input.technicianName, 40);
  const reason =
    input.reason === undefined || input.reason === null ? "" : shorten(input.reason, 200);
  const because = reason === "" ? "" : ` Reason: ${reason}.`;
  const previousWindow =
    input.previous === undefined || input.previous === null
      ? null
      : formatEmailWindow(input.previous.start, input.previous.end, input.timeZone);

  switch (input.kind) {
    case "scheduled":
      return {
        staff: fit(`scheduled job ${input.reference} for ${window} with ${technician}`),
        customer: `scheduled your visit for ${window}`,
      };
    case "rescheduled":
      return {
        staff: fit(
          `rescheduled job ${input.reference} to ${window} with ${technician}${
            previousWindow === null ? "" : ` (was ${previousWindow})`
          }.${because}`,
        ),
        customer: `moved your visit to ${window}`,
      };
    case "reassigned":
      return {
        staff: fit(
          `changed the technician of job ${input.reference} to ${technician}${
            input.previousTechnicianName == null
              ? ""
              : ` (was ${shorten(input.previousTechnicianName, 40)})`
          }.${because}`,
        ),
      };
  }
}

function fit(staff: string): string {
  return staff.length <= SUMMARY_BUDGET ? staff : `${staff.slice(0, SUMMARY_BUDGET - 1)}…`;
}

export interface ScheduleNotificationTexts {
  title: string;
  message: string;
}

/**
 * The in-app notification to the customer (D-38): the job's reference and the date and window, and
 * nothing else. No technician, no address and no internal reason can reach it.
 */
export function scheduleNotification(input: {
  rescheduled: boolean;
  reference: string;
  start: Date;
  end: Date;
  timeZone: string;
}): ScheduleNotificationTexts {
  const window = formatEmailWindow(input.start, input.end, input.timeZone);
  return input.rescheduled
    ? {
        title: `Visit for ${input.reference} rescheduled`,
        message: `Your visit has moved to ${window}.`,
      }
    : {
        title: `Visit for ${input.reference} scheduled`,
        message: `Your visit is scheduled for ${window}.`,
      };
}

// ---- Starting, finishing, cancelling (T18, D-24) ------------------------------------------------------

/**
 * Whether a job is being started before its scheduled start. That is allowed (the technician may
 * arrive early, or the visit may be brought forward), but the admin is told, because it is more
 * often a slip of the finger than a plan. A job with no appointment cannot be early.
 */
export function startsBeforeSchedule(scheduledStart: Date | null, now: Date): boolean {
  return scheduledStart !== null && now.getTime() < scheduledStart.getTime();
}

/** The `ActivityEvent.action` each transition records. */
export const TRANSITION_EVENT_ACTIONS: Readonly<Record<WorkOrderTransitionAction, string>> = {
  [A.START]: "work_order.started",
  [A.MARK_NEEDS_RESCHEDULING]: "work_order.needs_rescheduling",
  [A.COMPLETE]: "work_order.completed",
  [A.CANCEL]: "work_order.cancelled",
};

export interface TransitionTexts {
  /** The staff phrase (behind the admin's name) and the customer's phrase (behind "We"). */
  staff: string;
  customer: string;
}

/**
 * The history line of a start, a "needs a new time", a completion or a cancellation. Staff read what
 * happened and, where there is one, the internal reason; **the customer reads one fixed sentence**:
 * no reason, no note and no technician can be in it, because none is an input of the customer's
 * part. The completion note is not in the history line either: the customer reads it on the job.
 */
export function transitionTexts(input: {
  action: WorkOrderTransitionAction;
  reference: string;
  timeZone: string;
  /** Start: it was before the scheduled start. */
  early?: boolean;
  /** Needs a new time: the appointment it had. */
  previous?: TimeInterval | null;
  /** The internal reason (needs a new time, cancel). */
  reason?: string | null;
  /** The business wrote the customer a message. */
  messageSent?: boolean;
}): TransitionTexts {
  const reason = input.reason == null ? "" : ` Reason: ${shorten(input.reason, 200)}.`;
  const message = input.messageSent === true ? " The customer was sent a message." : "";

  switch (input.action) {
    case A.START:
      return {
        staff: `started job ${input.reference}${input.early === true ? " before its scheduled start" : ""}`,
        customer: "started work on your job",
      };
    case A.MARK_NEEDS_RESCHEDULING: {
      const was =
        input.previous == null
          ? ""
          : ` (it was ${formatEmailWindow(input.previous.start, input.previous.end, input.timeZone)})`;
      return {
        staff: fit(`marked job ${input.reference} as needing a new time${was}.${message}${reason}`),
        customer: "need to find a new time for your visit",
      };
    }
    case A.COMPLETE:
      return { staff: `completed job ${input.reference}`, customer: "marked your job as complete" };
    case A.CANCEL:
      return {
        staff: fit(`cancelled job ${input.reference}.${message}${reason}`),
        customer: "cancelled your job",
      };
  }
}

export interface TransitionNotificationTexts {
  title: string;
  message: string;
}

/**
 * The in-app notification for a job that needs a new time, is finished or is cancelled (D-38). It
 * names the job and the service and says what happened, nothing else. `START` has none: the
 * business can turn it on later, and it is off because a customer does not need to be told that a
 * technician has arrived.
 */
export function transitionNotification(input: {
  action: Exclude<WorkOrderTransitionAction, "START">;
  reference: string;
  serviceName: string;
}): TransitionNotificationTexts {
  const service = shorten(input.serviceName, 100);
  switch (input.action) {
    case A.MARK_NEEDS_RESCHEDULING:
      return {
        title: `Visit for ${input.reference} needs a new time`,
        message: `We need to find a new time for your ${service} visit. We will let you know when it is booked.`,
      };
    case A.COMPLETE:
      return {
        title: `Job ${input.reference} is complete`,
        message: `Your ${service} job is complete. Open it to read what was done.`,
      };
    case A.CANCEL:
      return {
        title: `Job ${input.reference} was cancelled`,
        message: `Your ${service} job was cancelled, so no visit will take place.`,
      };
  }
}

// ---- The list's date filter ------------------------------------------------------------------------

export interface ScheduledRange {
  /** From this instant, inclusive. */
  from?: Date;
  /** Before this instant. */
  before?: Date;
}

/**
 * The instants a "scheduled from / to" filter means. Both dates are days on the business's calendar
 * and both are inclusive: someone who picks 1 to 3 March gets every appointment that starts from
 * midnight at the start of the 1st until midnight at the end of the 3rd, in the business time zone,
 * whatever the zone of the browser or the server.
 */
export function scheduledRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): ScheduledRange {
  return {
    ...(from !== undefined && { from: startOfBusinessDay(from, timeZone) }),
    ...(to !== undefined && { before: startOfBusinessDay(addDaysToDateOnly(to, 1), timeZone) }),
  };
}
