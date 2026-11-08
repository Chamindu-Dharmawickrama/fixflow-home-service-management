import {
  type AdminTimelineEventDto,
  type AdminWorkOrderDto,
  type AdminWorkOrderListItemDto,
  type CalendarItemDto,
  type CalendarWaitingJobDto,
  type RequestAddressDto,
  type SchedulingConflictDto,
  workOrderStatusLabel,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import {
  type InvoiceViewContext,
  JOB_INVOICE_SELECT,
  type JobInvoiceRow,
  toJobInvoiceLink,
} from "../invoices/invoices.dto.js";
import { toQuotationLines } from "../quotations/quotations.dto.js";
import { colorOf } from "../technicians/technicians.dto.js";
import { availableWorkOrderActions, type ConflictingJob } from "./work-orders.domain.js";

/**
 * Serializers for work orders (D-41, CLAUDE.md §7). Every shape here is the business's: it carries
 * the customer's contact details, the technician's, the access notes, the internal notes and the
 * internal history. The customer's own view of a job is built by its own function in
 * `work-orders.customer.dto.ts`, field by field, and nothing here is ever handed to a customer. Each is built from named fields, never by spreading a row, so a column
 * added to the table cannot reach a response by accident.
 */

const TECHNICIAN_REF_SELECT = { id: true, name: true, calendarColor: true } as const;

/** What the list reads of a work order. */
export const ADMIN_LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceNameSnapshot: true,
  addressCity: true,
  scheduledStart: true,
  scheduledEnd: true,
  completedAt: true,
  createdAt: true,
  technician: { select: TECHNICIAN_REF_SELECT },
  customer: { select: { user: { select: { name: true } } } },
} as const satisfies Prisma.WorkOrderSelect;

export type AdminListRow = Prisma.WorkOrderGetPayload<{ select: typeof ADMIN_LIST_SELECT }>;

export function toAdminWorkOrderListItem(row: AdminListRow): AdminWorkOrderListItemDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: workOrderStatusLabel(row.status),
    serviceName: row.serviceNameSnapshot,
    customerName: row.customer.user.name,
    city: row.addressCity,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    technician:
      row.technician === null
        ? null
        : {
            id: row.technician.id,
            name: row.technician.name,
            calendarColor: colorOf(row.technician.calendarColor),
          },
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function technicianRef(row: AdminListRow["technician"]): AdminWorkOrderListItemDto["technician"] {
  return row === null
    ? null
    : { id: row.id, name: row.name, calendarColor: colorOf(row.calendarColor) };
}

/**
 * A visit on the calendar (T19), from the list's columns. Only a job with both times is a visit: a
 * row without them is skipped by the caller, so the shape never carries a null time.
 */
export function toCalendarItem(row: AdminListRow): CalendarItemDto | null {
  if (row.scheduledStart === null || row.scheduledEnd === null) {
    return null;
  }
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: workOrderStatusLabel(row.status),
    start: row.scheduledStart.toISOString(),
    end: row.scheduledEnd.toISOString(),
    technician: technicianRef(row.technician),
    customerName: row.customer.user.name,
    serviceName: row.serviceNameSnapshot,
    city: row.addressCity,
    availableActions: availableWorkOrderActions(row.status),
  };
}

/** A job waiting for a time, as the calendar's side panel lists it. */
export function toCalendarWaitingJob(row: AdminListRow): CalendarWaitingJobDto {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: workOrderStatusLabel(row.status),
    serviceName: row.serviceNameSnapshot,
    customerName: row.customer.user.name,
    city: row.addressCity,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    technician: technicianRef(row.technician),
  };
}

/** What the detail reads of a work order: the row and the records it points to. */
export const ADMIN_DETAIL_SELECT = {
  id: true,
  reference: true,
  status: true,
  scopeDescription: true,
  serviceId: true,
  serviceNameSnapshot: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  accessNotesSnapshot: true,
  scheduledStart: true,
  scheduledEnd: true,
  startedAt: true,
  completedAt: true,
  completionNote: true,
  internalCompletionNote: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  technician: {
    select: { ...TECHNICIAN_REF_SELECT, phone: true, email: true, isActive: true },
  },
  customer: { select: { id: true, phone: true, user: { select: { name: true, email: true } } } },
  request: { select: { id: true, reference: true } },
  // The invoice that is not void: at most one (a partial unique index), so the job's link is this row.
  invoices: { where: { status: { not: "VOID" } }, select: JOB_INVOICE_SELECT, take: 1 },
  quotation: {
    select: {
      id: true,
      reference: true,
      currencyCode: true,
      subtotal: true,
      discountAmount: true,
      taxRate: true,
      taxAmount: true,
      totalAmount: true,
      lineItems: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          description: true,
          quantity: true,
          unitPrice: true,
          taxable: true,
          lineSubtotal: true,
        },
      },
    },
  },
} as const satisfies Prisma.WorkOrderSelect;

