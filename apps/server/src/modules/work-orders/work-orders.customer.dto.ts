import {
  type CustomerTimelineEventDto,
  type CustomerWorkOrderDto,
  type CustomerWorkOrderListItemDto,
  type CustomerWorkOrderTechnicianDto,
  workOrderCustomerExplanation,
  WorkOrderStatus,
  workOrderStatusLabel,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import {
  CUSTOMER_JOB_INVOICE_SELECT,
  type CustomerJobInvoiceRow,
  toCustomerJobInvoiceLink,
} from "../invoices/invoices.customer.dto.js";
import type { InvoiceViewContext } from "../invoices/invoices.dto.js";
import { toRequestAddress } from "../requests/requests.domain.js";

/**
 * Serializers for the customer's view of a job (CLAUDE.md §7, D-41, BR-19). Each is an explicit
 * allowlist: the database is asked for these columns only (`select`), and the DTO is built field by
 * field. The internal completion note, the cancellation reason, the staff who acted, the
 * technician's phone, email and id, and any column added later cannot reach a customer, because
 * none is ever read. The business's view of a job is a different serializer (`work-orders.dto.ts`).
 */

/** The statuses in which the job has a visit the customer can plan around, or one that took place. */
const VISIT_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.COMPLETED,
];

/** The statuses whose appointment was given up: it is shown as history, never as a booking. */
const FORMER_VISIT_STATUSES: readonly WorkOrderStatus[] = [
  WorkOrderStatus.NEEDS_RESCHEDULING,
  WorkOrderStatus.CANCELLED,
];

/** What the customer's list reads of a job. The technician's name is the only column of theirs. */
export const CUSTOMER_LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceNameSnapshot: true,
  scheduledStart: true,
  scheduledEnd: true,
  completedAt: true,
  technician: { select: { name: true } },
} as const satisfies Prisma.WorkOrderSelect;

export type CustomerListRow = Prisma.WorkOrderGetPayload<{ select: typeof CUSTOMER_LIST_SELECT }>;

/**
 * Everything on a job's page. `internalCompletionNote`, `cancelReason`, `createdByUserId` and the
 * technician's contact details are deliberately not selected.
 */
export const CUSTOMER_DETAIL_SELECT = {
  ...CUSTOMER_LIST_SELECT,
  customerId: true,
  scopeDescription: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  accessNotesSnapshot: true,
  startedAt: true,
  cancelledAt: true,
  completionNote: true,
  request: { select: { id: true, reference: true } },
  quotation: { select: { id: true, reference: true } },
  // The invoice the customer may see: issued and not void. A draft, or one that was voided, is the
  // business's, so the job says nothing of it. At most one is live (a partial unique index).
  invoices: {
    where: { issuedAt: { not: null }, voidedAt: null, status: { not: "VOID" } },
    select: CUSTOMER_JOB_INVOICE_SELECT,
    take: 1,
  },
} as const satisfies Prisma.WorkOrderSelect;

export type CustomerDetailRow = Prisma.WorkOrderGetPayload<{
  select: typeof CUSTOMER_DETAIL_SELECT;
}>;

/**
 * What a customer is shown of a technician: the first name they would be greeted by. The rest of the
 * name, and every way to reach them, stay with the business.
 */
export function technicianDisplayName(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first === undefined || first === "" ? "Your technician" : first;
}

function toVisit(row: CustomerListRow): {
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technician: CustomerWorkOrderTechnicianDto | null;
} {
  const hasVisit =
    VISIT_STATUSES.includes(row.status) && row.scheduledStart !== null && row.scheduledEnd !== null;
  return {
    scheduledStart: hasVisit ? (row.scheduledStart?.toISOString() ?? null) : null,
    scheduledEnd: hasVisit ? (row.scheduledEnd?.toISOString() ?? null) : null,
    // The technician is named only for a visit that stands or took place, never for a job whose
    // visit was given up: that person is no longer coming.
    technician:
      hasVisit && row.technician !== null
        ? { displayName: technicianDisplayName(row.technician.name) }
        : null,
  };
}

export function toCustomerWorkOrderListItem(row: CustomerListRow): CustomerWorkOrderListItemDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: workOrderStatusLabel(row.status),
    serviceName: row.serviceNameSnapshot,
    ...toVisit(row),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/**
 * A job in full, as its owner sees it. An admin who opens the same address gets this same shape: it
 * is what the customer sees (D-41).
 */
export function toCustomerWorkOrderDto(input: {
  row: CustomerDetailRow;
  timeline: CustomerTimelineEventDto[];
  timeZone: string;
  /** When the invoice is read: whether it is overdue is judged from this. */
  now: Date;
}): CustomerWorkOrderDto {
  const { row, timeline, timeZone, now } = input;
  const invoiceContext: InvoiceViewContext = { now, timeZone };
  const invoice: CustomerJobInvoiceRow | undefined = row.invoices[0];
  const completed = row.status === WorkOrderStatus.COMPLETED;
  const hadVisit =
    FORMER_VISIT_STATUSES.includes(row.status) &&
    row.scheduledStart !== null &&
    row.scheduledEnd !== null;

  return {
    ...toCustomerWorkOrderListItem(row),
    statusExplanation: workOrderCustomerExplanation(row.status),
    timeZone,
    scopeDescription: row.scopeDescription,
    address: toRequestAddress(row),
    previouslyScheduled:
      hadVisit && row.scheduledStart !== null && row.scheduledEnd !== null
        ? { start: row.scheduledStart.toISOString(), end: row.scheduledEnd.toISOString() }
        : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    // The summary is the customer's to read, but only once the work is done.
    completionNote: completed ? row.completionNote : null,
    request: { id: row.request.id, reference: row.request.reference },
    quotation: { id: row.quotation.id, reference: row.quotation.reference },
    invoice: invoice === undefined ? null : toCustomerJobInvoiceLink(invoice, invoiceContext),
    timeline,
  };
}
