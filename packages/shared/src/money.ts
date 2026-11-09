import { Decimal } from "decimal.js";

import type { FieldErrors } from "./api.js";
import { LIMITS } from "./limits.js";

/**
 * The one calculation of a quotation's (and, in T20, an invoice's) totals, D-19. The server runs it
 * to decide what is stored and the editor runs it for the live preview, so what the admin sees while
 * typing and what the server stores can only differ if the inputs do. Money is never a JavaScript
 * number: amounts go in and come out as decimal strings, and every sum and product is `decimal.js`.
 *
 * 1. `lineSubtotal = round(quantity × unitPrice)`; `subtotal` is their sum and `taxableSubtotal` the
 *    sum of the taxable lines.
 * 2. `discountAmount` is one fixed amount for the document, from `0` up to `subtotal`.
 * 3. The discount is spread over the lines in proportion, so only the taxable share of it lowers the
 *    taxable base: `taxableBase = round(taxableSubtotal − discount × taxableSubtotal ÷ subtotal)`
 *    (`0` when the subtotal is `0`).
 * 4. `taxAmount = round(taxableBase × taxRate ÷ 100)` and `totalAmount = subtotal − discount + tax`.
 *
 * Every `round` is to 2 decimal places, half up (D-18).
 */

// A private constructor, so the settings here never leak into (or from) other users of decimal.js.
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof Dec>;

const MONEY_PLACES = 2;

function round(value: Dec): Dec {
  return value.toDecimalPlaces(MONEY_PLACES, Decimal.ROUND_HALF_UP);
}

/** One line as the editor holds it: every number is the text typed or stored, never a float. */
export interface DocumentLineInput {
  /** Greater than zero, at most 2 decimal places: `"1"`, `"1.5"`. */
  quantity: string;
  /** Zero or more, at most 2 decimal places: `"85.00"`. */
  unitPrice: string;
  taxable: boolean;
}

export interface DocumentTotalsInput {
  lines: readonly DocumentLineInput[];
  /** One fixed amount for the whole document. */
  discountAmount: string;
  /** A percentage: `"8.00"` means 8 %. */
  taxRate: string;
}

/** Decimal strings with exactly two decimal places. */
export interface DocumentTotalsResult {
  /** One entry per input line, in the same order. */
  lines: { lineSubtotal: string }[];
  subtotal: string;
  taxableSubtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  totalAmount: string;
}

/** The inputs are outside the limits of {@link LIMITS}. `fieldErrors` names each offending field. */
export class DocumentTotalsError extends Error {
  readonly fieldErrors: FieldErrors;

  constructor(fieldErrors: FieldErrors) {
    super("The document's lines, discount or tax rate are outside the allowed limits.");
    this.name = "DocumentTotalsError";
    this.fieldErrors = fieldErrors;
  }
}

/** The largest amount a stored document can hold (`Decimal(12,2)`). */
const MAX_AMOUNT = new Dec(LIMITS.documentAmount.max);

/** Digits, with at most two after the point: `"2"`, `"2.5"`, `"2.50"`. No sign, no exponent, no spaces. */
const DECIMAL_TEXT = /^\d+(\.\d+)?$/;

type ParseResult = { ok: true; value: Dec } | { ok: false; message: string };

function parseAmount(raw: unknown, what: string): ParseResult {
  if (typeof raw !== "string" || !DECIMAL_TEXT.test(raw.trim())) {
    return { ok: false, message: `Enter ${what} as a number, for example 2 or 2.50.` };
  }
  const text = raw.trim();
  const fraction = text.split(".")[1];
  if (fraction !== undefined && fraction.length > MONEY_PLACES) {
    return { ok: false, message: `Use at most ${MONEY_PLACES} decimal places.` };
  }
  return { ok: true, value: new Dec(text) };
}

function inRange(value: Dec, min: string, max: string): boolean {
  return value.gte(min) && value.lte(max);
}

