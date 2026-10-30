import type { PaginatedResponse } from "./api.js";
import type { ServiceAddressDto } from "./customers.js";
import type {
  InvoiceStatus,
  PreferredWindow,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "./enums.js";

/**
 * The business's view of its customers (FR-031, FR-033, D-41, D-100). These shapes are separate
 * from the customer's own (`customers.ts`) on purpose: they carry the customer's whole history,
 * their money position and the team's private notes, none of which is ever served to a customer.
 */

/** The columns the customer list can be sorted by. */
export const ADMIN_CUSTOMER_SORT_FIELDS = ["name", "createdAt", "lastActivityAt"] as const;
export type AdminCustomerSortField = (typeof ADMIN_CUSTOMER_SORT_FIELDS)[number];

/**
 * The four kinds of record in a customer's history, in the order of the journey. Each is a tab on
 * the customer's page and a value of `GET /admin/customers/:id/history?type=`.
 */
export const CUSTOMER_HISTORY_TYPES = ["requests", "quotations", "jobs", "invoices"] as const;
export type CustomerHistoryType = (typeof CUSTOMER_HISTORY_TYPES)[number];

/** How many of each kind the customer's detail carries for a first look. */
export const CUSTOMER_RECENT_COUNT = 5;

/** How many internal notes the customer's detail carries; `noteCount` says how many exist. */
export const CUSTOMER_NOTES_SHOWN = 50;

/** One row of the customer list. */
export interface AdminCustomerListItemDto {
  /** The customer's profile id (the customer pages use it; the reference of a record never stands in for it). */
  id: string;
  name: string;
  email: string;
  /** `null` when the customer gave none. */
  phone: string | null;
  /** The city of the default service address, or `null` when there is no address. */
  city: string | null;
  requestCount: number;
  /** Jobs that are not completed or cancelled. */
  openJobCount: number;
  /** What the customer still owes on issued invoices, a decimal string such as `"1284.50"`. */
  outstandingBalance: string;
  /** The currency of {@link outstandingBalance}: the business's currency. */
  currencyCode: string;
  /** The latest recorded event about the customer, or when they signed up if there is none. */
  lastActivityAt: string;
  /** When the customer signed up. */
  createdAt: string;
}

/** `GET /admin/customers`: the standard list envelope. */
export type AdminCustomerListResponse = PaginatedResponse<AdminCustomerListItemDto>;

/** The counts and the money position at the top of a customer's page. */
export interface AdminCustomerSummaryDto {
  requestCount: number;
  quotationCount: number;
  /** Every job the customer has had. */
  jobCount: number;
  /** Jobs that are not completed or cancelled. */
  openJobCount: number;
  invoiceCount: number;
  /**
   * Σ (total − amount paid) over the customer's issued, partially paid and overdue invoices in the
   * business's currency (D-26), a decimal string.
   */
  outstandingBalance: string;
  currencyCode: string;
}

/** A pointer to the request a record belongs to (so a row can link to it). */
export interface CustomerHistoryRequestRefDto {
  id: string;
  reference: string;
}

/** A request in the customer's history. */
export interface CustomerHistoryRequestDto {
  id: string;
  reference: string;
  /** The service's name when the request was made. */
  serviceName: string;
  status: ServiceRequestStatus;
  preferredDate: string;
  preferredWindow: PreferredWindow;
  submittedAt: string;
}

/** A quotation in the customer's history. */
export interface CustomerHistoryQuotationDto {
  id: string;
  reference: string;
  status: QuotationStatus;
  totalAmount: string;
  currencyCode: string;
  validUntil: string;
  sentAt: string | null;
  createdAt: string;
  request: CustomerHistoryRequestRefDto;
}

/** A job (work order) in the customer's history. */
export interface CustomerHistoryJobDto {
  id: string;
  reference: string;
  serviceName: string;
  status: WorkOrderStatus;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  request: CustomerHistoryRequestRefDto;
}

/** An invoice in the customer's history. */
export interface CustomerHistoryInvoiceDto {
  id: string;
  /** `null` while it is a draft: the number is assigned when the invoice is issued (D-17). */
  invoiceNumber: string | null;
  status: InvoiceStatus;
  totalAmount: string;
  amountPaid: string;
  /** What is still owed: total − paid for an issued, partially paid or overdue invoice, otherwise `"0.00"`. */
  balanceDue: string;
  currencyCode: string;
  dueDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  request: CustomerHistoryRequestRefDto;
}

/** The row shape of each history type. */
export interface CustomerHistoryItemByType {
  requests: CustomerHistoryRequestDto;
  quotations: CustomerHistoryQuotationDto;
  jobs: CustomerHistoryJobDto;
  invoices: CustomerHistoryInvoiceDto;
}

/** `GET /admin/customers/:id/history?type=T`: one page of one kind of record. */
export type CustomerHistoryResponse<Type extends CustomerHistoryType = CustomerHistoryType> =
  PaginatedResponse<CustomerHistoryItemByType[Type]>;

/** The latest records of each kind, newest first. */
export interface AdminCustomerRecentDto {
  requests: CustomerHistoryRequestDto[];
  quotations: CustomerHistoryQuotationDto[];
  jobs: CustomerHistoryJobDto[];
  invoices: CustomerHistoryInvoiceDto[];
}

/** A private note about a customer. Staff only: no customer endpoint carries these. */
export interface AdminCustomerNoteDto {
  id: string;
  body: string;
  /** The staff member who wrote it. */
  author: { name: string };
  createdAt: string;
}

/** `GET /admin/customers/:id`. */
export interface AdminCustomerDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** When the customer signed up. */
  customerSince: string;
  lastActivityAt: string;
  /** Every saved address with its access notes, the default first. */
  addresses: ServiceAddressDto[];
  summary: AdminCustomerSummaryDto;
  /** The latest {@link CUSTOMER_RECENT_COUNT} of each kind. */
  recent: AdminCustomerRecentDto;
  /** The latest {@link CUSTOMER_NOTES_SHOWN} internal notes, newest first. */
  notes: AdminCustomerNoteDto[];
  /** How many internal notes exist in all. */
  noteCount: number;
}

/** `POST /admin/customers/:id/notes`. */
export interface AddCustomerNoteBody {
  body: string;
}
