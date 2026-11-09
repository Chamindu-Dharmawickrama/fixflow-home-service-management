import {
  type FieldErrors,
  isAmountAbove,
  isDateOnly,
  LIMITS,
  parsePaymentAmount,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  type RecordPaymentBody,
  sumAmounts,
} from "@fixflow/shared";

import { formatMoney } from "@/lib/formatting/money";

/**
 * The record-payment form's own rules (FR-073, FR-075, D-27). They only decide what to tell the
 * person before they send: the server judges the same things again under the invoice's lock, and its
 * answer is what is final. FixFlow takes no payment; every word here says "record".
 */

export type PaymentField = "amount" | "paymentDate" | "method" | "reference" | "notes";
export type PaymentFormErrors = Partial<Record<PaymentField, string>>;

export interface PaymentFormValues {
  /** As typed: `"120"`, `"120.50"`. */
  amount: string;
  /** `YYYY-MM-DD`. */
  paymentDate: string;
  method: PaymentMethod | "";
  reference: string;
  notes: string;
}

/** The choices of the method select, in the order a small business meets them. */
export const PAYMENT_METHOD_OPTIONS: readonly { value: PaymentMethod; label: string }[] = [
  PaymentMethod.CASH,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CARD_TERMINAL,
  PaymentMethod.CHEQUE,
  PaymentMethod.OTHER,
].map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));

export const PAYMENT_HELPER_TEXT = "Record only payments you've actually received outside FixFlow.";
export const PAYMENT_SENSITIVE_WARNING = "Don't enter card numbers or bank login details.";
export const METHOD_REQUIRED = "Choose how the payment was received.";
export const DATE_REQUIRED = "Choose the date the payment was received.";
export const DATE_IN_FUTURE = "The payment date can't be in the future.";
export const AMOUNT_REQUIRED = "Enter the amount received.";

/** What the server says when a payment is more than is owed; the form says the same before sending. */
export function exceedsBalanceMessage(balanceDue: string, currencyCode: string): string {
  return `This payment exceeds the remaining balance of ${formatMoney(balanceDue, currencyCode)}`;
}

/** A new payment: the whole balance, received today on the business's calendar, method still to choose. */
export function initialPaymentValues(balanceDue: string, today: string): PaymentFormValues {
  return { amount: balanceDue, paymentDate: today, method: "", reference: "", notes: "" };
}

/**
 * What is wrong with the form, field by field (empty when it can be sent). `today` is the business's
 * date, never the browser's, and `balanceDue` is the balance the page showed.
 */
export function validatePaymentForm(
  values: PaymentFormValues,
  context: { balanceDue: string; currencyCode: string; today: string },
): PaymentFormErrors {
  const errors: PaymentFormErrors = {};

  if (values.amount.trim() === "") {
    errors.amount = AMOUNT_REQUIRED;
  } else {
    const parsed = parsePaymentAmount(values.amount);
    if (!parsed.ok) {
      errors.amount = parsed.message;
    } else if (isAmountAbove(parsed.amount, context.balanceDue)) {
      errors.amount = exceedsBalanceMessage(context.balanceDue, context.currencyCode);
    }
  }

  if (values.paymentDate === "" || !isDateOnly(values.paymentDate)) {
    errors.paymentDate = DATE_REQUIRED;
  } else if (values.paymentDate > context.today) {
    errors.paymentDate = DATE_IN_FUTURE;
  }

  if (values.method === "") {
    errors.method = METHOD_REQUIRED;
  }

  if (values.reference.trim().length > LIMITS.payment.reference.maxLength) {
    errors.reference = `The reference must be ${LIMITS.payment.reference.maxLength} characters or fewer.`;
  }
  if (values.notes.trim().length > LIMITS.payment.notes.maxLength) {
    errors.notes = `The notes must be ${LIMITS.payment.notes.maxLength} characters or fewer.`;
  }
  return errors;
}

/** The request body for a form that has passed {@link validatePaymentForm}. */
export function toRecordPaymentBody(values: PaymentFormValues): RecordPaymentBody {
  if (values.method === "") {
    throw new Error("A payment needs a method before it is sent.");
  }
  const reference = values.reference.trim();
  const notes = values.notes.trim();
  return {
    amount: values.amount.trim(),
    paymentDate: values.paymentDate,
    method: values.method,
    reference: reference === "" ? null : reference,
    notes: notes === "" ? null : notes,
  };
}

const FIELDS: readonly PaymentField[] = ["amount", "paymentDate", "method", "reference", "notes"];

/** The server's `fieldErrors` keyed by form field; anything else comes back as `loose` for the banner. */
export function splitServerPaymentErrors(fieldErrors: FieldErrors | undefined): {
  fields: PaymentFormErrors;
  loose: string[];
} {
  const fields: PaymentFormErrors = {};
  const loose: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    const field = FIELDS.find((candidate) => candidate === path);
    if (field === undefined) {
      loose.push(message);
    } else {
      fields[field] = message;
    }
  }
  return { fields, loose };
}

/** The field to put the cursor in first: the order the person meets them. */
export function firstPaymentFieldWithMessage(errors: PaymentFormErrors): PaymentField | null {
  return FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

/** Words for the void dialog: the consequence is stated in the amounts, before it happens. */
export function voidPaymentConsequence(input: {
  amount: string;
  balanceDue: string;
  currencyCode: string;
}): { raises: string; newBalance: string } {
  return {
    raises: formatMoney(input.amount, input.currencyCode),
    newBalance: formatMoney(sumAmounts([input.balanceDue, input.amount]), input.currencyCode),
  };
}
