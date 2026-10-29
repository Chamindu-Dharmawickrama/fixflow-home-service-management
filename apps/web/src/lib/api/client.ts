import type { ApiResponse } from "@fixflow/shared";

import { ApiError, errorFromResponse, networkError } from "./errors";
import { apiPath } from "./paths";

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
    throw await errorFromResponse(response);
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
