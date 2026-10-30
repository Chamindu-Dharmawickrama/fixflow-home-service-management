import {
  type CustomerRequestDto,
  type CustomerRequestListItemDto,
  type CustomerRequestNoteDto,
  type CustomerTimelineEventDto,
  NoteVisibility,
  requestNextStep,
  requestStatusLabel,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { CUSTOMER_ACTOR_YOU } from "../activity/activity.dto.js";
import { toRequestAddress } from "./requests.domain.js";

/**
 * Serializers for the customer's view of a request (CLAUDE.md §7, D-41). Each is an explicit
 * allowlist: the database is asked for these columns only (`select`), and the DTO is built field by
 * field, so an internal note, a staff user id or a column added later cannot reach a customer by
 * accident. The staff view of a request is a different serializer (T12).
 */

export const REQUEST_LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceNameSnapshot: true,
  preferredDate: true,
  preferredWindow: true,
  submittedAt: true,
} as const satisfies Prisma.ServiceRequestSelect;

export type RequestListRow = Prisma.ServiceRequestGetPayload<{
  select: typeof REQUEST_LIST_SELECT;
}>;

/**
 * Everything on a request's detail page. The notes are filtered to the ones the business chose to
 * show (`CUSTOMER_VISIBLE`) by the query itself, and the serializer checks again.
 */
export const REQUEST_DETAIL_SELECT = {
  ...REQUEST_LIST_SELECT,
  customerId: true,
  description: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  accessNotesSnapshot: true,
  preferredStart: true,
  preferredEnd: true,
  // The customer is told when a request was cancelled and the message the business chose to send.
  // `cancelReason` (internal) is deliberately not selected.
  cancelledAt: true,
  cancelCustomerMessage: true,
  customer: { select: { userId: true } },
  notes: {
    where: { visibility: NoteVisibility.CUSTOMER_VISIBLE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, body: true, visibility: true, authorUserId: true, createdAt: true },
  },
} as const satisfies Prisma.ServiceRequestSelect;

export type RequestDetailRow = Prisma.ServiceRequestGetPayload<{
  select: typeof REQUEST_DETAIL_SELECT;
}>;

export function toCustomerRequestListItem(row: RequestListRow): CustomerRequestListItemDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: requestStatusLabel(row.status),
    nextStep: requestNextStep(row.status),
    serviceName: row.serviceNameSnapshot,
    preferredDate: toDateOnly(row.preferredDate),
    preferredWindow: row.preferredWindow,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export interface RequestViewer {
  businessName: string;
}

function toCustomerNote(
  note: RequestDetailRow["notes"][number],
  ownerUserId: string,
  viewer: RequestViewer,
): CustomerRequestNoteDto {
  // Fail closed: an internal note must never be serialized for a customer, whatever the query did.
  if (note.visibility !== NoteVisibility.CUSTOMER_VISIBLE) {
    throw new Error("An internal request note was passed to the customer serializer.");
  }
  return {
    id: note.id,
    body: note.body,
    author: note.authorUserId === ownerUserId ? CUSTOMER_ACTOR_YOU : viewer.businessName,
    createdAt: note.createdAt.toISOString(),
  };
}

/**
 * A request in full, as its owner sees it. An admin who opens the same URL gets this same shape:
 * "you" always means the owner, because this is what the customer sees (D-41).
 */
export function toCustomerRequestDto(input: {
  row: RequestDetailRow;
  timeline: CustomerTimelineEventDto[];
  viewer: RequestViewer;
}): CustomerRequestDto {
  const { row, timeline, viewer } = input;
  return {
    ...toCustomerRequestListItem(row),
    description: row.description,
    address: toRequestAddress(row),
    preferredStart: row.preferredStart.toISOString(),
    preferredEnd: row.preferredEnd.toISOString(),
    cancellation:
      row.status === ServiceRequestStatus.CANCELLED
        ? {
            cancelledAt: (row.cancelledAt ?? row.submittedAt).toISOString(),
            message: row.cancelCustomerMessage,
          }
        : null,
    notes: row.notes.map((note) => toCustomerNote(note, row.customer.userId, viewer)),
    timeline,
  };
}