function groupedLimit(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

interface ParsedInput {
  quantities: Dec[];
  prices: Dec[];
  discount: Dec | undefined;
  taxRate: Dec | undefined;
}

/**
 * Parses and checks everything that can be checked on its own, collecting a message per field (the
 * rules that need a total, such as "the discount is at most the subtotal", come after the sums).
 */
function parseInput(input: DocumentTotalsInput): { parsed: ParsedInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const quantities: Dec[] = [];
  const prices: Dec[] = [];

  const { min, max } = LIMITS.lineItems;
  if (input.lines.length < min || input.lines.length > max) {
    errors.lines = `Add between ${min} and ${max} lines.`;
  }

  input.lines.forEach((line, index) => {
    const quantity = parseAmount(line.quantity, "a quantity");
    if (!quantity.ok) {
      errors[`lines.${index}.quantity`] = quantity.message;
    } else if (!inRange(quantity.value, LIMITS.quantity.min, LIMITS.quantity.max)) {
      errors[`lines.${index}.quantity`] =
        `Enter a quantity from ${LIMITS.quantity.min} to ${groupedLimit(LIMITS.quantity.max)}.`;
    } else {
      quantities[index] = quantity.value;
    }

    const price = parseAmount(line.unitPrice, "a price");
    if (!price.ok) {
      errors[`lines.${index}.unitPrice`] = price.message;
    } else if (!inRange(price.value, LIMITS.unitPrice.min, LIMITS.unitPrice.max)) {
      errors[`lines.${index}.unitPrice`] =
        `Enter a price from ${LIMITS.unitPrice.min} to ${groupedLimit(LIMITS.unitPrice.max)}.`;
    } else {
      prices[index] = price.value;
    }
  });

  let discount: Dec | undefined;
  const parsedDiscount = parseAmount(input.discountAmount, "a discount");
  if (!parsedDiscount.ok) {
    errors.discountAmount = parsedDiscount.message;
  } else if (parsedDiscount.value.lt(LIMITS.discount.min)) {
    errors.discountAmount = `Enter a discount of ${LIMITS.discount.min} or more.`;
  } else {
    discount = parsedDiscount.value;
  }

  let taxRate: Dec | undefined;
  const parsedRate = parseAmount(input.taxRate, "a tax rate");
  if (!parsedRate.ok) {
    errors.taxRate = parsedRate.message;
  } else if (!inRange(parsedRate.value, LIMITS.taxRate.min, LIMITS.taxRate.max)) {
    errors.taxRate = `Enter a tax rate from ${LIMITS.taxRate.min} to ${LIMITS.taxRate.max}.`;
  } else {
    taxRate = parsedRate.value;
  }

  return { parsed: { quantities, prices, discount, taxRate }, errors };
}

function twoPlaces(value: Dec): string {
  return value.toFixed(MONEY_PLACES, Decimal.ROUND_HALF_UP);
}

/**
 * The totals of a document, or the reasons the inputs cannot be used.
 *
 * Returns `{ ok: false, fieldErrors }` for a quantity, price, discount or tax rate that is not a
 * number within the limits, for a number of lines outside 1 to 50, for a discount larger than the
 * subtotal and for a document too large to store. `fieldErrors` keys are the ones the API answers
 * with (`lines.2.quantity`, `discountAmount`, `taxRate`), so the editor can show each next to its field.
 */
export function tryCalculateDocumentTotals(
  input: DocumentTotalsInput,
): { ok: true; totals: DocumentTotalsResult } | { ok: false; fieldErrors: FieldErrors } {
  const { parsed, errors } = parseInput(input);
  if (Object.keys(errors).some((key) => key !== "discountAmount" && key !== "taxRate")) {
    // A line cannot be added up, so neither can the rules that depend on the sum.
    return { ok: false, fieldErrors: errors };
  }

  const lineSubtotals = input.lines.map((line, index) => {
    const quantity = parsed.quantities[index];
    const price = parsed.prices[index];
    if (quantity === undefined || price === undefined) {
      throw new Error("Unreachable: every line was parsed without an error.");
    }
    return { taxable: line.taxable, amount: round(quantity.times(price)) };
  });

  const subtotal = lineSubtotals.reduce((sum, line) => sum.plus(line.amount), new Dec(0));
  const taxableSubtotal = lineSubtotals
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum.plus(line.amount), new Dec(0));

  if (subtotal.gt(MAX_AMOUNT)) {
    errors.lines = `The lines add up to more than ${groupedLimit(LIMITS.documentAmount.max)}.`;
  }
  if (parsed.discount !== undefined && parsed.discount.gt(subtotal)) {
    errors.discountAmount = `The discount can't be more than the subtotal (${twoPlaces(subtotal)}).`;
  }
  if (
    Object.keys(errors).length > 0 ||
    parsed.discount === undefined ||
    parsed.taxRate === undefined
  ) {
    return { ok: false, fieldErrors: errors };
  }

  const discount = parsed.discount;
  // The discount is spread over the lines in proportion, so the taxable lines carry their share of
  // it: `taxable − discount × taxable ÷ subtotal`, written with one division and no rounding in between.
  const taxableBase = subtotal.isZero()
    ? new Dec(0)
    : round(taxableSubtotal.times(subtotal.minus(discount)).div(subtotal));
  const taxAmount = round(taxableBase.times(parsed.taxRate).div(100));
  const totalAmount = subtotal.minus(discount).plus(taxAmount);

  return {
    ok: true,
    totals: {
      lines: lineSubtotals.map((line) => ({ lineSubtotal: twoPlaces(line.amount) })),
      subtotal: twoPlaces(subtotal),
      taxableSubtotal: twoPlaces(taxableSubtotal),
      discountAmount: twoPlaces(discount),
      taxableBase: twoPlaces(taxableBase),
      taxAmount: twoPlaces(taxAmount),
      totalAmount: twoPlaces(totalAmount),
    },
  };
}

