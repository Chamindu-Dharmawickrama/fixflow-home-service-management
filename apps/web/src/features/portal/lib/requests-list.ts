import { LIMITS, ServiceRequestStatus } from "@fixflow/shared";

import type { SearchParamsInput } from "@/lib/url";

/** The customer's list of their own requests. */
export const REQUESTS_PATH = "/portal/requests";

export const REQUESTS_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** Where one request lives: the id, never the reference, is the key (BR-21). */
export function requestPath(id: string): string {
  return `${REQUESTS_PATH}/${id}`;
}

/** The page a customer lands on after sending a request, which confirms it (spec §7.1 step 6). */
export function requestConfirmationPath(id: string): string {
  return `${requestPath(id)}?submitted=1`;
}

export interface RequestsListQuery {
  status: ServiceRequestStatus | undefined;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The list's filter and page from the page's `searchParams` (D-40). Anything unusable falls back to
 * the default instead of failing, because the URL is typed or edited by people: a bad `status`
 * shows every request, a bad `page` shows the first.
 */
export function parseRequestsQuery(params: SearchParamsInput): RequestsListQuery {
  const status = first(params.status);
  const page = first(params.page);
  return {
    status: Object.values(ServiceRequestStatus).find((candidate) => candidate === status),
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The query string for `GET /requests/me`: newest first is the API's only order. */
export function toApiQueryString(
  query: RequestsListQuery,
  pageSize: number = REQUESTS_PAGE_SIZE,
): string {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(pageSize) });
  if (query.status !== undefined) params.set("status", query.status);
  return params.toString();
}

/** True when a filter narrows the list (so an empty result means "no match", not "none yet"). */
export function hasActiveFilters(query: RequestsListQuery): boolean {
  return query.status !== undefined;
}

/** How many requests the overview shows before linking to the full list. */
export const RECENT_REQUESTS_COUNT = 3;
