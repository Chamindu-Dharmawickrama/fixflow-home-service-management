import type { CustomerTimelineEventDto } from "./activity.js";
import type { PaginatedResponse } from "./api.js";
import { PreferredWindow, ServiceRequestStatus } from "./enums.js";
import type { CustomerQuotationSummaryDto } from "./quotations.js";

/**
 * Service requests as a customer sees them (FR-020 to FR-022, D-35, D-41). The customer shapes
 * are deliberately narrow: no internal note, no staff identity and no id of another record is in
 * them. The staff view of a request is a separate set of shapes (T12).
 */

// ---- Preferred window (D-35) -----------------------------------------------------------------

export interface PreferredWindowDefinition {
  readonly label: string;
  /** Start hour on the business's wall clock, 0 to 23. */
  readonly startHour: number;
  /** End hour on the business's wall clock, later than the start. */
  readonly endHour: number;
}

/**
 * The three windows a customer can choose, on the business's wall clock (`timeZone` in the
 * settings). The hours are fixed by D-35; the server turns a chosen date and window into UTC
 * instants, so the stored times are right on days when the clocks change.
 */
export const PREFERRED_WINDOWS = {
  [PreferredWindow.MORNING]: { label: "Morning", startHour: 8, endHour: 12 },
  [PreferredWindow.AFTERNOON]: { label: "Afternoon", startHour: 12, endHour: 16 },
  [PreferredWindow.EVENING]: { label: "Evening", startHour: 16, endHour: 19 },
} as const satisfies Record<PreferredWindow, PreferredWindowDefinition>;

/** The windows in the order they are offered. */
export const PREFERRED_WINDOW_ORDER: readonly PreferredWindow[] = [
  PreferredWindow.MORNING,
  PreferredWindow.AFTERNOON,
  PreferredWindow.EVENING,
];

