import { LIMITS } from "@fixflow/shared";

/**
 * Email addresses are stored trimmed and lower-case, and the database refuses anything else
 * (`users_email_normalized_chk`), which is what makes the unique index case-insensitive (FR-032).
 * Every email that comes from a request, the environment or Google goes through here first.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A pragmatic shape check (one `@`, a dotted domain, no spaces). Real validity is proven by
 * delivering mail, not by a regular expression, so this stays deliberately simple.
 */
export function looksLikeEmail(value: string): boolean {
  return (
    value.length <= LIMITS.email.maxLength && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim())
  );
}

/**
 * Parses a comma-separated list such as `ADMIN_EMAILS`: normalized, de-duplicated, blanks dropped.
 * Returns `invalid` entries separately so the caller can name the variable without echoing values.
 */
export function parseEmailList(value: string | undefined): { emails: string[]; invalid: number } {
  const emails = new Set<string>();
  let invalid = 0;
  for (const part of (value ?? "").split(",")) {
    const email = normalizeEmail(part);
    if (email === "") continue;
    if (looksLikeEmail(email)) {
      emails.add(email);
    } else {
      invalid += 1;
    }
  }
  return { emails: [...emails], invalid };
}

/** The domain of an address, lower-cased, or `undefined` when there is no `@`. */
export function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  return at === -1 ? undefined : email.slice(at + 1).toLowerCase();
}

/** `alex.morgan@example.test` → `a***@example.test`, for logs and delivery records (BR-22). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
