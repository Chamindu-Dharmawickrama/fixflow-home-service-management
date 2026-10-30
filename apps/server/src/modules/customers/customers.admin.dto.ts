import type {
  AdminCustomerDto,
  AdminCustomerListItemDto,
  AdminCustomerNoteDto,
  AdminCustomerRecentDto,
  AdminCustomerSummaryDto,
  CustomerHistoryInvoiceDto,
  CustomerHistoryJobDto,
  CustomerHistoryQuotationDto,
  CustomerHistoryRequestDto,
  CustomerHistoryRequestRefDto,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { invoiceBalanceDue } from "./customers.admin.domain.js";
import { toServiceAddressDto } from "./customers.dto.js";

/**
 * Serializers for the business's view of a customer (D-41, CLAUDE.md §7). They are separate from the
 * customer's own (`customers.dto.ts`) so the two audiences can never share a shape: this one carries
 * the customer's whole history, their money position and the team's private notes. Every field is
 * copied by name from a narrow `select`, so a column added to a table later reaches no one by
 * accident. Nothing here is ever served to a customer.
 */

// ---- The list --------------------------------------------------------------------------------

/** The customer list's columns. The default address comes in the same query, as one city. */
export const ADMIN_CUSTOMER_LIST_SELECT = {
  id: true,
  phone: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  addresses: { where: { isDefault: true }, select: { city: true }, take: 1 },
} as const satisfies Prisma.CustomerProfileSelect;

export type AdminCustomerListRow = Prisma.CustomerProfileGetPayload<{
  select: typeof ADMIN_CUSTOMER_LIST_SELECT;
}>;

export function toAdminCustomerListItem(input: {
  row: AdminCustomerListRow;
  lastActivityAt: Date;
  requestCount: number;
  openJobCount: number;
  outstandingBalance: string;
  currencyCode: string;
}): AdminCustomerListItemDto {
  const { row } = input;
  return {
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone,
    city: row.addresses[0]?.city ?? null,
    requestCount: input.requestCount,
    openJobCount: input.openJobCount,
    outstandingBalance: input.outstandingBalance,
    currencyCode: input.currencyCode,
    lastActivityAt: input.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- The history rows ------------------------------------------------------------------------

const REQUEST_REF_SELECT = { select: { id: true, reference: true } } as const;

export const HISTORY_REQUEST_SELECT = {
  id: true,
  reference: true,
  serviceNameSnapshot: true,
  status: true,
  preferredDate: true,
  preferredWindow: true,
  submittedAt: true,
} as const satisfies Prisma.ServiceRequestSelect;

export const HISTORY_QUOTATION_SELECT = {
  id: true,
  reference: true,
  status: true,
  totalAmount: true,
  currencyCode: true,
  validUntil: true,
  sentAt: true,
  createdAt: true,
  request: REQUEST_REF_SELECT,
} as const satisfies Prisma.QuotationSelect;

export const HISTORY_JOB_SELECT = {
  id: true,
  reference: true,
  serviceNameSnapshot: true,
  status: true,
  scheduledStart: true,
  completedAt: true,
  createdAt: true,
  request: REQUEST_REF_SELECT,
} as const satisfies Prisma.WorkOrderSelect;

export const HISTORY_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  totalAmount: true,
  amountPaid: true,
  currencyCode: true,
  dueDate: true,
  issuedAt: true,
  createdAt: true,
  // An invoice belongs to a job, which belongs to the request: the row links to that request.
  workOrder: { select: { request: REQUEST_REF_SELECT } },
} as const satisfies Prisma.InvoiceSelect;

export type HistoryRequestRow = Prisma.ServiceRequestGetPayload<{
  select: typeof HISTORY_REQUEST_SELECT;
}>;
export type HistoryQuotationRow = Prisma.QuotationGetPayload<{
  select: typeof HISTORY_QUOTATION_SELECT;
}>;
export type HistoryJobRow = Prisma.WorkOrderGetPayload<{ select: typeof HISTORY_JOB_SELECT }>;
export type HistoryInvoiceRow = Prisma.InvoiceGetPayload<{
  select: typeof HISTORY_INVOICE_SELECT;
}>;

function toRequestRef(request: { id: string; reference: string }): CustomerHistoryRequestRefDto {
  return { id: request.id, reference: request.reference };
}

export function toHistoryRequest(row: HistoryRequestRow): CustomerHistoryRequestDto {
  return {
    id: row.id,
    reference: row.reference,
    serviceName: row.serviceNameSnapshot,
    status: row.status,
    preferredDate: toDateOnly(row.preferredDate),
    preferredWindow: row.preferredWindow,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export function toHistoryQuotation(row: HistoryQuotationRow): CustomerHistoryQuotationDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    totalAmount: row.totalAmount.toFixed(2),
    currencyCode: row.currencyCode,
    validUntil: toDateOnly(row.validUntil),
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    request: toRequestRef(row.request),
  };
}

export function toHistoryJob(row: HistoryJobRow): CustomerHistoryJobDto {
  return {
    id: row.id,
    reference: row.reference,
    serviceName: row.serviceNameSnapshot,
    status: row.status,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    request: toRequestRef(row.request),
  };
}

export function toHistoryInvoice(row: HistoryInvoiceRow): CustomerHistoryInvoiceDto {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    balanceDue: invoiceBalanceDue(row),
    currencyCode: row.currencyCode,
    dueDate: row.dueDate === null ? null : toDateOnly(row.dueDate),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    request: toRequestRef(row.workOrder.request),
  };
}

// ---- The notes -------------------------------------------------------------------------------

export const CUSTOMER_NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { name: true } },
} as const satisfies Prisma.CustomerNoteSelect;

