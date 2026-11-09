import {
  balanceDue,
  dateOnlyInTimeZone,
  ErrorCode,
  InvoiceStatus as I,
  type InvoiceStatus,
  invoiceStatusLabel,
  isAmountAbove,
  isPositiveAmount,
  type PaymentMethod,
  paymentMethodLabel,
  sumAmounts,
} from "@fixflow/shared";

import { AppError, conflict, validation } from "../../lib/errors.js";
import { formatEmailDate, formatEmailMoney } from "../email/email.format.js";
import { deriveInvoiceStatus, type NotificationTexts } from "./invoices.domain.js";

/**
 * Pure rules for manually recorded payments (spec §7.6 steps 6 to 8, D-26, D-27, FR-073 to FR-076,
 * BR-14 to BR-16): which invoices take a payment, what a payment may be, what the balance and the
 * status are afterwards, and the words of the history and the customer's notices. Nothing here reads a
 * database, a clock or a request. FixFlow takes no money: a payment is a record of money the business
 * already received, so every sentence says "recorded", never "processed" or "charged".
 */

// ---- Which invoices take a payment (D-27) ----------------------------------------------------------

/** The statuses a payment can be recorded on. */
export const PAYABLE_STATUSES: readonly InvoiceStatus[] = [I.ISSUED, I.PARTIALLY_PAID, I.OVERDUE];

export function isPayable(status: InvoiceStatus): boolean {
  return PAYABLE_STATUSES.includes(status);
}

/** What to say about an invoice that cannot take a payment, by status. */
export const NOT_PAYABLE_MESSAGES: Partial<Record<InvoiceStatus, string>> = {
  [I.DRAFT]: "This invoice is still a draft. Issue it before recording a payment.",
  [I.VOID]: "This invoice was voided, so no payment can be recorded on it.",
  [I.PAID]: "This invoice is already paid in full, so there is nothing left to record.",
};

/** `409 INVOICE_NOT_PAYABLE` unless the invoice is issued, partly paid or overdue. */
export function assertPayable(status: InvoiceStatus): void {
  if (isPayable(status)) {
    return;
  }
  throw conflict(
    NOT_PAYABLE_MESSAGES[status] ??
      `An invoice that is ${invoiceStatusLabel(status).toLowerCase()} cannot take a payment.`,
    { code: ErrorCode.INVOICE_NOT_PAYABLE, details: { currentStatus: status } },
  );
}

// ---- What a payment may be (FR-075) ----------------------------------------------------------------

/** The money still owed once the payments that stand are counted: `total − Σ active payments`. */
export function remainingBalance(totalAmount: string, activeAmounts: readonly string[]): string {
  return balanceDue(totalAmount, sumAmounts(activeAmounts));
}

/**
 * `422 PAYMENT_EXCEEDS_BALANCE`: a payment above what is still owed (FR-075; there are no credit
 * balances). The message is shown beside the amount field and names what is left.
 */
export function paymentExceedsBalanceError(remaining: string, currencyCode: string): AppError {
  const message = `This payment exceeds the remaining balance of ${formatEmailMoney(remaining, currencyCode)}`;
  return new AppError(422, ErrorCode.PAYMENT_EXCEEDS_BALANCE, message, {
    fieldErrors: { amount: message },
    details: { remainingBalance: remaining, currencyCode },
  });
}

export const FUTURE_PAYMENT_DATE_MESSAGE = "The payment date can't be in the future.";

/** `422` on `paymentDate` when it is later than today on the business's calendar (not the browser's). */
export function assertPaymentDateNotFuture(paymentDate: string, now: Date, timeZone: string): void {
  if (paymentDate > dateOnlyInTimeZone(now, timeZone)) {
    throw validation({ paymentDate: FUTURE_PAYMENT_DATE_MESSAGE });
  }
}

// ---- The ledger after recording or voiding (D-26) --------------------------------------------------

/** What the invoice looks like to the money rules. */
export interface PaymentInvoiceFacts {
  issuedAt: Date | null;
  voidedAt: Date | null;
  totalAmount: string;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  now: Date;
  timeZone: string;
  currencyCode: string;
}

export interface LedgerAfter {
  /** The new `amountPaid`: the sum of the payments that stand, which is always the sum of the active ones. */
  amountPaid: string;
  /** What is still owed. */
  balance: string;
  /** What the invoice is now, by the precedence of D-26 (an overdue balance stays overdue). */
  status: InvoiceStatus;
}

/** The paid amount, the balance and the status that follow from these payments standing. */
export function ledgerOf(
  facts: PaymentInvoiceFacts,
  activeAmounts: readonly string[],
): LedgerAfter {
  const amountPaid = sumAmounts(activeAmounts);
  return {
    amountPaid,
    balance: balanceDue(facts.totalAmount, amountPaid),
    status: deriveInvoiceStatus({
      issuedAt: facts.issuedAt,
      voidedAt: facts.voidedAt,
      totalAmount: facts.totalAmount,
      amountPaid,
      dueDate: facts.dueDate,
      now: facts.now,
      timeZone: facts.timeZone,
    }),
  };
}

