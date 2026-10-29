/**
 * How long the public website remembers what it read from the API (D-87). Plain functions with no
 * Next.js import, so the rules can be unit-tested; `public-data.ts` hands the result to `cacheLife`.
 */

export const DEFAULT_REVALIDATE_SECONDS = 60;
const MIN_REVALIDATE_SECONDS = 1;
const MAX_REVALIDATE_SECONDS = 3_600;
const MIN_STALE_SECONDS = 30;

/** `stale` and `revalidate` decide how fresh a page is; `expire` is how long an unvisited entry survives. */
export interface CacheProfile {
  stale: number;
  revalidate: number;
  expire: number;
}

/**
 * Reads `PUBLIC_REVALIDATE_SECONDS`: a whole number of seconds between 1 and 3600. Anything else
 * (unset, blank, text, a decimal, out of range) falls back to 60, so a typo in a deployment
 * variable cannot switch the cache off or make it last for days.
 */
export function resolveRevalidateSeconds(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    return DEFAULT_REVALIDATE_SECONDS;
  }
  const seconds = Number(raw.trim());
  return seconds >= MIN_REVALIDATE_SECONDS && seconds <= MAX_REVALIDATE_SECONDS
    ? seconds
    : DEFAULT_REVALIDATE_SECONDS;
}

/**
 * The profile for an answer worth keeping. It is served from the cache and refreshed in the
 * background after `revalidateSeconds`; an entry nobody asks for survives ten times as long (at
 * least five minutes) before the next visitor waits for a fresh one. With the default of 60 s the
 * answer can be part of a prerendered page.
 */
export function rememberProfile(revalidateSeconds: number): CacheProfile {
  return {
    // Never under 30 s: Next.js leaves an entry with a shorter `stale` out of prerenders, which would
    // turn the cached read into a request-time one (and fail the build where a page reads it outside
    // <Suspense>). It only sets how long a browser may reuse the page before asking again.
    stale: Math.max(revalidateSeconds, MIN_STALE_SECONDS),
    revalidate: revalidateSeconds,
    expire: Math.max(revalidateSeconds * 10, 300),
  };
}

/** How long "the API could not be reached" is remembered before the next visitor asks again. */
export const OUTAGE_REVALIDATE_SECONDS = 10;

/**
 * The profile for "the API could not be reached": remembered, but only briefly. Remembering it at
 * all (rather than refusing to store it) is deliberate: a page that reads this answer then stays a
 * prerenderable page instead of becoming a request-time one, so a build made while the API is down
 * succeeds and the service page can still decide a 404 before it streams (D-87). It is refreshed
 * after ten seconds, so a site recovers from an outage within about twenty.
 */
export function outageProfile(): CacheProfile {
  return { stale: 30, revalidate: OUTAGE_REVALIDATE_SECONDS, expire: 300 };
}

export const publicCacheProfile = {
  remember: (): CacheProfile =>
    rememberProfile(resolveRevalidateSeconds(process.env.PUBLIC_REVALIDATE_SECONDS)),
  outage: outageProfile,
};
