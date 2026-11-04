import {
  ADMIN_WORK_ORDER_SORT_FIELDS,
  type AdminWorkOrderSortField,
  isDateOnly,
  LIMITS,
  WORK_ORDER_VIEWS,
  type WorkOrderView,
} from "@fixflow/shared";

import { buildHref, type SearchParamsInput } from "@/lib/url";

/** The business's jobs (IA-A05). */
export const JOBS_PATH = "/app/jobs";

export const JOBS_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** One job in the business's view, keyed by its id (the reference is a label, BR-21). */
export function adminJobPath(id: string): string {
  return `${JOBS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * A job's page with the scheduling dialog already open. Making a job from an accepted quotation goes
 * here, because the next thing to do with a new job is to give it a time (workflow 7.4).
 */
export function adminJobSchedulePath(id: string): string {
  return `${adminJobPath(id)}?${SCHEDULE_PARAM}=1`;
}

/** The address parameter that opens the scheduling dialog. */
export const SCHEDULE_PARAM = "schedule";

// ---- The tabs ----------------------------------------------------------------------------------

/** The tab shown when the address names none: what is waiting for a time is what needs doing. */
export const DEFAULT_VIEW: WorkOrderView = "needs-scheduling";

export const VIEW_LABELS: Readonly<Record<WorkOrderView, string>> = {
  "needs-scheduling": "Needs scheduling",
  upcoming: "Upcoming",
  "in-progress": "In progress",
  "ready-to-invoice": "Ready to invoice",
  completed: "Completed",
  all: "All",
};

type SortOrder = "asc" | "desc";

/**
 * How each tab is read by default: what has waited longest comes first, what is coming up comes in
 * the order it happens, and what is done comes newest first. A column header overrides it.
 */
export const VIEW_DEFAULT_SORT: Readonly<
  Record<WorkOrderView, { sort: AdminWorkOrderSortField; order: SortOrder }>
> = {
  "needs-scheduling": { sort: "createdAt", order: "asc" },
  upcoming: { sort: "scheduledStart", order: "asc" },
  "in-progress": { sort: "scheduledStart", order: "asc" },
  // The job that has waited longest for its invoice comes first.
  "ready-to-invoice": { sort: "completedAt", order: "asc" },
  completed: { sort: "scheduledStart", order: "desc" },
  all: { sort: "createdAt", order: "desc" },
};

export interface JobsQuery {
  view: WorkOrderView;
  q: string | undefined;
  technicianId: string | undefined;
  scheduledFrom: string | undefined;
  scheduledTo: string | undefined;
  sort: AdminWorkOrderSortField;
  order: SortOrder;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateOrUndefined(value: string | string[] | undefined): string | undefined {
  const date = first(value)?.trim();
  return date !== undefined && isDateOnly(date) ? date : undefined;
}

/**
 * The jobs list's tab, search, filters, sort and page from the page's `searchParams` (D-40). The
 * URL is typed and edited by people, so anything unusable falls back to its default instead of
 * failing the page: an unknown tab or sort is ignored, a bad date is dropped, and a range given
 * backwards is put the right way round. (The API is strict and answers `422`; this keeps a
 * hand-edited link working.)
 */
export function parseJobsQuery(params: SearchParamsInput): JobsQuery {
  const q = first(params.q)?.trim().slice(0, 100);
  const view =
    WORK_ORDER_VIEWS.find((candidate) => candidate === first(params.view)) ?? DEFAULT_VIEW;
  const asked = first(params.sort);
  const order = first(params.order);
  const page = first(params.page);
  const defaults = VIEW_DEFAULT_SORT[view];

  const sort = ADMIN_WORK_ORDER_SORT_FIELDS.find((candidate) => candidate === asked);
  const from = dateOrUndefined(params.scheduledFrom);
  const to = dateOrUndefined(params.scheduledTo);
  const backwards = from !== undefined && to !== undefined && from > to;
  const technicianId = first(params.technicianId)?.trim();

  return {
    view,
    q: q === undefined || q === "" ? undefined : q,
    technicianId: technicianId !== undefined && UUID.test(technicianId) ? technicianId : undefined,
    scheduledFrom: backwards ? to : from,
    scheduledTo: backwards ? from : to,
    sort: sort ?? defaults.sort,
    // A chosen column starts ascending; the tab's own default order goes with its default column.
    order:
      order === "asc" || order === "desc"
        ? order
        : sort === undefined || sort === defaults.sort
          ? defaults.order
          : "asc",
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The query string for `GET /admin/work-orders`. */
export function toJobsApiQueryString(query: JobsQuery): string {
  const params = new URLSearchParams({
    view: query.view,
    page: String(query.page),
    pageSize: String(JOBS_PAGE_SIZE),
    sort: query.sort,
    order: query.order,
  });
  if (query.q !== undefined) params.set("q", query.q);
  if (query.technicianId !== undefined) params.set("technicianId", query.technicianId);
  if (query.scheduledFrom !== undefined) params.set("scheduledFrom", query.scheduledFrom);
  if (query.scheduledTo !== undefined) params.set("scheduledTo", query.scheduledTo);
  return params.toString();
}

/** True when a search or a filter narrows the list (so an empty result means "no match", not "none yet"). */
export function hasActiveJobFilters(query: JobsQuery): boolean {
  return (
    query.q !== undefined ||
    query.technicianId !== undefined ||
    query.scheduledFrom !== undefined ||
    query.scheduledTo !== undefined
  );
}

/**
 * What a change in the filter form keeps from the address: the tab, and the sort when it is not the
 * tab's own. Written normalised, so the address does not collect empty or default values.
 */
export function jobsFormCarryOver(query: JobsQuery): Record<string, string> {
  const carry: Record<string, string> = {};
  if (query.view !== DEFAULT_VIEW) {
    carry.view = query.view;
  }
  const defaults = VIEW_DEFAULT_SORT[query.view];
  if (query.sort !== defaults.sort || query.order !== defaults.order) {
    carry.sort = query.sort;
    carry.order = query.order;
  }
  return carry;
}

/**
 * The link of a tab: that tab, back on page 1, keeping the search and the filters. The sort is
 * dropped, because each tab has its own way of being read. The default tab has a clean address.
 */
export function jobsTabHref(params: SearchParamsInput, view: WorkOrderView): string {
  return buildHref(JOBS_PATH, params, {
    view: view === DEFAULT_VIEW ? null : view,
    sort: null,
    order: null,
    page: null,
  });
}

/** The link a column header goes to: this column, with the order flipped if it is already the sort. */
export function jobsSortHref(params: SearchParamsInput, query: JobsQuery, field: string): string {
  return buildHref(JOBS_PATH, params, {
    sort: field,
    order: query.sort === field && query.order === "asc" ? "desc" : "asc",
    page: null,
  });
}
