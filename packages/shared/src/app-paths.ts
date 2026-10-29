/**
 * Links inside the FixFlow web app (notifications, emails). The server refuses to store anything
 * else and the web app checks again before it navigates, so a notification can never send someone
 * to another site (open redirect) or to a script URL.
 */

/** The two signed-in areas a notification or email may link into. */
const APP_AREAS = ["/app", "/portal"] as const;

/** Generous for a path with a query string; the database column is unbounded `text`. */
const MAX_APP_PATH_LENGTH = 300;

/** An origin that is never real, only used to ask the URL parser what a path resolves to. */
const PROBE_ORIGIN = "http://fixflow.invalid";

// Control characters, spaces and the C1 range. Browsers strip tabs and newlines from URLs, so
// "/\t/evil.test" would become "//evil.test", a protocol-relative link to another site.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARACTERS = /[\x00-\x20\x7f-\x9f]/;

/**
 * True for a relative path into the signed-in areas: `/app/...` or `/portal/...`, optionally with
 * a query string or fragment. It rejects absolute and protocol-relative URLs, other schemes
 * (`javascript:`), backslashes, control characters and spaces, encoded slashes and backslashes,
 * and dot segments (`/app/../login`), and it requires the path to still resolve inside the same
 * area after the URL parser has normalised it.
 */
export function isSafeAppPath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > MAX_APP_PATH_LENGTH) {
    return false;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return false;
  }
  if (value.includes("\\") || UNSAFE_CHARACTERS.test(value)) {
    return false;
  }

  const rawPath = value.split(/[?#]/, 1)[0] ?? "";
  // An encoded slash, backslash or control character can be decoded by a later hop into a form
  // rejected above.
  if (/%(5c|2f|0[0-9a-f]|1[0-9a-f]|7f)/i.test(rawPath)) {
    return false;
  }
  if (rawPath.split("/").some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return false;
  }
  if (url.origin !== PROBE_ORIGIN) {
    return false;
  }
  return APP_AREAS.some((area) => url.pathname === area || url.pathname.startsWith(`${area}/`));
}
