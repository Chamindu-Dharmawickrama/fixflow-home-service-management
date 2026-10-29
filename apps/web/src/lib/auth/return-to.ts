/** Pages that must never be a sign-in destination: sending someone back to them would loop. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

/** An origin that is never real, only used to ask the URL parser what a path resolves to. */
const PROBE_ORIGIN = "http://fixflow.invalid";

// Control characters and whitespace. Browsers strip tabs and newlines from URLs, so "/\t/evil.test"
// would become "//evil.test", a protocol-relative link to another site.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARACTERS = /[\x00-\x20\x7f-\x9f]/;

/**
 * Makes a `returnTo` value safe to redirect to after sign-in (an open-redirect defence). Only a
 * path on this site is accepted: it must start with a single `/`, must contain no backslash
 * (browsers read `/\evil.test` as `//evil.test`), no control characters, and must still resolve to
 * this origin after parsing. Anything else, including absolute URLs (`https://evil.test`),
 * protocol-relative URLs (`//evil.test`), other schemes (`javascript:`) and the auth pages
 * themselves, returns `fallback`.
 */
export function sanitizeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value === "" || value.length > 2000) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes("\\") || UNSAFE_CHARACTERS.test(value)) {
    return fallback;
  }
  // An encoded backslash or slash can be decoded into the forms rejected above by a later hop.
  if (/%(5c|2f|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value.split("?")[0] ?? "")) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (
    url.origin !== PROBE_ORIGIN ||
    !url.pathname.startsWith("/") ||
    url.pathname.startsWith("//")
  ) {
    return fallback;
  }
  if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
