import {
  ADMIN_INVOICE_SORT_FIELDS,
  type AdminInvoiceDto,
  type AdminInvoiceSortField,
  type FieldErrors,
  InvoiceStatus,
  isDateOnly,
  LIMITS,
  tryCalculateDocumentTotals,
  type UpdateInvoiceBody,
} from "@fixflow/shared";
import { z } from "zod";

import { EMPTY_LINE, type LineItemFormValue } from "@/components/forms/line-items";
import { buildHref, type SearchParamsInput } from "@/lib/url";

import { trimTrailingZeros } from "./quotations";

/** The business's invoices (IA-A11). */
export const INVOICES_PATH = "/app/invoices";

export const INVOICES_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** One invoice in the business's view (IA-A12), keyed by its id: the number is a label, never the address. */
export function adminInvoicePath(id: string): string {
  return `${INVOICES_PATH}/${encodeURIComponent(id)}`;
}

// ---- The list ----------------------------------------------------------------------------------

/** The chips, in the order they read: the invoice's own life from draft to settled, then void. */
export const INVOICE_STATUS_ORDER: readonly InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID,
  InvoiceStatus.VOID,
];

type SortOrder = "asc" | "desc";

export interface InvoicesQuery {
  /**
   * The statuses to list, in the order of {@link INVOICE_STATUS_ORDER}; none means every invoice. A chip
   * chooses one; the dashboard's "unpaid balance" link names three (issued, part paid and overdue).
   */
  status: InvoiceStatus[];
  q: string | undefined;
  dueFrom: string | undefined;
  dueTo: string | undefined;
  sort: AdminInvoiceSortField;
  order: SortOrder;
  page: number;
}

/** Newest first: what was just made or issued is what is looked for. */
export const DEFAULT_INVOICE_SORT: { sort: AdminInvoiceSortField; order: SortOrder } = {
  sort: "createdAt",
  order: "desc",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dateOrUndefined(value: string | string[] | undefined): string | undefined {
  const date = first(value)?.trim();
  return date !== undefined && isDateOnly(date) ? date : undefined;
}

/**
 * The list's status, search, due-date range, sort and page from the page's `searchParams` (D-40).
 * The address is typed by people, so anything unusable falls back to its default instead of failing
 * the page: an unknown status or sort is ignored, a bad date is dropped and a range given backwards
 * is put the right way round. (The API is strict and answers `422`; this keeps a hand-edited link working.)
 */
export function parseInvoicesQuery(params: SearchParamsInput): InvoicesQuery {
  const q = first(params.q)?.trim().slice(0, 100);
  const wanted = new Set(
    (Array.isArray(params.status) ? params.status : [params.status ?? ""])
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim()),
  );
  const status = INVOICE_STATUS_ORDER.filter((candidate) => wanted.has(candidate));
  const asked = first(params.sort);
  const order = first(params.order);
  const page = first(params.page);

  const sort = ADMIN_INVOICE_SORT_FIELDS.find((candidate) => candidate === asked);
  const from = dateOrUndefined(params.dueFrom);
  const to = dateOrUndefined(params.dueTo);
  const backwards = from !== undefined && to !== undefined && from > to;

  return {
    status,
    q: q === undefined || q === "" ? undefined : q,
    dueFrom: backwards ? to : from,
    dueTo: backwards ? from : to,
    sort: sort ?? DEFAULT_INVOICE_SORT.sort,
    // A chosen column starts ascending; the default column keeps the default order.
    order:
      order === "asc" || order === "desc"
        ? order
        : sort === undefined || sort === DEFAULT_INVOICE_SORT.sort
          ? DEFAULT_INVOICE_SORT.order
          : "asc",
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The query string for `GET /admin/invoices`. */
export function toInvoicesApiQueryString(query: InvoicesQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(INVOICES_PAGE_SIZE),
    sort: query.sort,
    order: query.order,
  });
  if (query.status.length > 0) params.set("status", query.status.join(","));
  if (query.q !== undefined) params.set("q", query.q);
  if (query.dueFrom !== undefined) params.set("dueFrom", query.dueFrom);
  if (query.dueTo !== undefined) params.set("dueTo", query.dueTo);
  return params.toString();
}

/** True when a search or a filter other than the status narrows the list. */
export function hasActiveInvoiceFilters(query: InvoicesQuery): boolean {
  return query.q !== undefined || query.dueFrom !== undefined || query.dueTo !== undefined;
}

