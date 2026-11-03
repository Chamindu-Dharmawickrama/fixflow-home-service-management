import type { AdminTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import { QuotationStatus, type ServiceRequestStatus } from "./enums.js";
import type { RequestAddressDto } from "./requests.js";
import type { PublicSettingsDto } from "./settings.js";

/**
 * Quotations (FR-040 to FR-047, D-19, D-22, D-41, D-43). Like every record they have two shapes: the
 * customer's {@link CustomerQuotationDto}, a short allowlist with nothing internal in it, and the
 * business's {@link AdminQuotationDto}, which adds who did what, the internal void reason, the
 * replacement chain, the history and the actions the server allows. Money is a decimal string next
 * to an explicit `currencyCode`; dates are ISO 8601 instants, or `YYYY-MM-DD` for `validUntil`.
 */

/** What an admin can do to a quotation from where it stands (D-43). The screen offers these and no others. */
export const QuotationAction = {
  /** Change the lines, discount, tax rate, validity, terms and note: drafts only. */
  EDIT: "EDIT",
  /** Publish the draft to the customer. */
  SEND: "SEND",
  /** Withdraw the quotation with a reason: a draft or a sent one. */
  VOID: "VOID",
  /** Start a replacement draft from a sent quotation. */
  REPLACE: "REPLACE",
  /**
   * Turn the accepted quotation into a job (T17). Listed only while the request is still `ACCEPTED`,
   * so it disappears once the job exists.
   */
  CREATE_WORK_ORDER: "CREATE_WORK_ORDER",
} as const;
export type QuotationAction = (typeof QuotationAction)[keyof typeof QuotationAction];

/** The name of each status on a badge and in a sentence; the same words for staff and customer. */
export const QUOTATION_STATUS_LABELS = {
  [QuotationStatus.DRAFT]: "Draft",
  [QuotationStatus.SENT]: "Sent",
  [QuotationStatus.ACCEPTED]: "Accepted",
  [QuotationStatus.DECLINED]: "Declined",
  [QuotationStatus.EXPIRED]: "Expired",
  [QuotationStatus.VOID]: "Void",
} as const satisfies Record<QuotationStatus, string>;

export function quotationStatusLabel(status: QuotationStatus): string {
  return QUOTATION_STATUS_LABELS[status];
}

// ---- Request bodies --------------------------------------------------------------------------

/** One line as sent to the API. Amounts are text, so nothing passes through a float. */
export interface QuotationLineBody {
  description: string;
  /** Greater than zero, at most two decimal places. */
  quantity: string;
  unitPrice: string;
  taxable: boolean;
}

/** `POST /admin/requests/:id/quotations`. */
export interface CreateQuotationBody {
  /** The sent quotation this one replaces. Its lines are copied. */
  replacesQuotationId?: string;
}

/**
 * `PATCH /admin/quotations/:id` (drafts only). The server works out every total from these lines;
 * a body that names a total is refused rather than ignored, so a client cannot believe it set one.
 */
export interface UpdateQuotationBody {
  lines: QuotationLineBody[];
  discountAmount: string;
  /** A percentage: `"8.00"` means 8 %. */
  taxRate: string;
  /** `YYYY-MM-DD`: the last day the customer may answer, in the business time zone. */
  validUntil: string;
  /** Shown to the customer. `null` clears it. */
  terms: string | null;
  customerNote: string | null;
  /** The `updatedAt` the editor loaded. A different stored value is `409 STALE_STATE`. */
  expectedUpdatedAt: string;
}

/** `POST /admin/quotations/:id/send`. */
export interface SendQuotationBody {
  /** The status the screen showed; anything but `DRAFT` is `409 STALE_STATE` (D-46). */
  expectedStatus: typeof QuotationStatus.DRAFT;
}

/** `POST /admin/quotations/:id/void`. */
export interface VoidQuotationBody {
  /** 5 to 500 characters. Internal: the customer never reads it. */
  reason: string;
  expectedStatus: typeof QuotationStatus.DRAFT | typeof QuotationStatus.SENT;
  /** Only for a sent quotation: a message the withdrawn notice carries. Without one the customer gets a standard line. */
  customerMessage?: string;
}

/**
 * `POST /quotations/:id/decline` (T15). The reason is the customer's own words and optional; it is
 * kept with the quotation and read by the business.
 */
export interface DeclineQuotationBody {
  /** At most 500 characters. */
  reason?: string;
}

// ---- Responses -------------------------------------------------------------------------------

export interface QuotationLineDto {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
  /** `quantity × unitPrice`, worked out by the server. */
  lineTotal: string;
}

/** The business as the document shows it: from the settings, never from the browser. */
export interface QuotationBusinessDto {
  name: string;
  tagline: string | null;
  logoKey: string | null;
  logoUrl: string | null;
  email: string;
  phone: string;
  address: PublicSettingsDto["address"];
}

/** The service address as a document prints it. Access notes stay on the request. */
export type QuotationAddressDto = Omit<RequestAddressDto, "accessNotes">;

/**
 * Everything a quotation document shows, and nothing that is internal. Both audiences read it: the
 * customer gets exactly this, and the business's read-only view and preview draw the same document.
 */
export interface QuotationDocumentDto {
  id: string;
  reference: string;
  /** What the quotation is now: a sent one past its last day reads `EXPIRED` even before it is saved so. */
  status: QuotationStatus;
  statusLabel: string;
  requestReference: string;
  serviceName: string;
  customerName: string;
  address: QuotationAddressDto;
  business: QuotationBusinessDto;
  currencyCode: string;
  /** A percentage, two decimal places. */
  taxRate: string;
  lines: QuotationLineDto[];
  subtotal: string;
  discountAmount: string;
  /** The part of the subtotal that tax is charged on, after the discount's share. */
  taxableBase: string;
  taxAmount: string;
  totalAmount: string;
  /** `YYYY-MM-DD`: the customer may answer until the end of this day in the business time zone. */
  validUntil: string;
  terms: string | null;
  customerNote: string | null;
  /** When it was published to the customer; `null` for a draft. */
  sentAt: string | null;
  /** When the customer answered, or `null`. */
  respondedAt: string | null;
}

/** The quotation that took a withdrawn one's place, once it has been sent to the customer. */
export interface QuotationReplacementDto {
  id: string;
  reference: string;
}

/**
 * `GET /quotations/:id`, and the answer to accepting or declining it: what the customer sees. The key
 * list is pinned by a test, so a column added to the table never reaches a customer by accident.
 */
export interface CustomerQuotationDto extends QuotationDocumentDto {
  /** The customer's own request, for the link back. */
  requestId: string;
  /**
   * The quotation that replaced this one, only once the customer has been sent it (a draft
   * replacement is not theirs to know about). Lets a withdrawn quotation point to the current one.
   */
  replacedBy: QuotationReplacementDto | null;
  /** True only when an admin looks at a draft the customer cannot see yet. */
  preview: boolean;
}

/**
 * A quotation the customer was sent, in a list: on their request's page and in "Awaiting your
 * decision". Never a draft, and nothing internal. `status` is what it is now (a sent one past its last
 * day reads `EXPIRED`).
 */
export interface CustomerQuotationSummaryDto {
  id: string;
  reference: string;
  status: QuotationStatus;
  statusLabel: string;
  totalAmount: string;
  currencyCode: string;
  /** `YYYY-MM-DD`: the customer may answer until the end of this day in the business time zone. */
  validUntil: string;
  sentAt: string;
  respondedAt: string | null;
  replacedBy: QuotationReplacementDto | null;
}

/** One row of `GET /quotations/me`: the summary and the request it belongs to. */
export interface CustomerQuotationListItemDto extends CustomerQuotationSummaryDto {
  requestId: string;
  requestReference: string;
  serviceName: string;
}

/** `GET /quotations/me`: the customer's non-draft quotations, the ones awaiting an answer first. */
export type CustomerQuotationListResponse = PaginatedResponse<CustomerQuotationListItemDto>;

/** A quotation in a list (the request page, a customer's history). */
export interface QuotationSummaryDto {
  id: string;
  reference: string;
  status: QuotationStatus;
  statusLabel: string;
  totalAmount: string;
  currencyCode: string;
  validUntil: string;
  sentAt: string | null;
  createdAt: string;
  /** The reference of the quotation this one replaces, or `null`. */
  replacesReference: string | null;
}

/** A neighbour in the replacement chain. */
export interface QuotationLinkDto {
  id: string;
  reference: string;
  status: QuotationStatus;
  statusLabel: string;
}

export interface AdminQuotationDto extends QuotationDocumentDto {
  requestId: string;
  requestStatus: ServiceRequestStatus;
  requestStatusLabel: string;
  customer: { id: string; name: string; email: string; phone: string | null };
  createdAt: string;
  /** The stored `updatedAt`, which a save sends back as `expectedUpdatedAt`. */
  updatedAt: string;
  createdBy: { name: string };
  sentBy: { name: string } | null;
  /** The customer's written reason for declining, or `null`. */
  declineReason: string | null;
  expiredAt: string | null;
  /** Set when the quotation was voided. The reason is internal. */
  voided: { at: string; by: { name: string } | null; reason: string } | null;
  /** The sent quotation this one replaces. */
  replaces: QuotationLinkDto | null;
  /** The quotation that replaced this one. */
  replacedBy: QuotationLinkDto | null;
  /** The history with staff summaries, oldest first. */
  timeline: AdminTimelineEventDto[];
  /** What the admin may do now, the most likely step first (D-43). */
  availableActions: QuotationAction[];
}
