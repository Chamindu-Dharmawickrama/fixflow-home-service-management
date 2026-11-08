import {
  addDaysToDateOnly,
  balanceDue,
  dateOnlyInTimeZone,
  daysBetweenDateOnly,
  ErrorCode,
  type FieldErrors,
  InvoiceAction,
  InvoiceStatus,
  invoiceStatusLabel,
  isPositiveAmount,
} from "@fixflow/shared";

import { type AppError, conflict } from "../../lib/errors.js";

/**
 * Pure rules for invoices (spec §6.5, §7.6, D-23, D-26): which status changes are allowed and who
 * makes them, what an invoice is *now* (the derivation every screen and list trusts), what an admin
 * may do next, what must be true before one is issued, the starting values of a new draft, and the
 * words of the history and the customer's notifications. Nothing here reads a database, a clock or a
 * request; the services pass everything in.
 */

const I = InvoiceStatus;

// ---- Status transitions (D-26, spec §6.5) --------------------------------------------------------

/** Who makes a change: a business admin, or the system as time passes. T21 adds payments. */
export const InvoiceTrigger = {
  ADMIN: "ADMIN",
  SYSTEM: "SYSTEM",
} as const;
export type InvoiceTrigger = (typeof InvoiceTrigger)[keyof typeof InvoiceTrigger];

export interface InvoiceTransition {
  from: InvoiceStatus;
  to: InvoiceStatus;
  trigger: InvoiceTrigger;
  /** The admin action that makes it. Absent for the system's change. */
  action?: InvoiceAction;
}

/**
 * Every allowed change of an invoice's status, as data (D-26). A pair that is not listed is not
 * allowed, whoever asks. `PAID`, `PARTIALLY_PAID` and `VOID` are not reached by an admin action in
 * T20: a payment moves an invoice there (T21), and `VOID` has no way out. An invoice with payments
 * cannot be voided at all (`INVOICE_HAS_PAYMENTS`), which is why no payment status leads to `VOID`.
 */
export const INVOICE_TRANSITIONS: readonly InvoiceTransition[] = [
  { from: I.DRAFT, to: I.ISSUED, trigger: InvoiceTrigger.ADMIN, action: InvoiceAction.ISSUE },
  { from: I.DRAFT, to: I.VOID, trigger: InvoiceTrigger.ADMIN, action: InvoiceAction.VOID },
  { from: I.ISSUED, to: I.VOID, trigger: InvoiceTrigger.ADMIN, action: InvoiceAction.VOID },
  { from: I.OVERDUE, to: I.VOID, trigger: InvoiceTrigger.ADMIN, action: InvoiceAction.VOID },
  { from: I.ISSUED, to: I.OVERDUE, trigger: InvoiceTrigger.SYSTEM },
  { from: I.PARTIALLY_PAID, to: I.OVERDUE, trigger: InvoiceTrigger.SYSTEM },
];

export function canTransitionInvoice(
  from: InvoiceStatus,
  to: InvoiceStatus,
  trigger: InvoiceTrigger,
): boolean {
  return INVOICE_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to && transition.trigger === trigger,
  );
}

function statusName(status: InvoiceStatus): string {
  return invoiceStatusLabel(status).toLowerCase();
}

function invalidTransition(from: InvoiceStatus, to: InvoiceStatus): AppError {
  const hasOutgoing = INVOICE_TRANSITIONS.some((transition) => transition.from === from);
  const message =
    from === to
      ? `This invoice is already ${statusName(from)}.`
      : !hasOutgoing
        ? `This invoice is ${statusName(from)}, so it can no longer be changed.`
        : `An invoice that is ${statusName(from)} cannot be moved to ${statusName(to)}.`;
  return conflict(message, {
    code: ErrorCode.INVALID_STATE_TRANSITION,
    details: { currentStatus: from, requestedStatus: to },
  });
}

/** `409 INVALID_STATE_TRANSITION` unless D-26 allows `from` → `to` for this trigger. */
export function assertInvoiceTransition(
  from: InvoiceStatus,
  to: InvoiceStatus,
  trigger: InvoiceTrigger,
): void {
  if (!canTransitionInvoice(from, to, trigger)) {
    throw invalidTransition(from, to);
  }
}

export const STALE_INVOICE_MESSAGE =
  "This invoice was updated by someone else. Refresh to see the latest version.";

/** `409 STALE_STATE`: the caller acted on a status, or a saved version, that is no longer current (D-46). */
export function staleInvoiceError(currentStatus: InvoiceStatus): AppError {
  return conflict(STALE_INVOICE_MESSAGE, {
    code: ErrorCode.STALE_STATE,
    details: { currentStatus },
  });
}

