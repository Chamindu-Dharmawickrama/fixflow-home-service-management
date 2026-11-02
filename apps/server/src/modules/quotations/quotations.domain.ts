import {
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  ErrorCode,
  type FieldErrors,
  isPositiveAmount,
  PricingMode,
  QuotationAction,
  type QuotationLineBody,
  QuotationStatus,
  quotationStatusLabel,
} from "@fixflow/shared";

import { startOfBusinessDay } from "../../lib/business-day.js";
import { type AppError, conflict } from "../../lib/errors.js";
import { formatEmailDate } from "../email/email.format.js";

/**
 * Pure rules for quotations (spec §6.3, §7.2, D-19, D-22, D-23): which status changes are allowed and
 * who makes them, when a sent quotation has expired, what an admin may do next, what must be true
 * before one is sent, the starting values of a new draft, and the words of the history and the
 * customer's notification. Nothing here reads a database, a clock or a request; the services pass
 * everything in.
 */

// ---- Status transitions (D-22, spec §6.3) --------------------------------------------------------

/** Who makes a change: a business admin, the customer (T15), or the system as time passes. */
export const QuotationTrigger = {
  ADMIN: "ADMIN",
  CUSTOMER: "CUSTOMER",
  SYSTEM: "SYSTEM",
} as const;
export type QuotationTrigger = (typeof QuotationTrigger)[keyof typeof QuotationTrigger];

export interface QuotationTransition {
  from: QuotationStatus;
  to: QuotationStatus;
  trigger: QuotationTrigger;
  /** The admin action that makes it. Absent for the customer's and the system's changes. */
  action?: QuotationAction;
}

const Q = QuotationStatus;

/**
 * Every allowed change of a quotation's status, as data (D-22). A pair that is not in this list is
 * not allowed, whoever asks. `ACCEPTED`, `DECLINED`, `EXPIRED` and `VOID` have no way out: an offer
 * is changed by replacing it, never by editing it (BR-07).
 */
export const QUOTATION_TRANSITIONS: readonly QuotationTransition[] = [
  { from: Q.DRAFT, to: Q.SENT, trigger: QuotationTrigger.ADMIN, action: QuotationAction.SEND },
  { from: Q.DRAFT, to: Q.VOID, trigger: QuotationTrigger.ADMIN, action: QuotationAction.VOID },
  { from: Q.SENT, to: Q.VOID, trigger: QuotationTrigger.ADMIN, action: QuotationAction.VOID },
  { from: Q.SENT, to: Q.ACCEPTED, trigger: QuotationTrigger.CUSTOMER },
  { from: Q.SENT, to: Q.DECLINED, trigger: QuotationTrigger.CUSTOMER },
  { from: Q.SENT, to: Q.EXPIRED, trigger: QuotationTrigger.SYSTEM },
];

export function canTransitionQuotation(
  from: QuotationStatus,
  to: QuotationStatus,
  trigger: QuotationTrigger,
): boolean {
  return QUOTATION_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.trigger === trigger,
  );
}

function statusName(status: QuotationStatus): string {
  return quotationStatusLabel(status).toLowerCase();
}

function invalidTransition(
  from: QuotationStatus,
  to: QuotationStatus,
  trigger: QuotationTrigger,
): AppError {
  const hasOutgoing = QUOTATION_TRANSITIONS.some((transition) => transition.from === from);

  let message: string;
  if (from === to) {
    message = `This quotation is already ${statusName(from)}.`;
  } else if (!hasOutgoing) {
    message = `This quotation is ${statusName(from)}, so it can no longer be changed.`;
  } else if (
    trigger === QuotationTrigger.ADMIN &&
    (canTransitionQuotation(from, to, QuotationTrigger.CUSTOMER) ||
      canTransitionQuotation(from, to, QuotationTrigger.SYSTEM))
  ) {
    message = "That change happens when the customer answers or the quotation expires.";
  } else {
    message = `A quotation that is ${statusName(from)} cannot be moved to ${statusName(to)}.`;
  }
  return conflict(message, {
    code: ErrorCode.INVALID_STATE_TRANSITION,
    details: { currentStatus: from, requestedStatus: to },
  });
}

/** `409 INVALID_STATE_TRANSITION` unless D-22 allows `from` → `to` for this trigger. */
export function assertQuotationTransition(
  from: QuotationStatus,
  to: QuotationStatus,
  trigger: QuotationTrigger,
): void {
  if (!canTransitionQuotation(from, to, trigger)) {
    throw invalidTransition(from, to, trigger);
  }
}

