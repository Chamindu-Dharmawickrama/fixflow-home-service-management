import type { ApiResponse } from "@fixflow/shared";

import { navigateWithFullReload } from "@/lib/auth/navigate";
import { areaOf, loginUrl } from "@/lib/auth/paths";

import { ApiError, errorFromResponse, networkError } from "./errors";
import { apiPath } from "./paths";

/**
 * A `401` from the API in the middle of a signed-in page means the session has ended (it expired, it
 * was signed out elsewhere, the password was reset). The page cannot do anything useful any more, so
 * go to sign-in and come back here afterwards (T25). Not for the auth routes themselves (a wrong
 * password on the sign-in form is a `401` too), and not on public pages, which need no session.
 */
function sendToSignInWhenSessionEnded(route: string, status: number): void {
  if (status !== 401 || route.startsWith("/auth/") || typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (areaOf(pathname) === undefined) return;
  navigateWithFullReload(loginUrl(`${pathname}${search}`));
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/**
 * Calls the API from the browser through the same-origin proxy (`/api/v1/*`, D-06), so the session
 * cookie is first-party and no CORS is involved. Returns the `data` of the success envelope; any
 * other outcome throws an {@link ApiError} (`NETWORK_ERROR` when there was no answer at all).
 *
 * Browsers add the `Origin` header to these requests themselves, which the API's CSRF check needs.
 */
export async function apiFetch<T>(
  route: `/${string}`,
  options: ApiRequestOptions = {},
): Promise<T> {
  return (await apiFetchEnvelope<ApiResponse<T>>(route, options)).data;
}

/**
 * Like {@link apiFetch}, but returns the whole success body. Use it for list endpoints, whose
 * envelope also carries `pagination` and sometimes `meta` (for example the unread count).
 */
export async function apiFetchEnvelope<Body extends object>(
  route: `/${string}`,
  options: ApiRequestOptions = {},
): Promise<Body> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(apiPath(route), {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(signal !== undefined && { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw networkError();
  }

  if (!response.ok) {
    const error = await errorFromResponse(response);
    sendToSignInWhenSessionEnded(route, response.status);
    // Still thrown: the caller stops its pending state and shows no success while the page leaves.
    throw error;
  }
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError("The response is not a JSON object.");
    }
    return parsed as Body;
  } catch {
    throw new ApiError({
      status: response.status,
      code: "UNKNOWN_ERROR",
      message: "Something went wrong. Please try again.",
    });
  }
}
