import type { AdminTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import type { NoteVisibility, PreferredWindow, ServiceRequestStatus } from "./enums.js";
import type { QuotationSummaryDto } from "./quotations.js";
import type { CustomerRequestDto } from "./requests.js";

/**
 * The business's view of service requests (FR-023 to FR-026, D-21, D-41, D-43). These shapes are
 * separate from the customer's on purpose: they carry the customer's contact details, every note
 * with its visibility, internal summaries and the actions the server allows. None of them is ever
 * served to a customer.
 */

/**
 * What an admin can do to a request from where it stands (D-43). The screen offers these and
 * nothing else; the server checks the action again when it is used. T15 lists `CREATE_WORK_ORDER`
 * for an accepted request; T17 builds it.
 */
export const RequestAction = {
  START_REVIEW: "START_REVIEW",
  CANCEL: "CANCEL",
  REOPEN: "REOPEN",
  /** Prepare a quotation (T14). It does not change the request's status, so it is not a status action. */
  CREATE_QUOTATION: "CREATE_QUOTATION",
  /**
   * Turn an accepted request into a job (T17). The customer's acceptance (T15) makes the server list
   * it; nothing performs it before T17, and the web draws no button for it until then. Like
   * `CREATE_QUOTATION` it is not a status action here: the status changes with the work order.
   */
  CREATE_WORK_ORDER: "CREATE_WORK_ORDER",
} as const;
export type RequestAction = (typeof RequestAction)[keyof typeof RequestAction];

/** The actions that move the request's status, which `PATCH /admin/requests/:id/status` accepts. */
export const REQUEST_STATUS_ACTIONS = [
  RequestAction.START_REVIEW,
  RequestAction.CANCEL,
  RequestAction.REOPEN,
] as const;
export type RequestStatusAction = (typeof REQUEST_STATUS_ACTIONS)[number];

/** The columns the queue can be sorted by (`status` follows the workflow order, not the alphabet). */
export const ADMIN_REQUEST_SORT_FIELDS = [
  "submittedAt",
  "updatedAt",
  "status",
  "reference",
] as const;
export type AdminRequestSortField = (typeof ADMIN_REQUEST_SORT_FIELDS)[number];

/** One row of the queue. */
export interface AdminRequestListItemDto {
  id: string;
  reference: string;
  status: ServiceRequestStatus;
  statusLabel: string;
  /** Waiting for its first look: the status is `SUBMITTED`. */
  isNew: boolean;
  /** The service's name when the request was made. */
  serviceName: string;
  customerName: string;
  /** The city of the service address. */
  city: string;
  preferredDate: string;
  preferredWindow: PreferredWindow;
  submittedAt: string;
  updatedAt: string;
}

/** How many requests there are in each status. Every status is present, with `0` when there is none. */
export type RequestStatusCounts = Record<ServiceRequestStatus, number>;

export interface AdminRequestListMeta {
  /**
   * Requests per status for the search, service, customer and date filters in force, **ignoring the
   * status filter**, so the chips can show what choosing another status would give.
   */
  statusCounts: RequestStatusCounts;
  /** The sum of `statusCounts`. */
  totalForFilters: number;
}

/** `GET /admin/requests`: the standard list envelope plus the status counts. */
export interface AdminRequestListResponse extends PaginatedResponse<AdminRequestListItemDto> {
  meta: AdminRequestListMeta;
}

/** A note as the business sees it: every note, internal or shared, with who wrote it. */
export interface AdminRequestNoteDto {
  id: string;
  body: string;
  visibility: NoteVisibility;
  /** The staff member who wrote it. */
  author: { name: string };
  createdAt: string;
}

/** An earlier request by the same customer. */
export interface AdminPreviousRequestDto {
  id: string;
  reference: string;
  serviceName: string;
  status: ServiceRequestStatus;
  statusLabel: string;
  submittedAt: string;
}

/** The customer behind a request, with what the business needs to judge and reach them. */
export interface AdminRequestCustomerDto {
  /** The customer's profile id, for the customer pages (T13) and the queue's `customerId` filter. */
  id: string;
  name: string;
  email: string;
  /** `null` when the customer gave none. */
  phone: string | null;
  /** The customer's other requests, newest first (at most ten). */
  previousRequests: AdminPreviousRequestDto[];
  /** All of the customer's requests, this one included. */
  totalRequests: number;
  /** Jobs and invoices the customer has had. The lists come with T13. */
  workOrderCount: number;
  invoiceCount: number;
}

/** Why and by whom a request was cancelled. The reason is internal. */
export interface AdminRequestCancellationDto {
  cancelledAt: string;
  cancelledBy: { name: string } | null;
  /** The internal reason (5 to 500 characters): staff only. */
  reason: string;
  /** What the customer was told, or `null` when the business sent no message. */
  customerMessage: string | null;
}

/**
 * `GET /admin/requests/:id`: everything the customer sees of a request, plus what only the business
 * sees. `statusLabel` and `nextStep` are the customer's wording, which is what the customer reads.
 */
export interface AdminRequestDto extends Omit<
  CustomerRequestDto,
  "notes" | "timeline" | "cancellation" | "quotations"
> {
  /** The service as it is now (`serviceName` is what it was called when the request was made). */
  serviceId: string;
  updatedAt: string;
  customer: AdminRequestCustomerDto;
  /** Every note, newest first. */
  notes: AdminRequestNoteDto[];
  /** The history with internal summaries and the staff who acted, oldest first. */
  timeline: AdminTimelineEventDto[];
  /** Only for a cancelled request. */
  cancellation: AdminRequestCancellationDto | null;
  /** Every version of the quotation, newest first: the draft, the sent one, the replaced and the voided. */
  quotations: QuotationSummaryDto[];
  /** What the admin may do now, the most likely next step first (D-43). */
  availableActions: RequestAction[];
}

/** `PATCH /admin/requests/:id/status`. */
export interface ChangeRequestStatusBody {
  action: RequestStatusAction;
  /** The status the screen showed. A different current status is `409 STALE_STATE` (D-46). */
  expectedStatus: ServiceRequestStatus;
  /** Required for `CANCEL` and `REOPEN`, 5 to 500 characters, internal. */
  reason?: string;
  /** Only with `CANCEL`: a message for the customer, up to 500 characters. */
  customerMessage?: string;
}

/** `POST /admin/requests/:id/notes`. */
export interface AddRequestNoteBody {
  body: string;
  visibility: NoteVisibility;
}
