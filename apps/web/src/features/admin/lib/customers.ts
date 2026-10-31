import {
  ADMIN_CUSTOMER_SORT_FIELDS,
  type AdminCustomerSortField,
  CUSTOMER_HISTORY_TYPES,
  type CustomerHistoryType,
  LIMITS,
} from "@fixflow/shared";

import { buildHref, type SearchParamsInput } from "@/lib/url";

import { adminQuotationPath } from "./quotations";
import { adminRequestPath } from "./requests-queue";

/** The business's customer directory (IA-A08). */
export const CUSTOMERS_PATH = "/app/customers";

export const CUSTOMERS_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** How many records of one kind a tab shows at a time. */
export const HISTORY_PAGE_SIZE = 10;

/** One customer (IA-A09), keyed by the profile id (a name or an email is a label, never the address). */
export function adminCustomerPath(id: string): string {
  return `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`;
}

/** A customer's page with one of its history tabs open. */
export function adminCustomerTabPath(id: string, tab: CustomerHistoryType): string {
  return buildHref(adminCustomerPath(id), {}, { tab });
}

// Moved to `lib/formatting` when the quotation totals needed it too; kept here for this feature's imports.
export { isZeroAmount } from "@/lib/formatting/money";

// ---- The directory ----------------------------------------------------------------------------

export type SortOrder = "asc" | "desc";

/** What each column starts as: names from A to Z, dates newest first. */
export function defaultOrder(sort: AdminCustomerSortField): SortOrder {
  return sort === "name" ? "asc" : "desc";
}

export const DEFAULT_SORT: AdminCustomerSortField = "name";

export interface CustomersQuery {
  q: string | undefined;
  sort: AdminCustomerSortField;
  order: SortOrder;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pageOf(value: string | string[] | undefined): number {
  const page = first(value);
  return page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
    ? Math.min(Number(page), LIMITS.pagination.maxPage)
    : 1;
}

/**
 * The directory's search, sort and page from the page's `searchParams` (D-40). The URL is typed and
 * edited by people, so anything unusable falls back to its default instead of failing the page: an
 * unknown sort or order is ignored and a bad page is page 1. (The API is strict and answers `422`;
 * this keeps a hand-edited link working.)
 */
export function parseCustomersQuery(params: SearchParamsInput): CustomersQuery {
  const q = first(params.q)?.trim().replace(/\s+/g, " ").slice(0, 100);
  const sort = first(params.sort);
  const order = first(params.order);
  const chosenSort =
    ADMIN_CUSTOMER_SORT_FIELDS.find((candidate) => candidate === sort) ?? DEFAULT_SORT;

  return {
    q: q === undefined || q === "" ? undefined : q,
    sort: chosenSort,
    order: order === "asc" || order === "desc" ? order : defaultOrder(chosenSort),
    page: pageOf(params.page),
  };
}

/** The query string for `GET /admin/customers`. */
export function toCustomersApiQueryString(query: CustomersQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(CUSTOMERS_PAGE_SIZE),
    sort: query.sort,
    order: query.order,
  });
  if (query.q !== undefined) params.set("q", query.q);
  return params.toString();
}

/** True when a search narrows the directory (so an empty result means "no match", not "none yet"). */
export function hasActiveSearch(query: CustomersQuery): boolean {
  return query.q !== undefined;
}

/** True when the sort is not the default, so the address needs to say so. */
function isCustomSort(query: CustomersQuery): boolean {
  return query.sort !== DEFAULT_SORT || query.order !== defaultOrder(DEFAULT_SORT);
}

/** What a change in the search form keeps from the address: the sort, when it is not the default. */
export function sortCarryOver(query: CustomersQuery): Record<string, string> {
  return isCustomSort(query) ? { sort: query.sort, order: query.order } : {};
}

/** The link a column header goes to: this column, with the order flipped if it is already the sort. */
export function customersSortHref(
  params: SearchParamsInput,
  query: CustomersQuery,
  field: string,
): string {
  const target = ADMIN_CUSTOMER_SORT_FIELDS.find((candidate) => candidate === field);
  if (target === undefined) {
    return buildHref(CUSTOMERS_PATH, params, { page: null });
  }
  const order: SortOrder =
    query.sort === target ? (query.order === "asc" ? "desc" : "asc") : defaultOrder(target);
  return buildHref(CUSTOMERS_PATH, params, { sort: target, order, page: null });
}

// ---- One customer's history -------------------------------------------------------------------

export interface CustomerTabQuery {
  tab: CustomerHistoryType;
  page: number;
}

/** The tab opened first: the customer's requests are where their story starts. */
export const DEFAULT_TAB: CustomerHistoryType = "requests";

/** Which tab and page a customer's page shows, from its `searchParams`. An unknown tab is the first one. */
export function parseCustomerTab(params: SearchParamsInput): CustomerTabQuery {
  const tab = first(params.tab);
  return {
    tab: CUSTOMER_HISTORY_TYPES.find((candidate) => candidate === tab) ?? DEFAULT_TAB,
    page: pageOf(params.page),
  };
}

/** The query string for `GET /admin/customers/:id/history`. */
export function toHistoryApiQueryString(query: CustomerTabQuery): string {
  return new URLSearchParams({
    type: query.tab,
    page: String(query.page),
    pageSize: String(HISTORY_PAGE_SIZE),
  }).toString();
}

/** The link of a history tab: that kind of record, back on its first page. */
export function tabHref(id: string, params: SearchParamsInput, tab: CustomerHistoryType): string {
  return buildHref(adminCustomerPath(id), params, { tab, page: null });
}

/**
 * Where one record of each kind opens. Only requests have a page so far. The task that builds the
 * quotation (T14), job (T17) and invoice (T20) pages fills in its entry, so no row ever links to a
 * page that does not exist (CLAUDE.md §10); until then those rows link to their request instead.
 */
export const RECORD_PATHS: Readonly<Record<CustomerHistoryType, ((id: string) => string) | null>> =
  {
    requests: adminRequestPath,
    quotations: adminQuotationPath,
    jobs: null,
    invoices: null,
  };