/**
 * The invoice after a payment is recorded: `422 PAYMENT_EXCEEDS_BALANCE` when it is more than is
 * still owed (judged against the total and the payments that stand, never a stored `amountPaid`),
 * otherwise the new `amountPaid`, balance and status. An exact payment of the balance settles it.
 */
export function ledgerAfterRecording(
  facts: PaymentInvoiceFacts,
  activeAmounts: readonly string[],
  amount: string,
): LedgerAfter {
  const remaining = remainingBalance(facts.totalAmount, activeAmounts);
  if (!isPositiveAmount(amount)) {
    throw validation({ amount: "The amount must be more than zero." });
  }
  if (isAmountAbove(amount, remaining)) {
    throw paymentExceedsBalanceError(remaining, facts.currencyCode);
  }
  return ledgerOf(facts, [...activeAmounts, amount]);
}

/**
 * The invoice after one of its payments is voided: the payments that stand are the others, so the
 * balance goes up by that amount and the status falls back (`PAID` to `PARTIALLY_PAID`, `ISSUED` or
 * `OVERDUE`, whichever the money and the due date say).
 */
export function ledgerAfterVoiding(
  facts: PaymentInvoiceFacts,
  remainingActiveAmounts: readonly string[],
): LedgerAfter {
  return ledgerOf(facts, remainingActiveAmounts);
}

// ---- Errors for voiding a payment (BR-16) ------------------------------------------------------------

/** `409 PAYMENT_ALREADY_VOIDED`: a payment is voided once; the record stays as it is. */
export function paymentAlreadyVoidedError(): AppError {
  return conflict("This payment was already voided.", {
    code: ErrorCode.PAYMENT_ALREADY_VOIDED,
  });
}

/** `409`: the invoice itself was voided, so its payments can no longer change. */
export function invoiceVoidedPaymentsError(): AppError {
  return conflict("This invoice was voided, so its payments can no longer be changed.", {
    code: ErrorCode.INVALID_STATE_TRANSITION,
    details: { currentStatus: I.VOID },
  });
}

// ---- The words of the history and the notifications ---------------------------------------------------

export interface PaymentWords {
  amount: string;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  paymentDate: string;
  method: PaymentMethod;
}

function money(amount: string, currencyCode: string): string {
  return formatEmailMoney(amount, currencyCode);
}

/**
 * The history sentences. The reference and notes the staff typed are not inputs, so they cannot reach
 * a sentence, a customer or a log (BR-19, SEC-DATA-03).
 */
export function paymentRecordedTexts(input: PaymentWords): { staff: string; customer: string } {
  const amount = money(input.amount, input.currencyCode);
  const date = formatEmailDate(input.paymentDate);
  return {
    staff: `recorded a payment of ${amount} received on ${date} (${paymentMethodLabel(input.method)})`,
    customer: `recorded your payment of ${amount} received on ${date}`,
  };
}

export function paymentVoidedTexts(input: PaymentWords & { balance: string }): {
  staff: string;
  customer: string;
} {
  const amount = money(input.amount, input.currencyCode);
  const date = formatEmailDate(input.paymentDate);
  return {
    staff: `voided the payment of ${amount} received on ${date}`,
    customer: `reversed the payment record of ${amount} dated ${date}, so the balance due is now ${money(input.balance, input.currencyCode)}`,
  };
}

/** What the customer is told in the app when a payment is recorded. No method, reference or note. */
export function paymentRecordedNotification(input: {
  invoiceNumber: string;
  serviceName: string;
  amount: string;
  currencyCode: string;
  paymentDate: string;
  balance: string;
}): NotificationTexts {
  const settled = !isPositiveAmount(input.balance);
  return {
    title: `Payment recorded for invoice ${input.invoiceNumber}`,
    message: `We recorded a payment of ${money(input.amount, input.currencyCode)} received on ${formatEmailDate(input.paymentDate)} for ${input.serviceName}. ${
      settled
        ? "The invoice is now paid in full."
        : `The balance due is ${money(input.balance, input.currencyCode)}.`
    }`,
  };
}

/**
 * The customer's notice that a payment record was reversed, because their balance went back up. The
 * internal reason is not an input, so it cannot be passed.
 */
export function paymentVoidedNotification(input: {
  invoiceNumber: string;
  serviceName: string;
  amount: string;
  currencyCode: string;
  paymentDate: string;
  balance: string;
}): NotificationTexts {
  return {
    title: `A payment record on invoice ${input.invoiceNumber} was reversed`,
    message: `We reversed the payment record of ${money(input.amount, input.currencyCode)} dated ${formatEmailDate(input.paymentDate)} for ${input.serviceName}. The balance due is now ${money(input.balance, input.currencyCode)}.`,
  };
}