export type CustomerNoteRow = Prisma.CustomerNoteGetPayload<{
  select: typeof CUSTOMER_NOTE_SELECT;
}>;

export function toAdminCustomerNote(row: CustomerNoteRow): AdminCustomerNoteDto {
  return {
    id: row.id,
    body: row.body,
    author: { name: row.author.name },
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- The detail ------------------------------------------------------------------------------

/** The customer's own columns, their addresses (default first) and how many notes exist. */
export const ADMIN_CUSTOMER_DETAIL_SELECT = {
  id: true,
  phone: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  addresses: {
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  },
  _count: { select: { notes: true } },
} as const satisfies Prisma.CustomerProfileSelect;

export type AdminCustomerDetailRow = Prisma.CustomerProfileGetPayload<{
  select: typeof ADMIN_CUSTOMER_DETAIL_SELECT;
}>;

export function toAdminCustomerRecent(input: {
  requests: readonly HistoryRequestRow[];
  quotations: readonly HistoryQuotationRow[];
  jobs: readonly HistoryJobRow[];
  invoices: readonly HistoryInvoiceRow[];
}): AdminCustomerRecentDto {
  return {
    requests: input.requests.map(toHistoryRequest),
    quotations: input.quotations.map(toHistoryQuotation),
    jobs: input.jobs.map(toHistoryJob),
    invoices: input.invoices.map(toHistoryInvoice),
  };
}

export function toAdminCustomerDto(input: {
  row: AdminCustomerDetailRow;
  lastActivityAt: Date;
  summary: AdminCustomerSummaryDto;
  recent: AdminCustomerRecentDto;
  notes: readonly CustomerNoteRow[];
}): AdminCustomerDto {
  const { row } = input;
  return {
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone,
    customerSince: row.createdAt.toISOString(),
    lastActivityAt: input.lastActivityAt.toISOString(),
    addresses: row.addresses.map(toServiceAddressDto),
    summary: input.summary,
    recent: input.recent,
    notes: input.notes.map(toAdminCustomerNote),
    noteCount: row._count.notes,
  };
}
