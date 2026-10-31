import {
  type AdminPreviousRequestDto,
  type AdminRequestCancellationDto,
  type AdminRequestDto,
  type AdminRequestListItemDto,
  type AdminRequestNoteDto,
  type AdminTimelineEventDto,
  QuotationStatus,
  type QuotationSummaryDto,
  requestNextStep,
  requestStatusLabel,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { availableAdminActions, isNewRequest, toRequestAddress } from "./requests.domain.js";

/**
 * Serializers for the business's view of a request (D-41, CLAUDE.md §7). They are separate from the
 * customer's (`requests.dto.ts`) so the two audiences can never share a shape: this one carries the
 * customer's contact details, every note with its visibility and author, and the internal reason for
 * a cancellation. Nothing here is ever served to a customer.
 */

/** Columns the queue needs. A single query with the customer's name; no row triggers another. */
export const ADMIN_LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceNameSnapshot: true,
  addressCity: true,
  preferredDate: true,
  preferredWindow: true,
  submittedAt: true,
  updatedAt: true,
  customer: { select: { user: { select: { name: true } } } },
} as const satisfies Prisma.ServiceRequestSelect;

export type AdminListRow = Prisma.ServiceRequestGetPayload<{ select: typeof ADMIN_LIST_SELECT }>;

/** Everything on a request's detail page, in one query (the other customer data is fetched beside it). */
export const ADMIN_DETAIL_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceId: true,
  serviceNameSnapshot: true,
  description: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  accessNotesSnapshot: true,
  preferredDate: true,
  preferredWindow: true,
  preferredStart: true,
  preferredEnd: true,
  submittedAt: true,
  updatedAt: true,
  cancelReason: true,
  cancelCustomerMessage: true,
  cancelledAt: true,
  cancelledBy: { select: { name: true } },
  customerId: true,
  customer: { select: { id: true, phone: true, user: { select: { name: true, email: true } } } },
  notes: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      body: true,
      visibility: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  },
} as const satisfies Prisma.ServiceRequestSelect;

export type AdminDetailRow = Prisma.ServiceRequestGetPayload<{
  select: typeof ADMIN_DETAIL_SELECT;
}>;

/** The customer's earlier requests, for the side card. */
export const PREVIOUS_REQUEST_SELECT = {
  id: true,
  reference: true,
  serviceNameSnapshot: true,
  status: true,
  submittedAt: true,
} as const satisfies Prisma.ServiceRequestSelect;

export type PreviousRequestRow = Prisma.ServiceRequestGetPayload<{
  select: typeof PREVIOUS_REQUEST_SELECT;
}>;

export function toAdminRequestListItem(row: AdminListRow): AdminRequestListItemDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: requestStatusLabel(row.status),
    isNew: isNewRequest(row.status),
    serviceName: row.serviceNameSnapshot,
    customerName: row.customer.user.name,
    city: row.addressCity,
    preferredDate: toDateOnly(row.preferredDate),
    preferredWindow: row.preferredWindow,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPreviousRequest(row: PreviousRequestRow): AdminPreviousRequestDto {
  return {
    id: row.id,
    reference: row.reference,
    serviceName: row.serviceNameSnapshot,
    status: row.status,
    statusLabel: requestStatusLabel(row.status),
    submittedAt: row.submittedAt.toISOString(),
  };
}

export function toAdminNote(note: AdminDetailRow["notes"][number]): AdminRequestNoteDto {
  return {
    id: note.id,
    body: note.body,
    visibility: note.visibility,
    author: { name: note.author.name },
    createdAt: note.createdAt.toISOString(),
  };
}

function toCancellation(row: AdminDetailRow): AdminRequestCancellationDto | null {
  if (row.status !== ServiceRequestStatus.CANCELLED) {
    return null;
  }
  return {
    cancelledAt: (row.cancelledAt ?? row.updatedAt).toISOString(),
    cancelledBy: row.cancelledBy === null ? null : { name: row.cancelledBy.name },
    reason: row.cancelReason ?? "",
    customerMessage: row.cancelCustomerMessage,
  };
}

export interface CustomerHistory {
  previous: readonly PreviousRequestRow[];
  totalRequests: number;
  workOrderCount: number;
  invoiceCount: number;
}

/**
 * A request in full for the business: the customer's own fields, their contact details and history,
 * every note, every version of its quotation, the internal timeline and the actions the server
 * allows now (D-43).
 */
export function toAdminRequestDto(input: {
  row: AdminDetailRow;
  timeline: AdminTimelineEventDto[];
  history: CustomerHistory;
  /** Newest first. */
  quotations: QuotationSummaryDto[];
}): AdminRequestDto {
  const { row, timeline, history, quotations } = input;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: requestStatusLabel(row.status),
    nextStep: requestNextStep(row.status),
    serviceId: row.serviceId,
    serviceName: row.serviceNameSnapshot,
    preferredDate: toDateOnly(row.preferredDate),
    preferredWindow: row.preferredWindow,
    preferredStart: row.preferredStart.toISOString(),
    preferredEnd: row.preferredEnd.toISOString(),
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    description: row.description,
    address: toRequestAddress(row),
    customer: {
      id: row.customer.id,
      name: row.customer.user.name,
      email: row.customer.user.email,
      phone: row.customer.phone,
      previousRequests: history.previous.map(toPreviousRequest),
      totalRequests: history.totalRequests,
      workOrderCount: history.workOrderCount,
      invoiceCount: history.invoiceCount,
    },
    notes: row.notes.map(toAdminNote),
    timeline,
    cancellation: toCancellation(row),
    quotations,
    availableActions: availableAdminActions(row.status, {
      hasDraftQuotation: quotations.some((quotation) => quotation.status === QuotationStatus.DRAFT),
    }),
  };
}
