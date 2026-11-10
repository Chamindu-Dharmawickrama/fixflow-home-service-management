import type { AdminTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import { InvoiceStatus, PaymentMethod } from "./enums.js";
import type { QuotationAddressDto, QuotationBusinessDto, QuotationLineDto } from "./quotations.js";

/**
 * Invoices as the business sees them (FR-070, FR-071, FR-074, FR-076, FR-077, D-26, D-43). An invoice
 * is a draft made from a completed job, then issued: issuing gives it its number and freezes what it
 * says. The customer's own views arrive with T22; everything here is the business's. Money is a
 * decimal string next to an explicit `currencyCode`; dates are ISO 8601 instants, or `YYYY-MM-DD` for
 * `issueDate` and `dueDate`.
 */

// ---- Wording ---------------------------------------------------------------------------------

/** The name of each status on a badge and in a sentence. */
export const INVOICE_STATUS_LABELS = {
  [InvoiceStatus.DRAFT]: "Draft",
  [InvoiceStatus.ISSUED]: "Issued",
  [InvoiceStatus.PARTIALLY_PAID]: "Partially paid",
  [InvoiceStatus.PAID]: "Paid",
  [InvoiceStatus.OVERDUE]: "Overdue",
  [InvoiceStatus.VOID]: "Void",
} as const satisfies Record<InvoiceStatus, string>;

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABELS[status];
}

/** The name of each way a payment was received, on screen and in the emails (D-27). */
export const PAYMENT_METHOD_LABELS = {
  [PaymentMethod.CASH]: "Cash",
  [PaymentMethod.BANK_TRANSFER]: "Bank transfer",
  [PaymentMethod.CARD_TERMINAL]: "Card terminal",
  [PaymentMethod.CHEQUE]: "Cheque",
  [PaymentMethod.OTHER]: "Other",
} as const satisfies Record<PaymentMethod, string>;

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method];
}

/**
 * What an admin can do to an invoice from where it stands (D-26, D-27, D-43). The screen offers these
 * and no others.
 */
export const InvoiceAction = {
  /** Change the lines, discount, tax rate, dates and note: drafts only. */
  EDIT: "EDIT",
  /** Give the draft its number and lock it. */
  ISSUE: "ISSUE",
  /** Withdraw the invoice with a reason: a draft, or an issued one with no active payments. */
  VOID: "VOID",
  /** Record money received outside FixFlow: an issued, partly paid or overdue invoice (D-27). */
  RECORD_PAYMENT: "RECORD_PAYMENT",
  /** Void a recorded payment with a reason: any invoice that has an active payment and is not void. */
  VOID_PAYMENT: "VOID_PAYMENT",
} as const;
export type InvoiceAction = (typeof InvoiceAction)[keyof typeof InvoiceAction];

// ---- Request bodies --------------------------------------------------------------------------

/** One line as sent to the API. Amounts are text, so nothing passes through a float. */
export interface InvoiceLineBody {
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
}

/**
 * `PATCH /admin/invoices/:id` (drafts only). The server works out every total from these lines; a
 * body that names a total is refused rather than ignored.
 */
export interface UpdateInvoiceBody {
  lines: InvoiceLineBody[];
  discountAmount: string;
  /** A percentage: `"8.00"` means 8 %. */
  taxRate: string;
  /** `YYYY-MM-DD`. `null` means "the day it is issued", in the business time zone. */
  issueDate: string | null;
  /** `YYYY-MM-DD`, on or after the issue date. */
  dueDate: string;
  /** Shown on the invoice. `null` clears it. */
  customerNote: string | null;
  /** The `updatedAt` the editor loaded. A different stored value is `409 STALE_STATE`. */
  expectedUpdatedAt: string;
}

/** `POST /admin/invoices/:id/issue`. */
export interface IssueInvoiceBody {
  /** The status the screen showed; anything but `DRAFT` is `409 STALE_STATE` (D-46). */
  expectedStatus: typeof InvoiceStatus.DRAFT;
}

/** `POST /admin/invoices/:id/void`. */
export interface VoidInvoiceBody {
  /** 5 to 500 characters. Internal: the customer never reads it. */
  reason: string;
  /** The status the screen showed (D-46). */
  expectedStatus: InvoiceStatus;
}