function hourText(hour: number): string {
  const suffix = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${hour % 12 || 12}:00 ${suffix}`;
}

/** `"8:00 AM – 12:00 PM"`: the window's hours on the business's clock. */
export function preferredWindowHours(window: PreferredWindow): string {
  const { startHour, endHour } = PREFERRED_WINDOWS[window];
  return `${hourText(startHour)} – ${hourText(endHour)}`;
}

/** `"Morning (8:00 AM – 12:00 PM)"`, for lists and summaries. */
export function preferredWindowText(window: PreferredWindow): string {
  return `${PREFERRED_WINDOWS[window].label} (${preferredWindowHours(window)})`;
}

// ---- Status wording --------------------------------------------------------------------------

/** The customer-facing name of each request status (the web badge shows the same words). */
export const REQUEST_STATUS_LABELS = {
  [ServiceRequestStatus.SUBMITTED]: "Submitted",
  [ServiceRequestStatus.UNDER_REVIEW]: "Under review",
  [ServiceRequestStatus.QUOTED]: "Quoted",
  [ServiceRequestStatus.ACCEPTED]: "Accepted",
  [ServiceRequestStatus.DECLINED]: "Declined",
  [ServiceRequestStatus.CONVERTED_TO_JOB]: "Converted to job",
  [ServiceRequestStatus.CANCELLED]: "Cancelled",
} as const satisfies Record<ServiceRequestStatus, string>;

/**
 * What happens next, in the customer's words, for each request status. It answers "what do I do or
 * wait for now?" and is the same on the list, the detail page and the confirmation. Written in the
 * second person, as every customer-facing status sentence is.
 */
export const REQUEST_NEXT_STEPS = {
  [ServiceRequestStatus.SUBMITTED]: "We're reviewing your request and will send a quotation.",
  [ServiceRequestStatus.UNDER_REVIEW]:
    "We're preparing your quotation and will let you know as soon as it's ready.",
  [ServiceRequestStatus.QUOTED]: "Your quotation is ready. Review it, then accept or decline it.",
  [ServiceRequestStatus.ACCEPTED]:
    "Thank you for accepting. We'll schedule your visit and confirm the time with you.",
  [ServiceRequestStatus.DECLINED]:
    "You declined the quotation, so no work will be scheduled. You can send a new request any time.",
  [ServiceRequestStatus.CONVERTED_TO_JOB]:
    "Your job has been created. We'll confirm the visit time with you.",
  [ServiceRequestStatus.CANCELLED]:
    "This request was cancelled, so no work will be carried out. You can send a new request any time.",
} as const satisfies Record<ServiceRequestStatus, string>;

export function requestStatusLabel(status: ServiceRequestStatus): string {
  return REQUEST_STATUS_LABELS[status];
}

export function requestNextStep(status: ServiceRequestStatus): string {
  return REQUEST_NEXT_STEPS[status];
}

// ---- Request body ----------------------------------------------------------------------------

/** An address typed into the request form instead of chosen from the saved ones. */
export interface NewRequestAddress {
  /** Only needed (and only stored) when the address is saved to the profile. */
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  accessNotes?: string | null;
}

/** Where the work is done: one of the customer's saved addresses, or a new one. */
export type RequestAddressChoice =
  { serviceAddressId: string } | { newAddress: NewRequestAddress; saveAddressToProfile: boolean };

/** `POST /api/v1/requests`. Everything else (owner, reference, status, times) is the server's. */
export type CreateServiceRequestBody = {
  serviceId: string;
  description: string;
  /** `YYYY-MM-DD` in the business time zone, from tomorrow to 90 days ahead. */
  preferredDate: string;
  preferredWindow: PreferredWindow;
  /** A UUID the form makes once; sending it again returns the first request instead of a second one (D-45). */
  submissionKey: string;
} & RequestAddressChoice;

// ---- Responses -------------------------------------------------------------------------------

/** The address a request was made with: a copy, so later edits to the saved address do not change it (D-36). */
export interface RequestAddressDto {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  /** Private to the customer and the business team. */
  accessNotes: string | null;
}

/** A note the business chose to show the customer. Internal notes never reach this shape. */
export interface CustomerRequestNoteDto {
  id: string;
  body: string;
  /** `"You"` or the business name, never a staff member's name. */
  author: string;
  createdAt: string;
}

/** One row of the customer's request list. */
export interface CustomerRequestListItemDto {
  id: string;
  /** `FF-YYYY-NNNNN`. A label to read out, never a key that grants access (BR-21). */
  reference: string;
  status: ServiceRequestStatus;
  statusLabel: string;
  nextStep: string;
  /** The service's name when the request was made. */
  serviceName: string;
  preferredDate: string;
  preferredWindow: PreferredWindow;
  submittedAt: string;
}

/**
 * What the customer is told about a cancelled request. The message is the one the business chose to
 * send (FR-026); the internal reason is never part of this shape (BR-19).
 */
export interface CustomerRequestCancellationDto {
  cancelledAt: string;
  /** The business's message to the customer, or `null` when it gave none. */
  message: string | null;
}

/**
 * `GET /api/v1/requests/:id` and the answer to `POST /api/v1/requests`: a request in full, as its
 * owner sees it. An admin who opens the same URL gets this same shape (D-41).
 */
export interface CustomerRequestDto extends CustomerRequestListItemDto {
  description: string;
  address: RequestAddressDto;
  /** The preferred window as UTC instants, worked out in the business time zone (D-35). */
  preferredStart: string;
  preferredEnd: string;
  /** Only for a cancelled request; `null` otherwise. */
  cancellation: CustomerRequestCancellationDto | null;
  /**
   * The quotations the customer was sent for this request, newest first (T15). The first is the
   * current one. A draft is never in the list.
   */
  quotations: CustomerQuotationSummaryDto[];
  notes: CustomerRequestNoteDto[];
  timeline: CustomerTimelineEventDto[];
}

/** `GET /api/v1/requests/me`. */
export type CustomerRequestListResponse = PaginatedResponse<CustomerRequestListItemDto>;