/** `409 INVOICE_NOT_EDITABLE`: only a draft can be changed; an issued invoice is fixed (BR-13). */
export function invoiceNotEditableError(status: InvoiceStatus): AppError {
  return conflict(
    status === I.VOID
      ? "This invoice was voided, so it can't be edited."
      : "An issued invoice can't be edited. Void it and start a new invoice instead.",
    { code: ErrorCode.INVOICE_NOT_EDITABLE, details: { currentStatus: status } },
  );
}

/** `409 INVOICE_EXISTS`: the job already has an invoice that is not void (D-26). */
export function invoiceExistsError(invoice: {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
}): AppError {
  const name = invoice.invoiceNumber ?? "a draft invoice";
  return conflict(
    `This job already has an invoice (${name}, ${statusName(invoice.status)}). Open it, or void it to start a new one.`,
    {
      code: ErrorCode.INVOICE_EXISTS,
      details: { invoiceId: invoice.id, currentStatus: invoice.status },
    },
  );
}

/** `409 INVOICE_HAS_PAYMENTS`: an invoice with a payment on it cannot be voided (D-26). */
export function invoiceHasPaymentsError(status: InvoiceStatus): AppError {
  return conflict(
    "This invoice has payments recorded against it, so it can't be voided. Void the payments first.",
    { code: ErrorCode.INVOICE_HAS_PAYMENTS, details: { currentStatus: status } },
  );
}

// ---- What an invoice is now (D-23, D-26) -----------------------------------------------------------

/** The inputs of {@link deriveInvoiceStatus}: stored facts, the clock and the business time zone. */
export interface InvoiceStatusInput {
  issuedAt: Date | null;
  voidedAt: Date | null;
  /** Decimal strings, two places. */
  totalAmount: string;
  amountPaid: string;
  /** `YYYY-MM-DD`, or `null` for a draft that has none. */
  dueDate: string | null;
  now: Date;
  timeZone: string;
}

/**
 * Whether the due date is behind us on the business's calendar. An invoice is due until 23:59:59 on
 * `dueDate` in the business time zone and overdue from the next local midnight: compared as dates, so
 * 9 pm in New York on the due date (already tomorrow in UTC) is not yet overdue and a day on which the
 * clocks change is still one day.
 */
export function isPastDue(dueDate: string, now: Date, timeZone: string): boolean {
  return dateOnlyInTimeZone(now, timeZone) > dueDate;
}

/**
 * What an invoice is now, whatever the stored status says (D-23, D-26). The precedence is
 * `VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED`:
 *
 * - voided wins over everything, even a draft that was voided;
 * - an invoice that was never issued is a draft;
 * - nothing owed (the balance is zero or less, which includes a total of zero) is paid;
 * - a balance after the last moment of the due date is overdue, even when part has been paid;
 * - part paid is partially paid; otherwise it is issued.
 */
export function deriveInvoiceStatus(input: InvoiceStatusInput): InvoiceStatus {
  if (input.voidedAt !== null) {
    return I.VOID;
  }
  if (input.issuedAt === null) {
    return I.DRAFT;
  }
  const balance = balanceDue(input.totalAmount, input.amountPaid);
  if (!isPositiveAmount(balance)) {
    return I.PAID;
  }
  if (input.dueDate !== null && isPastDue(input.dueDate, input.now, input.timeZone)) {
    return I.OVERDUE;
  }
  return isPositiveAmount(input.amountPaid) ? I.PARTIALLY_PAID : I.ISSUED;
}

/** Whole days past the due date on the business's calendar, `0` unless the invoice is overdue. */
export function daysOverdue(
  input: Pick<InvoiceStatusInput, "dueDate" | "now" | "timeZone"> & { status: InvoiceStatus },
): number {
  if (input.status !== I.OVERDUE || input.dueDate === null) {
    return 0;
  }
  return Math.max(
    0,
    daysBetweenDateOnly(input.dueDate, dateOnlyInTimeZone(input.now, input.timeZone)),
  );
}

// ---- What the admin may do (D-43) ----------------------------------------------------------------

export interface InvoiceActionContext {
  /** A payment that has not been voided is recorded against the invoice. */
  hasActivePayments?: boolean;
}

/**
 * What an admin may do to an invoice in this status, the most likely step first (D-43). The screen
 * offers exactly these and the endpoints check them again. Voiding is for a draft or an issued
 * invoice that nothing has been paid against.
 */
