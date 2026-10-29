import type { ApiResponse } from "@fixflow/shared";
import { cookies } from "next/headers";

import { ApiError, errorFromResponse } from "./errors";
import { apiPath } from "./paths";

/** Where Server Components reach the API directly (D-06). Server-only: never a `NEXT_PUBLIC_` variable. */
function apiBaseUrl(): string {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");
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
  const cookieHeader = (await cookies()).toString();

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${apiPath(route)}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json", ...(cookieHeader !== "" && { Cookie: cookieHeader }) },
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
  return ((await response.json()) as ApiResponse<T>).data;
}
