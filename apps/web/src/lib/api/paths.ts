import { API_PREFIX } from "@fixflow/shared";

/**
 * Same-origin URL for an API route, e.g. `apiPath("/health")` → `/api/v1/health`.
 * Browser code calls the web origin only; Next.js rewrites these paths to the API (D-06).
 */
export function apiPath(route: `/${string}`): string {
  return `${API_PREFIX}${route}`;
}
