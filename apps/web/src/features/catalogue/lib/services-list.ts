import { LIMITS, SERVICE_STATUS_FILTERS, type ServiceStatusFilter } from "@fixflow/shared";

import type { SearchParamsInput } from "@/lib/url";

/** The columns the service list can be sorted by; the same allowlist as the API's. */
export const SERVICE_SORT_FIELDS = ["sortOrder", "name", "category", "updatedAt"] as const;
export type ServiceSortField = (typeof SERVICE_SORT_FIELDS)[number];

export const SERVICES_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

export interface ServicesListQuery {
  status: ServiceStatusFilter | undefined;
  search: string | undefined;
  page: number;
  sort: ServiceSortField;
  order: "asc" | "desc";
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The list's filters, sort and page from the page's `searchParams` (D-40). Anything unusable falls
 * back to the default instead of failing, because the URL is typed or edited by people: a bad
 * `status` shows every service, a bad `page` shows the first.
 */
export function parseServicesQuery(params: SearchParamsInput): ServicesListQuery {
  const status = first(params.status);
  const sort = first(params.sort);
  const order = first(params.order);
  const page = first(params.page);
  const search = first(params.search)?.trim().slice(0, LIMITS.service.search.maxLength);

  return {
    status: SERVICE_STATUS_FILTERS.find((candidate) => candidate === status),
    search: search === undefined || search === "" ? undefined : search,
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
    sort: SERVICE_SORT_FIELDS.find((candidate) => candidate === sort) ?? "sortOrder",
    order: order === "desc" ? "desc" : "asc",
  };
}

/** The query string for `GET /admin/services`. */
export function toApiQueryString(query: ServicesListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(SERVICES_PAGE_SIZE),
    sort: query.sort,
    order: query.order,
  });
  if (query.status !== undefined) params.set("status", query.status);
  if (query.search !== undefined) params.set("search", query.search);
  return params.toString();
}

/** True when a filter or a search narrows the list (so an empty result means "no match", not "none yet"). */
export function hasActiveFilters(query: ServicesListQuery): boolean {
  return query.status !== undefined || query.search !== undefined;
}
