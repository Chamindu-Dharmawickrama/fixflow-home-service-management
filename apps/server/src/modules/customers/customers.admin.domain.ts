import { InvoiceStatus, WorkOrderStatus } from "@fixflow/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { escapeLikePattern } from "../../lib/sql-like.js";

/**
 * Pure rules for the business's view of customers (FR-031, D-26, D-100): which jobs are open, which
 * invoices still owe money, how a balance is worked out, and how a search box turns into patterns.
 * Nothing here reads a database, a clock or a request; the service passes everything in.
 */

// ---- Jobs and invoices that count (D-26) -----------------------------------------------------

/** A job in one of these states has nothing left to do. */
const CLOSED_JOB_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.CANCELLED,
];

/**
 * The jobs still in play: waiting to be booked, booked, under way, or needing a new time. Defined as
 * "everything that is not closed", so a status added later counts as open until someone decides
 * otherwise.
 */
export const OPEN_JOB_STATUSES: readonly WorkOrderStatus[] = Object.values(WorkOrderStatus).filter(
  (status) => !CLOSED_JOB_STATUSES.includes(status),
);

/**
 * The invoices a customer can still owe money on (D-26): issued and not settled. Drafts are not yet
 * owed, paid invoices owe nothing and void ones are cancelled. `OVERDUE` is also stored as a status
 * once the due date has passed (the time-based sync, D-26), and counts here either way.
 */
export const OUTSTANDING_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

export function isOutstandingInvoice(status: InvoiceStatus): boolean {
  return OUTSTANDING_INVOICE_STATUSES.includes(status);
}

// ---- Money ---------------------------------------------------------------------------------

/**
 * What the database hands back for a money column or a sum of one. `Prisma.Decimal` is the
 * decimal.js class the client already uses, so the arithmetic below is exact: no money value ever
 * becomes a JavaScript number (D-18).
 */
type Money = Prisma.Decimal | string;

const ZERO = "0.00";

/** `total − paid`, never below zero, as a two-place decimal string. */
function remaining(total: Money, paid: Money): string {
  const left = new Prisma.Decimal(total).minus(paid);
  return left.isNegative() ? ZERO : left.toFixed(2);
}

/**
 * What one invoice still owes: its total less what was paid for an issued, partially paid or
 * overdue invoice, and `"0.00"` for any other (a draft is not owed yet, a paid or void one owes
 * nothing).
 */
export function invoiceBalanceDue(input: {
  status: InvoiceStatus;
  totalAmount: Money;
  amountPaid: Money;
}): string {
  return isOutstandingInvoice(input.status) ? remaining(input.totalAmount, input.amountPaid) : ZERO;
}

/**
 * A customer's outstanding balance from the sums of `totalAmount` and `amountPaid` over their
 * outstanding invoices (D-26). A customer with no such invoice has `null` sums and owes `"0.00"`.
 */
export function outstandingBalance(sums: {
  totalAmount: Money | null;
  amountPaid: Money | null;
}): string {
  if (sums.totalAmount === null) {
    return ZERO;
  }
  return remaining(sums.totalAmount, sums.amountPaid ?? ZERO);
}

// ---- Search (FR-031) -------------------------------------------------------------------------

/** A phone number is typed with digits, spaces and these marks; anything else is a name or an email. */
const PHONE_CHARACTERS = /^[\d\s()+.-]+$/;

/** Fewer digits than this match too many numbers to be a useful search. */
export const MIN_PHONE_SEARCH_DIGITS = 3;

/**
 * The digits to look for in phone numbers, when the search text looks like part of a phone number:
 * only digits and the usual punctuation, with at least {@link MIN_PHONE_SEARCH_DIGITS} digits.
 * `"(212) 555"`, `"212-555"` and `"212.555"` all give `"212555"`, which matches a number stored as
 * `"(212) 555-0100"` because the stored number is stripped of its punctuation the same way.
 * Anything else (a name, an email, a few digits) gives `undefined`.
 */
export function phoneSearchDigits(search: string): string | undefined {
  if (!PHONE_CHARACTERS.test(search)) {
    return undefined;
  }
  const digits = search.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : undefined;
}

export interface CustomerSearchPatterns {
  /** For `ILIKE` against the name and the email: `%text%`, with `%`, `_` and `\` taken literally. */
  text: string;
  /** For `LIKE` against a phone number stripped to its digits, or `undefined` when the text is not a phone search. */
  phoneDigits: string | undefined;
}

/**
 * The patterns a customer search compares with (FR-031). Both are bound as parameters, never joined
 * into the SQL text, and the wildcard characters of the text are escaped, so what is typed always
 * means what it says.
 */
export function customerSearchPatterns(search: string): CustomerSearchPatterns {
  const digits = phoneSearchDigits(search);
  return {
    text: `%${escapeLikePattern(search)}%`,
    phoneDigits: digits === undefined ? undefined : `%${digits}%`,
  };
}