export const STALE_QUOTATION_MESSAGE =
  "This quotation was updated by someone else. Refresh to see the latest version.";

/** `409 STALE_STATE`: the caller acted on a status, or a saved version, that is no longer current (D-46). */
export function staleQuotationError(currentStatus: QuotationStatus): AppError {
  return conflict(STALE_QUOTATION_MESSAGE, {
    code: ErrorCode.STALE_STATE,
    details: { currentStatus },
  });
}

/** `409 QUOTATION_NOT_EDITABLE`: only a draft can be changed (BR-07, FR-046). */
export function notEditableError(status: QuotationStatus): AppError {
  return conflict(
    status === Q.SENT
      ? "A sent quotation can't be edited. Replace it with a new draft instead."
      : `This quotation is ${statusName(status)}, so it can't be edited.`,
    { code: ErrorCode.QUOTATION_NOT_EDITABLE, details: { currentStatus: status } },
  );
}

// ---- Expiry (D-22, D-23) -------------------------------------------------------------------------

/**
 * Whether a quotation's last day is behind us on the business's calendar. It can be answered until
 * 23:59:59 on `validUntil` (`YYYY-MM-DD`) in the business time zone: at the stroke of the next local
 * midnight it is past. Compared as dates, so a day on which the clocks change is still one day, and
 * 9 pm in New York on the last day (already tomorrow in UTC) is not yet past.
 */
export function isPastValidity(validUntil: string, now: Date, timeZone: string): boolean {
  return dateOnlyInTimeZone(now, timeZone) > validUntil;
}

/**
 * What a quotation is now, whatever the stored status says: a `SENT` one past its last day is
 * `EXPIRED` even before the sync has saved it so (D-23). Every other status is as stored.
 */
export function effectiveQuotationStatus(
  quotation: { status: QuotationStatus; validUntil: string },
  now: Date,
  timeZone: string,
): QuotationStatus {
  return quotation.status === Q.SENT && isPastValidity(quotation.validUntil, now, timeZone)
    ? Q.EXPIRED
    : quotation.status;
}

/** The instant a quotation expired: the start of the day after `validUntil`, on the business's clock. */
export function expiryInstant(validUntil: string, timeZone: string): Date {
  return startOfBusinessDay(addDaysToDateOnly(validUntil, 1), timeZone);
}

/** The last day a new draft is valid: today (business time) plus the configured number of days. */
export function defaultValidUntil(now: Date, timeZone: string, validityDays: number): string {
  return addDaysToDateOnly(dateOnlyInTimeZone(now, timeZone), validityDays);
}

// ---- What the admin may do (D-43) ----------------------------------------------------------------

export interface QuotationActionContext {
  /** The request already has a draft quotation, so a second one (a replacement) cannot start. */
  requestHasDraft?: boolean;
}

/**
 * What an admin may do to a quotation in this status, the most likely step first (D-43). The screen
 * offers exactly these and the endpoints check them again. A sent quotation can be replaced only
 * while the request has no other draft.
 */
export function availableQuotationActions(
  status: QuotationStatus,
  context: QuotationActionContext = {},
): QuotationAction[] {
  switch (status) {
    case Q.DRAFT:
      return [QuotationAction.EDIT, QuotationAction.SEND, QuotationAction.VOID];
    case Q.SENT:
      return context.requestHasDraft === true
        ? [QuotationAction.VOID]
        : [QuotationAction.REPLACE, QuotationAction.VOID];
    default:
      return [];
  }
}

// ---- The customer's answer (D-22, BR-08, T15) -----------------------------------------------------

/** What the customer decides: the status the quotation moves to. */
export type QuotationDecision = typeof Q.ACCEPTED | typeof Q.DECLINED;

function decisionVerb(decision: QuotationDecision): string {
  return decision === Q.ACCEPTED ? "accept" : "decline";
}

/** The date a customer reads: `Nov 17, 2026`, in the business time zone. */
function businessDate(instant: Date, timeZone: string): string {
  return formatEmailDate(dateOnlyInTimeZone(instant, timeZone));
}

