import { LIMITS } from "./limits.js";

/**
 * Format checks for business contact details (FR-100). The API applies them as the authority and the
 * settings form runs the very same functions for early feedback, so what the form accepts and what
 * the server accepts cannot drift apart.
 */

/**
 * A phone number as people write it: an optional leading `+`, then digits with spaces, dots,
 * hyphens and brackets, and 7 to 15 digits in all (the E.164 maximum). Extensions and letters are
 * not accepted, because the number is shown on the website and in emails as it is stored.
 */
export function isValidPhone(value: string): boolean {
  const { minDigits, maxDigits, maxLength } = LIMITS.businessSettings.phone;
  if (value.length > maxLength || !/^\+?[\d\s().-]+$/.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/g, "").length;
  return digits >= minDigits && digits <= maxDigits;
}

/**
 * Tidies a customer's phone number for storage: leading and trailing spaces go and every run of
 * whitespace becomes one space. The punctuation is kept, because the number is shown as it is stored.
 */
export function normalizeCustomerPhone(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * A customer's phone number as people write it: an optional leading `+`, then digits with spaces,
 * hyphens and brackets, 7 to 20 characters in all with 7 to 15 digits. Call it with a value that
 * went through {@link normalizeCustomerPhone}. Letters, dots and extensions are not accepted.
 */
export function isValidCustomerPhone(value: string): boolean {
  const { minLength, maxLength, minDigits, maxDigits } = LIMITS.customerPhone;
  // The pattern allows a `+` only as the first character.
  if (value.length < minLength || value.length > maxLength || !/^\+?[\d\s()-]+$/.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/g, "").length;
  return digits >= minDigits && digits <= maxDigits;
}

/** Letters, digits, spaces and hyphens, starting with a letter or digit (`10999`, `SW1A 1AA`, `K1A-0B1`). */
export function isValidPostalCode(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(value);
}

/**
 * True for a plain `https://` address with a host name that contains a dot, and no embedded
 * credentials or whitespace. Used for the logo and service pictures, which are only ever shown on
 * web pages: the server never fetches them (D-30). `javascript:`, `data:`, plain `http:` and
 * protocol-relative addresses are all refused.
 */
export function isHttpsUrl(value: string): boolean {
  if (value !== value.trim() || /\s/.test(value)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.includes(".") &&
    url.username === "" &&
    url.password === ""
  );
}

/**
 * True for a tax-rate string from `0` to `100`. Compared as digits, not as a float: `100.01` is
 * out, `100.00` is in. Call it with text that already matches the two-decimal pattern.
 */
export function isTaxRateInRange(value: string): boolean {
  const [whole = "", fraction = ""] = value.split(".");
  const wholeNumber = Number(whole);
  if (wholeNumber < 100) {
    return true;
  }
  return wholeNumber === 100 && /^0*$/.test(fraction);
}