/** What a change in the filter form keeps from the address: the status, and the sort when it is not the default. */
export function invoicesFormCarryOver(query: InvoicesQuery): Record<string, string> {
  const carry: Record<string, string> = {};
  if (query.status.length > 0) {
    carry.status = query.status.join(",");
  }
  if (query.sort !== DEFAULT_INVOICE_SORT.sort || query.order !== DEFAULT_INVOICE_SORT.order) {
    carry.sort = query.sort;
    carry.order = query.order;
  }
  return carry;
}

/**
 * The link of a status chip: that status (or all, with none), back on page 1, keeping the search,
 * dates and sort. A list of statuses is written comma-separated, as the dashboard's links write it.
 */
export function invoicesStatusHref(
  params: SearchParamsInput,
  status: InvoiceStatus | readonly InvoiceStatus[] | undefined,
): string {
  const value = status === undefined ? [] : typeof status === "string" ? [status] : status;
  return buildHref(INVOICES_PATH, params, {
    status: value.length === 0 ? null : value.join(","),
    page: null,
  });
}

/** The one status a chip chose, or `undefined` when the list is of every status or of several. */
export function singleStatus(query: Pick<InvoicesQuery, "status">): InvoiceStatus | undefined {
  return query.status.length === 1 ? query.status[0] : undefined;
}

/** The link a column header goes to: this column, with the order flipped if it is already the sort. */
export function invoicesSortHref(
  params: SearchParamsInput,
  query: InvoicesQuery,
  field: string,
): string {
  return buildHref(INVOICES_PATH, params, {
    sort: field,
    order: query.sort === field && query.order === "asc" ? "desc" : "asc",
    page: null,
  });
}

// ---- The editor's form ---------------------------------------------------------------------------

/** What the draft editor holds. Every number is the text typed (CLAUDE.md §9). */
export interface InvoiceFormValues {
  lines: LineItemFormValue[];
  discountAmount: string;
  /** A percentage: `"8.00"` means 8 %. */
  taxRate: string;
  /** `YYYY-MM-DD`, or empty for "the day it is issued". */
  issueDate: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  customerNote: string;
}

/** The saved draft as the editor shows it. */
export function invoiceToFormValues(invoice: AdminInvoiceDto): InvoiceFormValues {
  return {
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: trimTrailingZeros(line.quantity),
      unitPrice: line.unitPrice,
      taxable: line.taxable,
    })),
    discountAmount: invoice.discountAmount,
    taxRate: invoice.taxRate,
    issueDate: invoice.issueDate ?? "",
    dueDate: invoice.dueDate ?? "",
    customerNote: invoice.customerNote ?? "",
  };
}

/** What `PATCH /admin/invoices/:id` takes. Totals are not in it: the server works them out. */
export function toInvoiceUpdateBody(
  values: InvoiceFormValues,
  expectedUpdatedAt: string,
): UpdateInvoiceBody {
  const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());
  return {
    lines: values.lines.map((line) => ({
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim(),
      taxable: line.taxable,
    })),
    discountAmount: values.discountAmount.trim(),
    taxRate: values.taxRate.trim(),
    issueDate: blankToNull(values.issueDate),
    dueDate: values.dueDate,
    customerNote: blankToNull(values.customerNote),
    expectedUpdatedAt,
  };
}

/** The empty shape of the form; the values of a real draft are always the server's. */
export const EMPTY_INVOICE_FORM: InvoiceFormValues = {
  lines: [EMPTY_LINE],
  discountAmount: "0.00",
  taxRate: "0.00",
  issueDate: "",
  dueDate: "",
  customerNote: "",
};

const DESCRIPTION_MISSING = "Describe the work or item on this line.";
const DUE_DATE_MISSING = "Choose the date the invoice is due.";
const ISSUE_DATE_INVALID = "Choose the issue date, or leave it empty to use the day you issue it.";
export const DUE_BEFORE_ISSUE = "The due date can't be before the issue date.";

/**
 * Everything wrong with the form, as the API would say it (`fieldErrors`, keyed `lines.2.quantity`),
 * for early feedback beside each field. The amounts are judged by the shared calculation, the code
 * the server runs, so the form and the server cannot disagree about a quantity or a discount. The
 * server applies the rules again and is the authority.
 */
