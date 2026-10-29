/**
 * IANA time zones a business may be configured with (BR-17). Business days, due dates, reference
 * years and every displayed time use the business zone, never the browser's, so the zone must be a
 * real one: the runtime's own list is the allowlist (`Intl.supportedValuesOf("timeZone")`).
 *
 * `UTC` is added because the runtime lists canonical region zones only, and a business may
 * legitimately choose it. The list is computed once per process. The web app builds the options for
 * its settings form in a Server Component, so the page and the API read the same Node.js list.
 */

const EXTRA_ZONES = ["UTC"] as const;

let cached: readonly string[] | undefined;
let cachedSet: ReadonlySet<string> | undefined;

/** Every accepted zone name, sorted. */
export function listSupportedTimeZones(): readonly string[] {
  if (cached === undefined) {
    const zones = new Set<string>([...Intl.supportedValuesOf("timeZone"), ...EXTRA_ZONES]);
    cached = [...zones].sort((a, b) => a.localeCompare(b, "en"));
    cachedSet = zones;
  }
  return cached;
}

/** True for a zone name on {@link listSupportedTimeZones}. Aliases such as `US/Eastern` are not accepted. */
export function isSupportedTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value === "") {
    return false;
  }
  listSupportedTimeZones();
  return cachedSet?.has(value) ?? false;
}
