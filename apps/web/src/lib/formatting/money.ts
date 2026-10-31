import { FORMAT_LOCALE } from "./locale";

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currencyCode: string): Intl.NumberFormat {
  let formatter = formatters.get(currencyCode);
  if (!formatter) {
    formatter = new Intl.NumberFormat(FORMAT_LOCALE, {
      style: "currency",
      currency: currencyCode,
      // A negative amount shows its sign, but zero (including "-0.00") never does.
      signDisplay: "negative",
    });
    formatters.set(currencyCode, formatter);
  }
  return formatter;
}

/**
 * Formats a decimal-string amount from the API (`"1284.50"`) with an explicit currency code.
 *
 * The string goes straight into `Intl.NumberFormat`, which reads it as an exact decimal, so there
 * is no `Number()` conversion and no floating-point error even for amounts beyond 2^53. Rounding to
 * the currency's minor units is the formatter's (half away from zero); the API has already rounded
 * every stored amount to 2 dp (D-18), so this only matters for currencies with other precision.
 */
export function formatMoney(amount: string, currencyCode: string): string {
  if (!DECIMAL_STRING.test(amount)) {
    throw new RangeError(`Expected a decimal string such as "1284.50", received "${amount}".`);
  }
  if (!CURRENCY_CODE.test(currencyCode)) {
    throw new RangeError(
      `Expected an ISO 4217 currency code such as "USD", received "${currencyCode}".`,
    );
  }
  // `Intl.NumberFormat#format` accepts exact decimal strings; its typings only admit this template type.
  return currencyFormatter(currencyCode).format(amount as `${number}`);
}

/**
 * True for a decimal string with no value in it (`"0"`, `"0.00"`, `"-0.00"`). Money stays a string all
 * the way to the screen (CLAUDE.md §9), so "is anything there" is asked of the text, not of a number.
 */
export function isZeroAmount(amount: string): boolean {
  return !/[1-9]/.test(amount);
}

/** True when the string is a decimal amount `formatMoney` accepts. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_STRING.test(value);
}
