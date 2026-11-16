import {
  type CustomerInvoiceListItemDto,
  InvoiceStatus,
  LIMITS,
  OUTSTANDING_INVOICE_STATUSES,
} from "@fixflow/shared";

import { apiPath } from "@/lib/api/paths";
import { formatDate, formatMoney } from "@/lib/formatting";
import type { SearchParamsInput } from "@/lib/url";

/** The customer's own invoices (IA-C05). */
export const PORTAL_INVOICES_PATH = "/portal/invoices";

/** One invoice's page: the id, never the number, is the key (BR-21). */
export function portalInvoicePath(id: string): string {
  return `${PORTAL_INVOICES_PATH}/${encodeURIComponent(id)}`;
}

/** The PDF of an invoice, through the same-origin proxy (D-06). */
export function invoicePdfPath(id: string, options: { inline?: boolean } = {}): string {
  const route = `/invoices/${encodeURIComponent(id)}/pdf` as const;
  return `${apiPath(route)}${options.inline === true ? "?inline=1" : ""}`;
}

export const PORTAL_INVOICES_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

// ---- The list's filter -----------------------------------------------------------------------------

export const INVOICE_FILTERS = ["all", "outstanding", "paid"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const INVOICE_FILTER_LABELS: Record<InvoiceFilter, string> = {
  all: "All",
  outstanding: "Outstanding",
  paid: "Paid",
};

export interface PortalInvoicesQuery {
  filter: InvoiceFilter;
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The list's filter and page from the page's `searchParams` (D-40). The address is typed by people,
 * so anything unusable falls back to the default: every invoice, the first page.
 */
export function parseInvoicesQuery(params: SearchParamsInput): PortalInvoicesQuery {
  const filter = INVOICE_FILTERS.find((candidate) => candidate === first(params.filter));
  const page = first(params.page);
  return {
    filter: filter ?? "all",
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The statuses each filter shows; `all` has none, so the API lists every invoice the customer can see. */
const FILTER_STATUSES: Record<InvoiceFilter, readonly InvoiceStatus[]> = {
  all: [],
  outstanding: OUTSTANDING_INVOICE_STATUSES,
  paid: [InvoiceStatus.PAID],
};

/** `GET /invoices/me` for the list page: the filter's statuses, newest first, one page. */
export function invoicesApiQuery(query: PortalInvoicesQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(PORTAL_INVOICES_PAGE_SIZE),
  });
  const statuses = FILTER_STATUSES[query.filter];
  if (statuses.length > 0) {
    params.set("status", statuses.join(","));
  }
  return params.toString();
}

/** The list's own address for a filter, `all` being the address with no filter. */
export function invoicesFilterHref(filter: InvoiceFilter): string {
  return filter === "all" ? PORTAL_INVOICES_PATH : `${PORTAL_INVOICES_PATH}?filter=${filter}`;
}

/** Whether an invoice still owes money. */
export function isOutstandingStatus(status: InvoiceStatus): boolean {
  return (OUTSTANDING_INVOICE_STATUSES as readonly InvoiceStatus[]).includes(status);
}

// ---- Wording ------------------------------------------------------------------------------------------

type Summarised = Pick<
  CustomerInvoiceListItemDto,
  "status" | "balanceDue" | "currencyCode" | "dueDate" | "daysOverdue"
>;

/**
 * What the customer most wants to know about an invoice, in one sentence: what they owe and by when,
 * that it is paid, or that it is overdue. Money and dates are the server's figures, shown in the
 * business's currency and time zone.
 */
export function balanceHeadline(invoice: Summarised, timeZone: string, paidOn?: string | null) {
  const balance = formatMoney(invoice.balanceDue, invoice.currencyCode);
  switch (invoice.status) {
    case InvoiceStatus.PAID:
      return paidOn === undefined || paidOn === null
        ? "Paid in full"
        : `Paid in full on ${formatDate(paidOn, timeZone)}`;
    case InvoiceStatus.OVERDUE:
      return `Overdue: ${balance} was due ${formatDate(invoice.dueDate, timeZone)}`;
    case InvoiceStatus.VOID:
      return "Withdrawn: nothing is owed";
    default:
      return `Balance due ${balance} by ${formatDate(invoice.dueDate, timeZone)}`;
  }
}

/** "Overdue by 1 day" / "Overdue by 5 days". */
export function overdueByText(daysOverdue: number): string {
  return daysOverdue === 1 ? "Overdue by 1 day" : `Overdue by ${daysOverdue} days`;
}

/** The note that says where money goes: FixFlow records payments, the business takes them (NG-03). */
export function paidDirectlyNote(businessName: string): string {
  return `Payments are made directly to ${businessName}; FixFlow doesn't process payments.`;
}

/** The name of the file a download is saved as, when the server does not say (it always does). */
export function fallbackPdfName(invoiceNumber: string): string {
  return `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
}