/**
 * `409 QUOTATION_NOT_AVAILABLE`: why the customer cannot answer this quotation, in words that say
 * what happened and what to do. `status` is what the quotation is now (a sent one past its last day
 * is `EXPIRED`), and `decision` is what they tried, so a second "accept" and a "decline" after an
 * accept read differently. Every message is for the owner, so it may name the dates.
 */
export function quotationNotAvailableError(input: {
  status: QuotationStatus;
  decision: QuotationDecision;
  validUntil: string;
  respondedAt: Date | null;
  timeZone: string;
}): AppError {
  const { status, decision, validUntil, respondedAt, timeZone } = input;
  const answered = respondedAt === null ? "" : ` on ${businessDate(respondedAt, timeZone)}`;

  let message: string;
  switch (status) {
    case Q.ACCEPTED:
      message =
        decision === Q.ACCEPTED
          ? `You already accepted this quotation${answered}. There is nothing more to do: we'll contact you to schedule the work.`
          : `You already accepted this quotation${answered}, so it can't be declined now. Contact us if you need to change anything.`;
      break;
    case Q.DECLINED:
      message =
        decision === Q.DECLINED
          ? `You already declined this quotation${answered}.`
          : `You declined this quotation${answered}, so it can't be accepted now. Contact us and we'll send a new quotation if you'd like one.`;
      break;
    case Q.EXPIRED:
      message = `This quotation was valid until ${formatEmailDate(validUntil)} and has expired. Contact us and we'll send an updated quotation.`;
      break;
    case Q.VOID:
      message = `This quotation was withdrawn, so you can't ${decisionVerb(decision)} it. Check your request for an updated quotation, or contact us.`;
      break;
    default:
      message = `This quotation can't be ${decision === Q.ACCEPTED ? "accepted" : "declined"} right now.`;
  }
  return conflict(message, {
    code: ErrorCode.QUOTATION_NOT_AVAILABLE,
    details: { currentStatus: status },
  });
}

export function decisionTexts(input: {
  reference: string;
  decision: QuotationDecision;
}): EventTexts {
  const verb = input.decision === Q.ACCEPTED ? "accepted" : "declined";
  // The customer reads the same words behind "You", staff behind the customer's name.
  return {
    staff: `${verb} quotation ${input.reference}`,
    customer: `${verb} quotation ${input.reference}`,
  };
}

/** The request follows the customer's answer (D-21). A staff-only event: the quotation's event is the one they read. */
export function requestDecidedTexts(input: {
  requestReference: string;
  decision: QuotationDecision;
}): EventTexts {
  return {
    staff: `moved request ${input.requestReference} to ${input.decision === Q.ACCEPTED ? "accepted" : "declined"}: the customer answered the quotation`,
  };
}

/**
 * What the admins are told in the app. No reason and no amount: the quotation they open from it has
 * both, and a notification is shown on every screen.
 */
export function decisionNotification(input: {
  reference: string;
  customerName: string;
  serviceName: string;
  decision: QuotationDecision;
}): NotificationTexts {
  const { reference, customerName, serviceName, decision } = input;
  return decision === Q.ACCEPTED
    ? {
        title: `Quotation ${reference} accepted`,
        message: `${customerName} accepted the quotation for ${serviceName}. The request is ready to be scheduled.`,
      }
    : {
        title: `Quotation ${reference} declined`,
        message: `${customerName} declined the quotation for ${serviceName}. No work will be scheduled unless you send a new quotation.`,
      };
}

// ---- Before a quotation is sent (D-22) -----------------------------------------------------------

export const SEND_NEEDS_LINES_MESSAGE = "Add at least one line before sending.";
export const SEND_NEEDS_TOTAL_MESSAGE =
  "The total must be more than zero before the quotation can be sent.";
export const SEND_VALID_UNTIL_MESSAGE =
  "Choose a valid-until date of today or later, so the customer has time to answer.";

/**
 * What stops a draft from being sent, as `fieldErrors` (empty when it can go): at least one line, a
 * total above zero, and a last day that is not already behind us. `today` is the business's
 * calendar day, from the injected clock.
 */
export function sendProblems(
  draft: { lineCount: number; totalAmount: string; validUntil: string },
  today: string,
): FieldErrors {
  const problems: FieldErrors = {};
  if (draft.lineCount < 1) {
    problems.lines = SEND_NEEDS_LINES_MESSAGE;
  }
  if (!isPositiveAmount(draft.totalAmount)) {
    problems.totalAmount = SEND_NEEDS_TOTAL_MESSAGE;
  }
  if (draft.validUntil < today) {
    problems.validUntil = SEND_VALID_UNTIL_MESSAGE;
  }
  return problems;
}