export function invoiceFormProblems(values: InvoiceFormValues): FieldErrors {
  const problems: FieldErrors = {};

  values.lines.forEach((line, index) => {
    const description = line.description.trim();
    if (description === "") {
      problems[`lines.${index}.description`] = DESCRIPTION_MISSING;
    } else if (description.length > LIMITS.lineDescription.maxLength) {
      problems[`lines.${index}.description`] =
        `Keep the description to ${LIMITS.lineDescription.maxLength} characters or fewer.`;
    }
  });

  const calculation = tryCalculateDocumentTotals({
    lines: values.lines.map(({ quantity, unitPrice, taxable }) => ({
      quantity: quantity.trim(),
      unitPrice: unitPrice.trim(),
      taxable,
    })),
    discountAmount: values.discountAmount.trim(),
    taxRate: values.taxRate.trim(),
  });
  if (!calculation.ok) {
    Object.assign(problems, calculation.fieldErrors);
  }

  if (values.issueDate !== "" && !isDateOnly(values.issueDate)) {
    problems.issueDate = ISSUE_DATE_INVALID;
  }
  if (!isDateOnly(values.dueDate)) {
    problems.dueDate = DUE_DATE_MISSING;
  } else if (values.issueDate !== "" && isDateOnly(values.issueDate)) {
    if (values.dueDate < values.issueDate) {
      problems.dueDate = DUE_BEFORE_ISSUE;
    }
  }
  if (values.customerNote.length > LIMITS.notes.maxLength) {
    problems.customerNote = `Keep the note to ${LIMITS.notes.maxLength} characters or fewer.`;
  }
  return problems;
}

const lineValueSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  taxable: z.boolean(),
});

/**
 * The form's schema. The fields are plain text here on purpose: one check over the whole form
 * ({@link invoiceFormProblems}) reports every problem at once, which per-field rules would not (an
 * invalid field hides the form-level check).
 */
export const invoiceFormSchema = z
  .object({
    lines: z.array(lineValueSchema),
    discountAmount: z.string(),
    taxRate: z.string(),
    issueDate: z.string(),
    dueDate: z.string(),
    customerNote: z.string(),
  })
  .superRefine((values, context) => {
    for (const [path, message] of Object.entries(invoiceFormProblems(values))) {
      context.addIssue({
        code: "custom",
        message,
        path: path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      });
    }
  });

/** The words that name a field in the list of problems; a line's fields say which line. */
export function invoiceFieldLabels(lineCount: number): Record<string, string> {
  const labels: Record<string, string> = {
    lines: "Line items",
    discountAmount: "Discount",
    taxRate: "Tax rate",
    issueDate: "Issue date",
    dueDate: "Due date",
    customerNote: "Note for the customer",
  };
  for (let index = 0; index < lineCount; index += 1) {
    labels[`lines.${index}.description`] = `Line ${index + 1} description`;
    labels[`lines.${index}.quantity`] = `Line ${index + 1} quantity`;
    labels[`lines.${index}.unitPrice`] = `Line ${index + 1} unit price`;
  }
  return labels;
}

const FORM_FIELD =
  /^(lines(\.\d+\.(description|quantity|unitPrice|taxable))?|discountAmount|taxRate|issueDate|dueDate|customerNote)$/;

/**
 * Splits the API's `fieldErrors` into what sits beside a field of the editor and what has no field of
 * its own (the total being zero, say), which is shown as a message above the form.
 */
export function splitInvoiceApiProblems(fieldErrors: FieldErrors | undefined): {
  fields: FieldErrors;
  banner: string | null;
} {
  const fields: FieldErrors = {};
  const loose: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (FORM_FIELD.test(path)) {
      fields[path] = message;
    } else {
      loose.push(message);
    }
  }
  return { fields, banner: loose.length === 0 ? null : loose.join(" ") };
}

// ---- Words ---------------------------------------------------------------------------------------

/** What the invoice is called where there is room for one name: its number, or "Draft invoice". */
export function invoiceTitle(invoice: Pick<AdminInvoiceDto, "invoiceNumber">): string {
  return invoice.invoiceNumber ?? "Draft invoice";
}

/** The sentence under an overdue invoice's title: "Overdue by 4 days". */
export function overdueSentence(daysOverdue: number): string {
  return daysOverdue === 1 ? "Overdue by 1 day" : `Overdue by ${daysOverdue} days`;
}