export type AdminDetailRow = Prisma.WorkOrderGetPayload<{ select: typeof ADMIN_DETAIL_SELECT }>;

function toAddress(row: AdminDetailRow): RequestAddressDto {
  return {
    line1: row.addressLine1,
    line2: row.addressLine2,
    city: row.addressCity,
    region: row.addressRegion,
    postalCode: row.addressPostalCode,
    accessNotes: row.accessNotesSnapshot,
  };
}

export function toAdminWorkOrderDto(
  row: AdminDetailRow,
  timeline: AdminTimelineEventDto[],
  invoiceContext: InvoiceViewContext,
): AdminWorkOrderDto {
  const { quotation, technician, customer } = row;
  const liveInvoice: JobInvoiceRow | undefined = row.invoices[0];
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    statusLabel: workOrderStatusLabel(row.status),
    scopeDescription: row.scopeDescription,
    serviceId: row.serviceId,
    serviceName: row.serviceNameSnapshot,
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    technician:
      technician === null
        ? null
        : {
            id: technician.id,
            name: technician.name,
            calendarColor: colorOf(technician.calendarColor),
            phone: technician.phone,
            email: technician.email,
            isActive: technician.isActive,
          },
    customer: {
      id: customer.id,
      name: customer.user.name,
      email: customer.user.email,
      phone: customer.phone,
    },
    address: toAddress(row),
    request: { id: row.request.id, reference: row.request.reference },
    quotation: {
      id: quotation.id,
      reference: quotation.reference,
      currencyCode: quotation.currencyCode,
      subtotal: quotation.subtotal.toFixed(2),
      discountAmount: quotation.discountAmount.toFixed(2),
      taxRate: quotation.taxRate.toFixed(2),
      taxAmount: quotation.taxAmount.toFixed(2),
      totalAmount: quotation.totalAmount.toFixed(2),
      lines: toQuotationLines(quotation.lineItems),
    },
    invoice: liveInvoice === undefined ? null : toJobInvoiceLink(liveInvoice, invoiceContext),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completionNote: row.completionNote,
    internalCompletionNote: row.internalCompletionNote,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdBy: { name: row.createdBy.name },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    timeline,
    availableActions: availableWorkOrderActions(row.status, {
      hasLiveInvoice: liveInvoice !== undefined,
    }),
  };
}

/** What the pre-check and a day's schedule read of a job that holds a technician's time. */
export const CONFLICT_SELECT = {
  id: true,
  reference: true,
  status: true,
  serviceNameSnapshot: true,
  scheduledStart: true,
  scheduledEnd: true,
  customer: { select: { user: { select: { name: true } } } },
} as const satisfies Prisma.WorkOrderSelect;

export type ConflictRow = Prisma.WorkOrderGetPayload<{ select: typeof CONFLICT_SELECT }>;

/** A booked job as a conflict report shows it. A booked job always has both times; one without is skipped. */
export function toSchedulingConflicts(rows: readonly ConflictRow[]): SchedulingConflictDto[] {
  return rows.flatMap((row) =>
    row.scheduledStart === null || row.scheduledEnd === null
      ? []
      : [
          {
            id: row.id,
            reference: row.reference,
            status: row.status,
            scheduledStart: row.scheduledStart.toISOString(),
            scheduledEnd: row.scheduledEnd.toISOString(),
            serviceName: row.serviceNameSnapshot,
            customerName: row.customer.user.name,
          },
        ],
  );
}

/** The same rows as the instants the domain's conflict error takes. A row without both times is skipped. */
export function toConflictingJobs(rows: readonly ConflictRow[]): ConflictingJob[] {
  return rows.flatMap((row) =>
    row.scheduledStart === null || row.scheduledEnd === null
      ? []
      : [
          {
            id: row.id,
            reference: row.reference,
            start: row.scheduledStart,
            end: row.scheduledEnd,
          },
        ],
  );
}
