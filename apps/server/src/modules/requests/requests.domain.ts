import { TZDate } from "@date-fns/tz";
import {
  addDaysToDateOnly,
  ErrorCode,
  isDateOnly,
  PREFERRED_WINDOWS,
  preferredDateProblem,
  type PreferredWindow,
  REQUEST_STATUS_LABELS,
  RequestAction,
  type RequestAddressDto,
  type RequestStatusCounts,
  ServiceRequestStatus,
} from "@fixflow/shared";

import { type AppError, conflict } from "../../lib/errors.js";

/**
 * Pure rules for service requests (spec §6.2, §7.1, D-21, D-35, D-36): which status changes are
 * allowed and who may make them, turning the customer's preferred day and window into instants,
 * copying an address, and the words of the history and the notification. Nothing here reads a
 * database, a clock or a request; the services pass everything in.
 */

// ---- Status transitions (D-21, spec §6.2) --------------------------------------------------------

/** Who makes a status change: a business admin, or the system as a side effect of another workflow. */
export const RequestTrigger = { ADMIN: "ADMIN", SYSTEM: "SYSTEM" } as const;
export type RequestTrigger = (typeof RequestTrigger)[keyof typeof RequestTrigger];

export interface RequestTransition {
  from: ServiceRequestStatus;
  to: ServiceRequestStatus;
  trigger: RequestTrigger;
  /** The admin action that makes it. Absent for system transitions. */
  action?: RequestAction;
}

const S = ServiceRequestStatus;

/** The statuses an admin may cancel from. `CONVERTED_TO_JOB` follows the work order instead. */
const CANCELLABLE: readonly ServiceRequestStatus[] = [
  S.SUBMITTED,
  S.UNDER_REVIEW,
  S.QUOTED,
  S.ACCEPTED,
  S.DECLINED,
];

/**
 * Every allowed change of a request's status, as data (D-21). A pair that is not in this list is
 * not allowed, whoever asks. `CANCELLED` and `CONVERTED_TO_JOB` have no way out. The admin actions
 * and the system functions in `requests.transitions.ts` are both derived from it.
 */
export const REQUEST_TRANSITIONS: readonly RequestTransition[] = [
  {
    from: S.SUBMITTED,
    to: S.UNDER_REVIEW,
    trigger: RequestTrigger.ADMIN,
    action: RequestAction.START_REVIEW,
  },
  ...CANCELLABLE.map((from) => ({
    from,
    to: S.CANCELLED,
    trigger: RequestTrigger.ADMIN,
    action: RequestAction.CANCEL,
  })),
  // A quotation being sent or answered moves the request: the system's doing, never by hand.
  { from: S.UNDER_REVIEW, to: S.QUOTED, trigger: RequestTrigger.SYSTEM },
  { from: S.QUOTED, to: S.ACCEPTED, trigger: RequestTrigger.SYSTEM },
  { from: S.QUOTED, to: S.DECLINED, trigger: RequestTrigger.SYSTEM },
  { from: S.QUOTED, to: S.UNDER_REVIEW, trigger: RequestTrigger.SYSTEM },
  {
    from: S.DECLINED,
    to: S.UNDER_REVIEW,
    trigger: RequestTrigger.ADMIN,
    action: RequestAction.REOPEN,
  },
  { from: S.ACCEPTED, to: S.CONVERTED_TO_JOB, trigger: RequestTrigger.SYSTEM },
];

export function canTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
  trigger: RequestTrigger,
): boolean {
  return REQUEST_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.trigger === trigger,
  );
}

function statusName(status: ServiceRequestStatus): string {
  return REQUEST_STATUS_LABELS[status].toLowerCase();
}

/**
 * `409 INVALID_STATE_TRANSITION` unless D-21 allows `from` → `to` for this trigger. The message says
 * why in words an admin can act on; `details` carries the two statuses for the client.
 */
export function assertRequestTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
  trigger: RequestTrigger,
): void {
  if (canTransition(from, to, trigger)) {
    return;
  }
  throw invalidTransition(from, to, trigger);
}

function invalidTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
  trigger: RequestTrigger,
): AppError {
  const hasOutgoing = REQUEST_TRANSITIONS.some((transition) => transition.from === from);

  let message: string;
  if (!hasOutgoing) {
    message = `This request is ${statusName(from)}, so it can no longer be changed.`;
  } else if (trigger === RequestTrigger.ADMIN && canTransition(from, to, RequestTrigger.SYSTEM)) {
    message =
      "That change happens automatically, for example when a quotation is sent or answered, so it cannot be made by hand.";
  } else {
    message = `A request that is ${statusName(from)} cannot be moved to ${statusName(to)}.`;
  }
  return conflict(message, {
    code: ErrorCode.INVALID_STATE_TRANSITION,
    details: { currentStatus: from, requestedStatus: to },
  });
}

export const STALE_REQUEST_MESSAGE =
  "This request was updated by someone else. Refresh to see the latest status.";

/** `409 STALE_STATE`: the caller acted on a status the request is no longer in (D-46). */
export function staleRequestError(currentStatus: ServiceRequestStatus): AppError {
  return conflict(STALE_REQUEST_MESSAGE, {
    code: ErrorCode.STALE_STATE,
    details: { currentStatus },
  });
}

/** The status each admin action leads to. */
export const ADMIN_ACTION_TARGET: Readonly<Record<RequestAction, ServiceRequestStatus>> = {
  [RequestAction.START_REVIEW]: S.UNDER_REVIEW,
  [RequestAction.CANCEL]: S.CANCELLED,
  [RequestAction.REOPEN]: S.UNDER_REVIEW,
};

/** Cancelling and reopening need a written reason (5 to 500 characters, BR-16); starting a review does not. */
export const ACTIONS_REQUIRING_REASON: readonly RequestAction[] = [
  RequestAction.CANCEL,
  RequestAction.REOPEN,
];

/** The most likely next step first, the destructive one last. */
const ACTION_ORDER: readonly RequestAction[] = [
  RequestAction.START_REVIEW,
  RequestAction.REOPEN,
  RequestAction.CANCEL,
];

/**
 * Whether the admin action is allowed in this status. It looks at the action, not only at the
 * status it leads to: starting a review and reopening both lead to `UNDER_REVIEW`, but the first is
 * for a `SUBMITTED` request and the second for a `DECLINED` one.
 */
export function canPerformAdminAction(
  status: ServiceRequestStatus,
  action: RequestAction,
): boolean {
  return REQUEST_TRANSITIONS.some(
    (transition) =>
      transition.from === status &&
      transition.trigger === RequestTrigger.ADMIN &&
      transition.action === action,
  );
}

/** `409 INVALID_STATE_TRANSITION` unless the admin action is allowed in this status. */
export function assertAdminAction(status: ServiceRequestStatus, action: RequestAction): void {
  if (!canPerformAdminAction(status, action)) {
    throw invalidTransition(status, ADMIN_ACTION_TARGET[action], RequestTrigger.ADMIN);
  }
}

/**
 * What an admin may do to a request in this status (D-43), computed from the transition map so the
 * screen and the endpoint cannot disagree. T14 and T17 add `CREATE_QUOTATION` and `CREATE_WORK_ORDER`.
 */
export function availableAdminActions(status: ServiceRequestStatus): RequestAction[] {
  return ACTION_ORDER.filter((action) => canPerformAdminAction(status, action));
}

/** A request nobody has looked at yet. */
export function isNewRequest(status: ServiceRequestStatus): boolean {
  return status === S.SUBMITTED;
}

/** Every status present, `0` for the ones with no requests. */
export function toStatusCounts(
  groups: ReadonlyArray<{ status: ServiceRequestStatus; count: number }>,
): RequestStatusCounts {
  const counts = Object.fromEntries(Object.values(S).map((status) => [status, 0])) as Record<
    ServiceRequestStatus,
    number
  >;
  for (const { status, count } of groups) {
    counts[status] += count;
  }
  return counts;
}

// ---- The queue's date filter -----------------------------------------------------------------

export interface SubmittedRange {
  /** From this instant, inclusive. */
  from?: Date;
  /** Before this instant. */
  before?: Date;
}

function startOfDay(date: string, timeZone: string): Date {
  const instant = new TZDate(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    timeZone,
  );
  return new Date(instant.getTime());
}

