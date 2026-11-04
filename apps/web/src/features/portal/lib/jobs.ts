import { LIMITS } from "@fixflow/shared";

import type { SearchParamsInput } from "@/lib/url";

/** The customer's own jobs (IA-C04). */
export const JOBS_PATH = "/portal/jobs";

/** One job's page: the id, never the reference, is the key (BR-21). */
export function jobPath(id: string): string {
  return `${JOBS_PATH}/${encodeURIComponent(id)}`;
}

/** How many visits "Upcoming visits" on the portal home shows before it links to the whole list. */
export const UPCOMING_VISITS_COUNT = 3;

/** The upcoming section is not paged: a customer has a handful of jobs under way, and this is a safe ceiling. */
export const UPCOMING_JOBS_LIMIT = LIMITS.pagination.maxPageSize;

export const PAST_JOBS_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page of past jobs from the address (D-40). Anything unusable falls back to the first page,
 * because the address is typed or edited by people.
 */
export function parsePastPage(params: SearchParamsInput): number {
  const page = first(params.page);
  return page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
    ? Math.min(Number(page), LIMITS.pagination.maxPage)
    : 1;
}

/** `GET /work-orders/me` for the upcoming section of the list page: all of it. */
export function upcomingQuery(): string {
  return new URLSearchParams({
    group: "upcoming",
    pageSize: String(UPCOMING_JOBS_LIMIT),
  }).toString();
}

/** `GET /work-orders/me` for the past section: one page of it. */
export function pastQuery(page: number): string {
  return new URLSearchParams({
    group: "past",
    page: String(page),
    pageSize: String(PAST_JOBS_PAGE_SIZE),
  }).toString();
}

/** `GET /work-orders/me` for the portal home: the first few upcoming visits. */
export function homeUpcomingQuery(): string {
  return new URLSearchParams({
    group: "upcoming",
    pageSize: String(UPCOMING_VISITS_COUNT),
  }).toString();
}