/**
 * `POST /admin/invoices/:id/payments` (D-27). A payment is a record of money the business already
 * received; FixFlow takes none. Every value is checked again on the server, against the balance under
 * a lock.
 */
export interface RecordPaymentBody {
  /** A decimal string above zero with at most two places, and at most the remaining balance. */
  amount: string;
  /** `YYYY-MM-DD`, not in the future in the business time zone. */
  paymentDate: string;
  method: PaymentMethod;
  /** A cheque or transfer number: internal, at most 100 characters. Never card or bank credentials. */
  reference?: string | null;
  /** Internal, at most 500 characters. Never card or bank credentials. */
  notes?: string | null;
}

/** `POST /admin/invoices/:id/payments/:paymentId/void`. A correction is a void plus a new record. */
export interface VoidPaymentBody {
  /** 5 to 500 characters. Internal: the customer never reads it. */
  reason: string;
}

// ---- The list --------------------------------------------------------------------------------

export const ADMIN_INVOICE_SORT_FIELDS = [
  "createdAt",
  "issueDate",
  "dueDate",
  "totalAmount",
  "status",
] as const;
export type AdminInvoiceSortField = (typeof ADMIN_INVOICE_SORT_FIELDS)[number];

/** One row of `GET /admin/invoices`. `status` is what the invoice is now, overdue included. */
export interface AdminInvoiceListItemDto {
  id: string;
  /** `null` while it is a draft: the number is assigned when the invoice is issued (D-17). */
  invoiceNumber: string | null;
  status: InvoiceStatus;
  statusLabel: string;
  customerId: string;
  customerName: string;
  workOrderId: string;
  jobReference: string;
  /** `YYYY-MM-DD`, or `null` for a draft that has none yet. */
  issueDate: string | null;
  dueDate: string | null;
  currencyCode: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  /** Whole days past the due date in the business time zone; `0` unless the invoice is overdue. */
  daysOverdue: number;
  createdAt: string;
}

/** How many invoices each status chip would show, with the other filters applied. */
export interface AdminInvoiceListMeta {
  counts: Record<InvoiceStatus, number> & { all: number };
}

export interface AdminInvoiceListResponse extends PaginatedResponse<AdminInvoiceListItemDto> {
  meta: AdminInvoiceListMeta;
}

// ---- One invoice -----------------------------------------------------------------------------

/** The customer as an invoice prints them: a snapshot once issued, the current record before. */
export interface InvoiceCustomerDto {
  name: string;
  email: string;
  address: QuotationAddressDto;
}

/** One payment on an invoice, voided ones included: payment history is permanent (BR-16). */
export interface InvoicePaymentDto {
  id: string;
  amount: string;
  /** `YYYY-MM-DD`. */
  paymentDate: string;
  method: PaymentMethod;
  methodLabel: string;
  reference: string | null;
  notes: string | null;
  recordedBy: { name: string } | null;
  createdAt: string;
  /** Set when the payment was voided. */
  voided: { at: string; by: { name: string } | null; reason: string } | null;
}

/** A neighbouring record the invoice points to. */
export interface InvoiceLinkDto {
  id: string;
  reference: string;
}

/**
 * `GET /admin/invoices/:id`: an invoice in full, for the business. For a draft the business, customer,
 * payment instructions and footer are the current ones (a preview); once issued they are the snapshot
 * taken at the moment of issue, whatever the settings say now (DM-04).
 */
export interface AdminInvoiceDto {
  id: string;
  invoiceNumber: string | null;
  /** What it is now: a stored `ISSUED` or `PARTIALLY_PAID` past its due date reads `OVERDUE`. */
  status: InvoiceStatus;
  statusLabel: string;
  currencyCode: string;
  /** A percentage, two decimal places. */
  taxRate: string;
  lines: QuotationLineDto[];
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  issueDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  customerNote: string | null;
  /** True when the business, customer, payment instructions and footer are the issue-time snapshot. */
  isSnapshot: boolean;
  business: QuotationBusinessDto;
  customer: InvoiceCustomerDto;
  paymentInstructions: string | null;
  footer: string | null;
  serviceName: string;
  customerId: string;
  job: InvoiceLinkDto;
  request: InvoiceLinkDto;
  quotation: InvoiceLinkDto | null;
  /** Payments recorded, oldest first, voided ones too. */
  payments: InvoicePaymentDto[];
  createdAt: string;
  /** The stored `updatedAt`, which a save sends back as `expectedUpdatedAt`. */
  updatedAt: string;
  issuedAt: string | null;
  createdBy: { name: string };
  issuedBy: { name: string } | null;
  /** Set when the invoice was voided. The reason is internal. */
  voided: { at: string; by: { name: string } | null; reason: string } | null;
  /** The business time zone (IANA) the instants are shown in. */
  timeZone: string;
  timeline: AdminTimelineEventDto[];
  /** What the admin may do now, the most likely step first (D-43). */
  availableActions: InvoiceAction[];
}

