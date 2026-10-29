import type { PublicServiceDto, PublicSettingsDto } from "@fixflow/shared";
import { cacheLife } from "next/cache";

import { isApiError } from "@/lib/api";
import { serverApiGetPublic } from "@/lib/api/server";

import { publicCacheProfile } from "./cache-profile";

/**
 * What the public website reads from the API (T08, D-87). Two cached functions, shared by every
 * visitor: the business profile and the list of active services. Both hold their answer for
 * `PUBLIC_REVALIDATE_SECONDS` (60 by default) and refresh it in the background, so a page is served
 * from the cache and a change made in the admin area shows up within about a minute.
 *
 * An API that cannot be reached is a normal outcome here, not an exception: the result is
 * `{ status: "unavailable" }`, which the pages turn into a message with a retry. That outcome is
 * remembered for only ten seconds (`outageProfile`), so the site recovers within about twenty
 * seconds of the API, and a build made while the API is down still succeeds (the affected pages are
 * regenerated on the first visits after it).
 */

export type Loaded<T> = { status: "ok"; data: T } | { status: "unavailable" };

/** How long one request to the API may take before the site gives up on it (a cold start can be slow). */
const API_TIMEOUT_MS = 6_000;

async function loadPublic<T>(route: `/${string}`): Promise<Loaded<T>> {
  try {
    const data = await serverApiGetPublic<T>(route, { timeoutMs: API_TIMEOUT_MS });
    cacheLife(publicCacheProfile.remember());
    return { status: "ok", data };
  } catch (error) {
    cacheLife(publicCacheProfile.outage());
    console.warn(
      `[public-site] ${route} is unavailable (${isApiError(error) ? error.code : "unexpected error"}).`,
    );
    return { status: "unavailable" };
  }
}

/** The business name, logo, contact details and service area (`GET /settings/public`). */
export async function getSiteSettings(): Promise<Loaded<PublicSettingsDto>> {
  "use cache";
  return loadPublic<PublicSettingsDto>("/settings/public");
}

/** Every active service in display order, in full (`GET /services`). Inactive services are never in it (D-50). */
export async function getActiveServices(): Promise<Loaded<PublicServiceDto[]>> {
  "use cache";
  return loadPublic<PublicServiceDto[]>("/services");
}
