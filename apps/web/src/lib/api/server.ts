import type { ApiResponse } from "@fixflow/shared";
import { cookies } from "next/headers";

import { ApiError, errorFromResponse } from "./errors";
import { apiPath } from "./paths";

/** Where Server Components reach the API directly (D-06). Server-only: never a `NEXT_PUBLIC_` variable. */
function apiBaseUrl(): string {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}

async function getJson(route: `/${string}`, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${apiPath(route)}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json", ...headers },
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "We couldn't reach the server.",
    });
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.json();
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const cookieHeader = (await cookies()).toString();
  return cookieHeader === "" ? {} : { Cookie: cookieHeader };
}

/**
 * Reads from the API in a Server Component, forwarding the visitor's cookies so the API sees their
 * session. Never cached: the answer depends on who is asking and changes with their data. Returns
 * the `data` of the success envelope; an error response throws an {@link ApiError}, and so does an
 * unreachable API (`NETWORK_ERROR`), which the nearest error boundary turns into a retry screen.
 *
 * Reads only: mutations go through the browser client and the proxy (CLAUDE.md §7). Reading
 * `cookies()` is a request-time read, so callers sit behind a `<Suspense>` boundary.
 */
export async function serverApiGet<T>(route: `/${string}`): Promise<T> {
  return ((await getJson(route, await sessionHeaders())) as ApiResponse<T>).data;
}

/**
 * Like {@link serverApiGet}, but returns the whole success body: list endpoints also carry
 * `pagination` and sometimes `meta` (for example the tab counts of the service list).
 */
export async function serverApiGetEnvelope<Body extends object>(
  route: `/${string}`,
): Promise<Body> {
  return (await getJson(route, await sessionHeaders())) as Body;
}

/**
 * Reads a public endpoint (no sign-in needed), sending no cookies, so the request says nothing
 * about the visitor. Still not cached by Next.js: callers that want the answer reused across
 * requests decide that themselves (T08).
 */
export async function serverApiGetPublic<T>(route: `/${string}`): Promise<T> {
  return ((await getJson(route, {})) as ApiResponse<T>).data;
}
