import { isHttpsUrl, LIMITS } from "@fixflow/shared";
import { z } from "zod";

import { normalizeEmail } from "./email-address.js";

/**
 * Field builders for request bodies that carry business text (settings, the service catalogue).
 * They give people-readable messages, because the web app shows the API's message beside the field
 * (`fieldErrors`, D-33). Every text is trimmed; an optional text that is blank becomes `null`, which
 * is how a field is cleared.
 *
 * Optional fields use `.nullable()` and not a union with `z.null()`: a union reports one generic
 * message for all its branches, whereas `.nullable()` lets the text's own message through.
 */

/** Line feed, carriage return and the Unicode line and paragraph separators. */
const LINE_BREAK = /[\r\n\p{Zl}\p{Zp}]/u;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTER = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

interface TextOptions {
  min?: number;
  max: number;
  /** Allow line breaks (descriptions, terms). Single-line fields refuse them. */
  multiline?: boolean;
}

function textBase(label: string, { min = 1, max, multiline = false }: TextOptions) {
  const base = z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .max(max, `The ${label} must be ${max} characters or fewer.`)
    .refine((value) => !CONTROL_CHARACTER.test(value), `The ${label} contains invalid characters.`)
    .refine(
      (value) => multiline || !LINE_BREAK.test(value),
      `The ${label} must be on a single line.`,
    );
  return min > 0
    ? base.refine(
        (value) => value.length >= min,
        min <= 1 ? `Enter the ${label}.` : `The ${label} must be at least ${min} characters.`,
      )
    : base;
}

/** Required text, trimmed, with a length range. `label` reads in a sentence: "business name". */
export function requiredText(label: string, options: TextOptions) {
  return textBase(label, options);
}

/** Optional text: blank or `null` clears it, otherwise it is trimmed and length-checked. */
export function optionalText(label: string, options: Omit<TextOptions, "min">) {
  return textBase(label, { ...options, min: 0 })
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

/** A required email address, trimmed and lower-cased (the one spelling that is stored, FR-032). */
export function emailAddress(label: string) {
  return z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(LIMITS.email.maxLength, `The ${label} is too long.`)
    .transform(normalizeEmail)
    .pipe(z.email(`Enter a valid ${label}, like name@example.com.`));
}

// The address rule lives in `@fixflow/shared`, where the web forms use the same function.
export { isHttpsUrl };

/** An optional `https://` address (a logo or a picture shown on web pages). Blank or `null` clears it. */
export function optionalHttpsUrl(label: string, maxLength: number) {
  return optionalText(label, { max: maxLength }).refine(
    (value) => value === null || isHttpsUrl(value),
    `The ${label} must be a web address starting with https://`,
  );
}

/**
 * An optional choice from a fixed list of keys (a bundled logo or picture). Blank or `null` clears
 * it; anything that is not on the list is refused, so a path or a URL can never be stored as a key.
 */
export function optionalKey(isKey: (value: string) => boolean, message: string) {
  return z
    .string({ error: message })
    .refine((value) => value === "" || isKey(value), message)
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

/** A decimal string with at most two places, such as `"8"`, `"8.5"` or `"129.00"`. */
export const DECIMAL_2DP = /^\d{1,7}(\.\d{1,2})?$/;

/** `"8"` → `"8.00"`, `"8.5"` → `"8.50"`. Only call it with text that matches {@link DECIMAL_2DP}. */
export function toTwoPlaces(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

/**
 * A list filter that takes one or several values of an enum, as repeated parameters
 * (`status=A&status=B`) or comma-separated (`status=A,B`), so a link in the address bar and a form
 * can both express it. Blank entries are ignored and repeats collapse; when nothing is left there is
 * no filter. A value outside the enum is `422`, named in the message.
 */
export function enumListFilter<const Values extends readonly [string, ...string[]]>(
  values: Values,
  name: string,
) {
  return z.preprocess(
    (value) => {
      if (value === undefined) {
        return undefined;
      }
      const parts = (Array.isArray(value) ? value : [value])
        .flatMap((entry: unknown) => (typeof entry === "string" ? entry.split(",") : [entry]))
        .map((entry: unknown) => (typeof entry === "string" ? entry.trim() : entry))
        .filter((entry) => entry !== "");
      return parts.length === 0 ? undefined : [...new Set(parts)];
    },
    z
      .array(z.enum(values, { error: `${name} must be one or more of: ${values.join(", ")}.` }))
      .optional(),
  );
}