export function availableInvoiceActions(
  status: InvoiceStatus,
  context: InvoiceActionContext = {},
): InvoiceAction[] {
  switch (status) {
    case I.DRAFT:
      return [InvoiceAction.EDIT, InvoiceAction.ISSUE, InvoiceAction.VOID];
    case I.ISSUED:
    case I.OVERDUE:
      return context.hasActivePayments === true ? [] : [InvoiceAction.VOID];
    default:
      return [];
  }
}

// ---- A new draft ---------------------------------------------------------------------------------

/** The due date a new draft starts with: today (business time) plus the configured number of days. */
export function defaultDueDate(now: Date, timeZone: string, dueDays: number): string {
  return addDaysToDateOnly(dateOnlyInTimeZone(now, timeZone), dueDays);
}

// ---- Before an invoice is issued -------------------------------------------------------------------

export const ISSUE_NEEDS_LINES_MESSAGE = "Add at least one line before issuing.";
export const ISSUE_NEEDS_TOTAL_MESSAGE =
  "The total must be more than zero before the invoice can be issued.";
export const DUE_BEFORE_ISSUE_MESSAGE = "The due date can't be before the issue date.";

/**
 * What stops a draft from being issued, as `fieldErrors` (empty when it can go): at least one line, a
 * total above zero and a due date on or after the issue date. `issueDate` is the day it would be
 * issued with: the one saved on the draft, or today (business time) when none was chosen.
 */
export function issueProblems(draft: {
  lineCount: number;
  totalAmount: string;
  issueDate: string;
  dueDate: string;
}): FieldErrors {
  const problems: FieldErrors = {};
  if (draft.lineCount < 1) {
    problems.lines = ISSUE_NEEDS_LINES_MESSAGE;
  }
  if (!isPositiveAmount(draft.totalAmount)) {
    problems.totalAmount = ISSUE_NEEDS_TOTAL_MESSAGE;
  }
  if (draft.dueDate < draft.issueDate) {
    problems.dueDate = DUE_BEFORE_ISSUE_MESSAGE;
  }
  return problems;
}

/** The day a draft is issued with: the one saved on it, or today on the business's calendar. */
export function effectiveIssueDate(saved: string | null, now: Date, timeZone: string): string {
  return saved ?? dateOnlyInTimeZone(now, timeZone);
}

// ---- The words of the history and the notifications ----------------------------------------------

export interface EventTexts {
  /** Phrases for `buildActivitySummaries`. `customer` is left out for an event only staff see. */
  staff: string;
  customer?: string;
}

export function createdTexts(input: { jobReference: string }): EventTexts {
  return { staff: `created a draft invoice for job ${input.jobReference}` };
}

export function issuedTexts(input: { invoiceNumber: string; customerName: string }): EventTexts {
  return {
    staff: `issued invoice ${input.invoiceNumber} to ${input.customerName}`,
    customer: `issued invoice ${input.invoiceNumber}`,
  };
}

export function voidedTexts(input: {
  invoiceNumber: string | null;
  /** The customer had been sent it, so they see the event. A draft never reached them. */
  wasIssued: boolean;
}): EventTexts {
  const name =
    input.invoiceNumber === null ? "the draft invoice" : `invoice ${input.invoiceNumber}`;
  return {
    staff: `voided ${name}`,
    ...(input.wasIssued && { customer: `voided invoice ${input.invoiceNumber ?? ""}`.trim() }),
  };
}

export function overdueTexts(input: { invoiceNumber: string }): EventTexts {
  return {
    staff: `marked invoice ${input.invoiceNumber} as overdue because its due date passed`,
    customer: `marked invoice ${input.invoiceNumber} as overdue`,
  };
}

export interface NotificationTexts {
  title: string;
  message: string;
}

/** What the customer is told in the app when an invoice is issued: no amount, the invoice has it. */
export function issuedNotification(input: {
  invoiceNumber: string;
  serviceName: string;
}): NotificationTexts {
  return {
    title: `Invoice ${input.invoiceNumber} is ready`,
    message: `Your invoice for ${input.serviceName} is ready. Open it to see what it covers and how to pay.`,
  };
}

/**
 * The customer's notice that an issued invoice was voided. The internal void reason is not an input,
 * so it cannot be passed.
 */
export function voidedNotification(input: {
  invoiceNumber: string;
  serviceName: string;
}): NotificationTexts {
  return {
    title: `Invoice ${input.invoiceNumber} was voided`,
    message: `We voided the invoice for ${input.serviceName}, so you do not need to pay it. If a corrected invoice is needed, you will be notified.`,
  };
}