/**
 * The totals of a document (D-19). Throws {@link DocumentTotalsError} when the inputs are outside the
 * limits; use {@link tryCalculateDocumentTotals} where that is an expected outcome (a form being typed).
 */
export function calculateDocumentTotals(input: DocumentTotalsInput): DocumentTotalsResult {
  const result = tryCalculateDocumentTotals(input);
  if (!result.ok) {
    throw new DocumentTotalsError(result.fieldErrors);
  }
  return result.totals;
}

/** `"8.00"` → `"8"`, `"8.25"` → `"8.25"`: a tax rate for a label, without trailing zeros. */
export function formatTaxRate(rate: string): string {
  const trimmed = rate.trim();
  if (!DECIMAL_TEXT.test(trimmed)) {
    return trimmed;
  }
  return new Dec(trimmed).toString();
}

/** True when the decimal string is greater than zero; decides things such as "can this be sent" without a float. */
export function isPositiveAmount(amount: string): boolean {
  return DECIMAL_TEXT.test(amount.trim()) && new Dec(amount.trim()).gt(0);
}

/**
 * What is still owed on an invoice: `totalAmount − amountPaid`, a decimal string with two places
 * (D-26). Recorded payments can never exceed the total (a database check), so it is never negative
 * for a stored invoice; the function does not hide a negative result if it is ever handed one.
 */
export function balanceDue(totalAmount: string, amountPaid: string): string {
  return new Dec(totalAmount.trim()).minus(new Dec(amountPaid.trim())).toFixed(MONEY_PLACES);
}

// ---- Payments (D-27, FR-073, FR-075) -----------------------------------------------------------------

export const PAYMENT_AMOUNT_NOT_A_NUMBER =
  "Enter the amount as a number above zero, for example 120 or 120.50.";
export const PAYMENT_AMOUNT_NOT_POSITIVE = "The amount must be more than zero.";
export const PAYMENT_AMOUNT_TOO_PRECISE = "Use at most 2 decimal places.";

/**
 * Reads an amount typed for a payment: digits with at most two places after the point, above zero,
 * and small enough to be stored. Returns it with exactly two places (`"120"` → `"120.00"`). A sign, an
 * exponent, a thousands separator, spaces inside the number and anything that is not text are refused
 * with a message for the field. Whether it fits the invoice's balance is a separate question
 * ({@link isAmountAbove}), because it depends on the invoice.
 */
export function parsePaymentAmount(
  raw: unknown,
): { ok: true; amount: string } | { ok: false; message: string } {
  if (typeof raw !== "string" || !DECIMAL_TEXT.test(raw.trim())) {
    return { ok: false, message: PAYMENT_AMOUNT_NOT_A_NUMBER };
  }
  const text = raw.trim();
  const fraction = text.split(".")[1];
  if (fraction !== undefined && fraction.length > MONEY_PLACES) {
    return { ok: false, message: PAYMENT_AMOUNT_TOO_PRECISE };
  }
  const value = new Dec(text);
  if (!value.gte(LIMITS.paymentAmount.min)) {
    return { ok: false, message: PAYMENT_AMOUNT_NOT_POSITIVE };
  }
  if (value.gt(MAX_AMOUNT)) {
    return {
      ok: false,
      message: `Enter an amount up to ${groupedLimit(LIMITS.documentAmount.max)}.`,
    };
  }
  return { ok: true, amount: value.toFixed(MONEY_PLACES) };
}

/** The sum of decimal strings, with two places (`"0.00"` for none): never a float. */
export function sumAmounts(amounts: readonly string[]): string {
  return amounts
    .reduce((sum, amount) => sum.plus(new Dec(amount.trim())), new Dec(0))
    .toFixed(MONEY_PLACES);
}

/** True when `amount` is greater than `limit`: whether a payment is more than the balance. */
export function isAmountAbove(amount: string, limit: string): boolean {
  return new Dec(amount.trim()).gt(new Dec(limit.trim()));
}