// ---- A new draft ---------------------------------------------------------------------------------

/**
 * The single line a new draft starts with: the service as the customer asked for it, at its price
 * when the service has one fixed price and at zero otherwise. The admin must set a price before
 * sending, because a total of zero cannot be sent.
 */
export function starterLine(input: {
  serviceName: string;
  pricingMode: PricingMode;
  startingPrice: string | null;
}): QuotationLineBody {
  return {
    description: input.serviceName,
    quantity: "1",
    unitPrice:
      input.pricingMode === PricingMode.FIXED && input.startingPrice !== null
        ? input.startingPrice
        : "0.00",
    taxable: true,
  };
}

// ---- The words of the history and the notifications ----------------------------------------------

export interface EventTexts {
  /** Phrases for `buildActivitySummaries`. `customer` is left out for an event only staff see. */
  staff: string;
  customer?: string;
}

export function createdTexts(input: {
  reference: string;
  requestReference: string;
  replacesReference: string | null;
}): EventTexts {
  const { reference, requestReference, replacesReference } = input;
  return {
    staff:
      replacesReference === null
        ? `created draft quotation ${reference} for request ${requestReference}`
        : `started draft quotation ${reference} to replace ${replacesReference}`,
  };
}

export function sentTexts(input: {
  reference: string;
  customerName: string;
  replacesReference: string | null;
}): EventTexts {
  const { reference, customerName, replacesReference } = input;
  return {
    staff:
      replacesReference === null
        ? `sent quotation ${reference} to ${customerName}`
        : `sent quotation ${reference} to ${customerName}, replacing ${replacesReference}`,
    customer:
      replacesReference === null
        ? `sent you quotation ${reference}`
        : `sent you quotation ${reference}, which replaces ${replacesReference}`,
  };
}

export function voidedTexts(input: {
  reference: string;
  /** The customer had been sent it, so they see the event. A draft never reached them. */
  wasSent: boolean;
  replacedByReference: string | null;
  /** The request was cancelled: the cancellation is the event the customer reads, so this one is staff-only. */
  requestCancelled?: boolean;
}): EventTexts {
  const { reference, wasSent, replacedByReference, requestCancelled = false } = input;
  if (requestCancelled) {
    return {
      staff: `voided ${wasSent ? "" : "draft "}quotation ${reference} because the request was cancelled`,
    };
  }
  if (replacedByReference !== null) {
    return {
      staff: `voided quotation ${reference} because ${replacedByReference} replaces it`,
      customer: `replaced quotation ${reference} with ${replacedByReference}`,
    };
  }
  return {
    staff: `voided ${wasSent ? "" : "draft "}quotation ${reference}`,
    ...(wasSent && { customer: `withdrew quotation ${reference}` }),
  };
}

export function expiredTexts(input: { reference: string }): EventTexts {
  return {
    staff: `marked quotation ${input.reference} as expired because its valid-until date passed`,
    customer: `marked quotation ${input.reference} as expired`,
  };
}

export function requestQuotedTexts(input: { requestReference: string }): EventTexts {
  return { staff: `moved request ${input.requestReference} to quoted` };
}

export function requestResumedTexts(input: { requestReference: string }): EventTexts {
  return {
    staff: `moved request ${input.requestReference} back to under review: no quotation is waiting for an answer`,
  };
}

export interface NotificationTexts {
  title: string;
  message: string;
}

export function sentNotification(input: {
  reference: string;
  serviceName: string;
}): NotificationTexts {
  return {
    title: `Quotation ${input.reference} is ready`,
    message: `We prepared a quotation for ${input.serviceName}. Review it, then accept or decline it before it expires.`,
  };
}

/**
 * The customer's notice that a quotation was withdrawn. It carries the message the admin wrote for
 * the customer, or a standard line: the internal void reason is not an input, so it cannot be passed.
 */
export function withdrawnNotification(input: {
  reference: string;
  serviceName: string;
  customerMessage?: string | undefined;
}): NotificationTexts {
  const message = input.customerMessage?.trim();
  return {
    title: `Quotation ${input.reference} was withdrawn`,
    message:
      message === undefined || message === ""
        ? `We withdrew the quotation for ${input.serviceName}. It can no longer be accepted.`
        : message,
  };
}
