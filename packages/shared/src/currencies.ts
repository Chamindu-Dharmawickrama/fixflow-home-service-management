/**
 * Currencies a business may be configured with (D-18). Money is stored and calculated with two
 * decimal places, so only ISO 4217 currencies whose minor unit is 1/100 are on the list: the
 * zero-decimal currencies (JPY, KRW, VND, ...) and the three-decimal ones (KWD, BHD, ...) would
 * make "round half-up to 2 dp" wrong, so they are deliberately absent.
 *
 * The list is an allowlist, not a statement about which currencies are common: a currency can be
 * added here once the product is checked with it. A unit test asserts that every entry really has
 * two decimals according to the runtime's own currency data. That is why the Pakistani rupee is
 * absent: ISO 4217 gives it two decimals but the CLDR data behind `Intl` formats it with none, and
 * an amount must never be shown with fewer places than it is stored with.
 */
export const SUPPORTED_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "AED", name: "UAE dirham" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "QAR", name: "Qatari riyal" },
  { code: "ZAR", name: "South African rand" },
  { code: "INR", name: "Indian rupee" },
  { code: "LKR", name: "Sri Lankan rupee" },
  { code: "BDT", name: "Bangladeshi taka" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "THB", name: "Thai baht" },
  { code: "PHP", name: "Philippine peso" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "MXN", name: "Mexican peso" },
  { code: "BRL", name: "Brazilian real" },
  { code: "PLN", name: "Polish zloty" },
  { code: "CZK", name: "Czech koruna" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "ILS", name: "Israeli shekel" },
  { code: "EGP", name: "Egyptian pound" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "NGN", name: "Nigerian naira" },
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

const CURRENCY_CODES: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES.map(({ code }) => code));

/** True for the three-letter, upper-case code of a supported currency. */
export function isSupportedCurrency(value: unknown): value is SupportedCurrencyCode {
  return typeof value === "string" && CURRENCY_CODES.has(value);
}
