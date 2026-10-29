import { isSafeAppPath } from "@fixflow/shared";

import { emailDomain } from "../../lib/email-address.js";

/**
 * Domains that can never receive mail (RFC 2606, RFC 6761 and the mDNS `.local`). Mail for them is
 * always written to the log transport, whatever `EMAIL_TRANSPORT` says (D-52), which covers the
 * seeded demo accounts without a demo-wide allowlist.
 */
const RESERVED_DOMAINS = [
  "test",
  "example",
  "invalid",
  "localhost",
  "local",
  "example.com",
  "example.net",
  "example.org",
] as const;

/** True when the address belongs to a reserved, undeliverable domain or one of its subdomains. */
export function isReservedEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (domain === undefined || domain === "") {
    return false;
  }
  return RESERVED_DOMAINS.some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  );
}

/**
 * The absolute link to an app page for use in an email: `PUBLIC_WEB_URL` (an origin without a
 * trailing slash) plus a validated `/app/...` or `/portal/...` path. Throws for anything else, so
 * an email can only ever link into this app.
 */
export function absoluteAppUrl(publicWebUrl: string, linkPath: string): string {
  if (!isSafeAppPath(linkPath)) {
    throw new TypeError("An email link must be a relative path starting with /app/ or /portal/.");
  }
  return `${publicWebUrl}${linkPath}`;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Removes line breaks (including the Unicode line and paragraph separators) so a value can never
 * add or split a header line.
 */
export function singleLine(value: string): string {
  return value.replace(/[\r\n\p{Zl}\p{Zp}]+/gu, " ").trim();
}
