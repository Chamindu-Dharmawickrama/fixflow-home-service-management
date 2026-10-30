import {
  ADMIN_REQUEST_SORT_FIELDS,
  type AdminRequestSortField,
  isDateOnly,
  LIMITS,
  ServiceRequestStatus,
} from "@fixflow/shared";

import { buildHref, type SearchParamsInput } from "@/lib/url";

/** The business's request queue (IA-A02). */
export const QUEUE_PATH = "/app/requests";

export const QUEUE_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** One request in the business's view, keyed by its id (the reference is a label, BR-21). */
export function adminRequestPath(id: string): string {
  return `${QUEUE_PATH}/${id}`;
}

/** The statuses in the order of the workflow, which is the order of the chips. */
export const QUEUE_STATUS_ORDER: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.SUBMITTED,
  ServiceRequestStatus.UNDER_REVIEW,
  ServiceRequestStatus.QUOTED,
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.DECLINED,
  ServiceRequestStatus.CONVERTED_TO_JOB,
  ServiceRequestStatus.CANCELLED,
];

export interface QueueQuery {
  q: string | undefined;
  status: ServiceRequestStatus[];
  serviceId: string | undefined;
  submittedFrom: string | undefined;
  submittedTo: string | undefined;
  sort: AdminRequestSortField;
  order: "asc" | "desc";
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function values(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function first(value: string | string[] | undefined): string | undefined {
  return values(value)[0];
}

function dateOrUndefined(value: string | string[] | undefined): string | undefined {
  const date = first(value)?.trim();
  return date !== undefined && isDateOnly(date) ? date : undefined;
}

/**
 * The queue's search, filters, sort and page from the page's `searchParams` (D-40). The URL is typed
 * and edited by people, so anything unusable falls back to its default instead of failing the page:
 * an unknown status or sort is ignored, a bad date is dropped, and a range given backwards is put
 * the right way round. (The API is strict and answers `422`; this keeps a hand-edited link working.)
 */
export function parseQueueQuery(params: SearchParamsInput): QueueQuery {
  const q = first(params.q)?.trim().slice(0, 100);

  const asked = new Set(
    values(params.status)
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim()),
  );

  const sort = first(params.sort);
  const order = first(params.order);
  const page = first(params.page);
  const chosenSort =
    ADMIN_REQUEST_SORT_FIELDS.find((candidate) => candidate === sort) ?? "submittedAt";

  const from = dateOrUndefined(params.submittedFrom);
  const to = dateOrUndefined(params.submittedTo);
  const backwards = from !== undefined && to !== undefined && from > to;

  const serviceId = first(params.serviceId)?.trim();

  return {
    q: q === undefined || q === "" ? undefined : q,
    status: QUEUE_STATUS_ORDER.filter((status) => asked.has(status)),
    serviceId: serviceId !== undefined && UUID.test(serviceId) ? serviceId : undefined,
    submittedFrom: backwards ? to : from,
    submittedTo: backwards ? from : to,
    sort: chosenSort,
    // Newest first is the natural way to read the queue; every other column starts ascending.
    order:
      order === "asc" || order === "desc" ? order : chosenSort === "submittedAt" ? "desc" : "asc",
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The query string for `GET /admin/requests`. */
export function toApiQueryString(query: QueueQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(QUEUE_PAGE_SIZE),
    sort: query.sort,
    order: query.order,
  });
  if (query.q !== undefined) params.set("q", query.q);
  if (query.status.length > 0) params.set("status", query.status.join(","));
  if (query.serviceId !== undefined) params.set("serviceId", query.serviceId);
  if (query.submittedFrom !== undefined) params.set("submittedFrom", query.submittedFrom);
  if (query.submittedTo !== undefined) params.set("submittedTo", query.submittedTo);
  return params.toString();
}

/** True when a search or filter narrows the queue (so an empty result means "no match", not "none yet"). */
export function hasActiveFilters(query: QueueQuery): boolean {
  return (
    query.q !== undefined ||
    query.status.length > 0 ||
    query.serviceId !== undefined ||
    query.submittedFrom !== undefined ||
    query.submittedTo !== undefined
  );
}

/** True when the search form's own fields (search, service, dates) are set, so there is something to clear. */
export function hasFormFilters(query: QueueQuery): boolean {
  return (
    query.q !== undefined ||
    query.serviceId !== undefined ||
    query.submittedFrom !== undefined ||
    query.submittedTo !== undefined
  );
}

/**
 * What a change in the search form keeps from the address: the status filter, and the sort when it
 * is not the default. Written normalised, so the address does not collect empty or default values.
 */
export function formCarryOver(query: QueueQuery): Record<string, string> {
  const carry: Record<string, string> = {};
  if (query.status.length > 0) {
    carry.status = query.status.join(",");
  }
  if (query.sort !== "submittedAt" || query.order !== "desc") {
    carry.sort = query.sort;
    carry.order = query.order;
  }
  return carry;
}

/**
 * The statuses after a chip is pressed: the status joins the filter, or leaves it if it was in it.
 * The result is in workflow order, so the same set always gives the same address.
 */
export function toggleStatus(
  current: readonly ServiceRequestStatus[],
  status: ServiceRequestStatus,
): ServiceRequestStatus[] {
  const next = new Set(current);
  if (next.has(status)) {
    next.delete(status);
  } else {
    next.add(status);
  }
  return QUEUE_STATUS_ORDER.filter((candidate) => next.has(candidate));
}

/** The link a status chip goes to: the same queue with that status toggled, back on page 1. */
export function statusChipHref(
  params: SearchParamsInput,
  current: readonly ServiceRequestStatus[],
  status: ServiceRequestStatus,
): string {
  return buildHref(QUEUE_PATH, params, {
    status: toggleStatus(current, status).join(","),
    page: null,
  });
}

/** The link of the "All" chip: the status filter cleared, everything else kept. */
export function allStatusesHref(params: SearchParamsInput): string {
  return buildHref(QUEUE_PATH, params, { status: null, page: null });
}

/** The link a column header goes to: this column, with the order flipped if it is already the sort. */
export function sortHref(params: SearchParamsInput, query: QueueQuery, field: string): string {
  return buildHref(QUEUE_PATH, params, {
    sort: field,
    order: query.sort === field && query.order === "asc" ? "desc" : "asc",
    page: null,
  });
}