/** The invoice a job points to: shown on the job's page. */
export interface JobInvoiceLinkDto {
  id: string;
  /** `null` for a draft. */
  invoiceNumber: string | null;
  status: InvoiceStatus;
  statusLabel: string;
}

// ---- The customer's view (T22, D-41) -------------------------------------------------------------

/**
 * The statuses a customer can ever be shown: an invoice that was issued. A draft is the business's
 * working copy and a draft that was voided never reached the customer (D-26, D-110).
 */
export const CUSTOMER_INVOICE_STATUSES = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.VOID,
] as const satisfies readonly InvoiceStatus[];

/** The statuses that still owe money: the "Outstanding" filter and the portal's overview section. */
export const OUTSTANDING_INVOICE_STATUSES = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
] as const satisfies readonly InvoiceStatus[];

export const CUSTOMER_INVOICE_SORT_FIELDS = ["issueDate", "dueDate", "totalAmount"] as const;
export type CustomerInvoiceSortField = (typeof CUSTOMER_INVOICE_SORT_FIELDS)[number];

/** One row of `GET /invoices/me`. */
export interface CustomerInvoiceListItemDto {
  id: string;
  /** Always set: a customer is only shown invoices that were issued. */
  invoiceNumber: string;
  /** What the invoice is now, overdue included. */
  status: InvoiceStatus;
  statusLabel: string;
  /** `YYYY-MM-DD`. */
  issueDate: string;
  dueDate: string;
  currencyCode: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  /** Whole days past the due date in the business time zone; `0` unless the invoice is overdue. */
  daysOverdue: number;
  serviceName: string;
  jobReference: string;
}

export type CustomerInvoiceListResponse = PaginatedResponse<CustomerInvoiceListItemDto>;

/**
 * A payment as its customer sees it: when, how and how much. Only payments that stand are listed: a
 * payment the business voided is left out, and `amountPaid` is already the total without it (D-110).
 * The reference, the notes, who recorded it and any void reason stay with the business.
 */
export interface CustomerInvoicePaymentDto {
  id: string;
  /** `YYYY-MM-DD`. */
  paymentDate: string;
  method: PaymentMethod;
  methodLabel: string;
  amount: string;
}

/**
 * `GET /invoices/:id`: an invoice as its customer sees it. An admin who opens the same address gets
 * this same shape (a draft only as a preview). The business, customer, instructions and footer are
 * the snapshot taken when it was issued (DM-04). Nothing internal is in it: no internal notes, no
 * staff names, no payment notes or references, no void reason.
 */
export interface CustomerInvoiceDto extends CustomerInvoiceListItemDto {
  /** A percentage, two decimal places. */
  taxRate: string;
  lines: QuotationLineDto[];
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  customerNote: string | null;
  business: QuotationBusinessDto;
  customer: InvoiceCustomerDto;
  paymentInstructions: string | null;
  footer: string | null;
  job: InvoiceLinkDto;
  request: InvoiceLinkDto;
  /** Payments that stand, oldest first. */
  payments: CustomerInvoicePaymentDto[];
  /** The day the last payment was received, once the invoice is paid in full; otherwise `null`. */
  paidOn: string | null;
  /** When the business withdrew the invoice, as an ISO instant; `null` unless it is void. */
  voidedAt: string | null;
  /** The business time zone (IANA) the instants are shown in. */
  timeZone: string;
}

/** The invoice a customer's job points to (T22): the issued invoice that is not void. */
export interface CustomerJobInvoiceLinkDto {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  statusLabel: string;
}