/**
 * The instants a "submitted from / to" filter means. Both dates are days on the business's calendar
 * and both are inclusive: someone who picks 1 to 3 March gets everything submitted from midnight at
 * the start of the 1st until midnight at the end of the 3rd, in the business time zone, whatever
 * the zone of the browser or the server.
 */
export function submittedRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): SubmittedRange {
  return {
    ...(from !== undefined && { from: startOfDay(from, timeZone) }),
    ...(to !== undefined && { before: startOfDay(addDaysToDateOnly(to, 1), timeZone) }),
  };
}

export interface PreferredInstants {
  start: Date;
  end: Date;
}

/**
 * The window a customer chose, as UTC instants, for a date on the business's calendar (D-35).
 * `2026-11-01` + `MORNING` in New York is 08:00-12:00 Eastern: 13:00-17:00 UTC, because the clocks
 * went back that night. The offset is looked up for the day itself, so a change of the clocks on
 * (or before) that day cannot shift the window by an hour.
 */
export function preferredWindowToUtc(
  date: string,
  window: PreferredWindow,
  timeZone: string,
): PreferredInstants {
  if (!isDateOnly(date)) {
    throw new RangeError(`"${date}" is not a date written YYYY-MM-DD.`);
  }
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const { startHour, endHour } = PREFERRED_WINDOWS[window];

  const at = (hour: number): Date => {
    const instant = new TZDate(year, monthIndex, day, hour, timeZone);
    if (Number.isNaN(instant.getTime())) {
      throw new RangeError(`Cannot place ${date} ${hour}:00 in the time zone "${timeZone}".`);
    }
    return new Date(instant.getTime());
  };
  return { start: at(startHour), end: at(endHour) };
}

/**
 * The problems with the day a customer asked for, as `fieldErrors` (empty when it is fine). `now`
 * is the injected clock's, so the range is tomorrow to 90 days ahead on the business's calendar.
 */
export function preferredDateFieldErrors(
  date: string,
  now: Date,
  timeZone: string,
): Record<string, string> {
  const problem = preferredDateProblem(date, now, timeZone);
  return problem === null ? {} : { preferredDate: problem };
}

/** An address as typed or saved. Optional parts may be missing or `null`. */
export interface AddressInput {
  line1: string;
  line2?: string | null | undefined;
  city: string;
  region?: string | null | undefined;
  postalCode: string;
  accessNotes?: string | null | undefined;
}

/** The columns of a request that hold its copy of the address (D-36). */
export interface AddressSnapshot {
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressRegion: string | null;
  addressPostalCode: string;
  accessNotesSnapshot: string | null;
}

/**
 * Copies the address fields a request keeps. The request owns this copy: editing or deleting the
 * saved address later must not change what was asked for or where the work was to be done.
 */
export function snapshotAddress(address: AddressInput): AddressSnapshot {
  return {
    addressLine1: address.line1,
    addressLine2: address.line2 ?? null,
    addressCity: address.city,
    addressRegion: address.region ?? null,
    addressPostalCode: address.postalCode,
    accessNotesSnapshot: address.accessNotes ?? null,
  };
}

/** The address as the customer is shown it, from the columns of a request. */
export function toRequestAddress(row: AddressSnapshot): RequestAddressDto {
  return {
    line1: row.addressLine1,
    line2: row.addressLine2,
    city: row.addressCity,
    region: row.addressRegion,
    postalCode: row.addressPostalCode,
    accessNotes: row.accessNotesSnapshot,
  };
}

export interface SubmissionTexts {
  /** Phrases for `buildActivitySummaries`: `"<customer> <staff>."` and `"You <customer>."`. */
  activity: { staff: string; customer: string };
  /** The in-app notification every admin receives (D-38). */
  adminNotification: { title: string; message: string };
}

/**
 * The words used when a request is submitted, in one place so the history, the notification and
 * the tests agree. None of them contains the description or the address: those stay in the request.
 */
export function submissionTexts(input: {
  reference: string;
  serviceName: string;
  customerName: string;
}): SubmissionTexts {
  const { reference, serviceName, customerName } = input;
  return {
    activity: {
      staff: `submitted request ${reference} for ${serviceName}`,
      customer: "submitted your request",
    },
    adminNotification: {
      title: `New request ${reference}`,
      message: `${customerName} asked for ${serviceName}. It is waiting for review.`,
    },
  };
}
