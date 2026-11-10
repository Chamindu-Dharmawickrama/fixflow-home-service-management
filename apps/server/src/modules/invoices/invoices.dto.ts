import {
  type AdminInvoiceDto,
  type AdminInvoiceListItemDto,
  type AdminTimelineEventDto,
  balanceDue,
  type InvoiceCustomerDto,
  type InvoicePaymentDto,
  invoiceStatusLabel,
  type JobInvoiceLinkDto,
  paymentMethodLabel,
  type QuotationAddressDto,
  type QuotationBusinessDto,
} from "@fixflow/shared";
import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { toQuotationBusiness, toQuotationLines } from "../quotations/quotations.dto.js";
import {
  availableInvoiceActions,
  daysOverdue,
  deriveInvoiceStatus,
  type InvoiceActionContext,
} from "./invoices.domain.js";

/**
 * Serializers for invoices (D-41, CLAUDE.md §7). Every shape here is the business's: it carries the
 * internal void reason, who did what and the internal history. The customer's own views arrive with
 * T22 as their own functions, built field by field. Each is built from named fields, never by
 * spreading a row, so a column added to the table cannot reach a response by accident.
 */

/** What every serializer needs to know about "now" and the business. */
export interface InvoiceViewContext {
  now: Date;
  timeZone: string;
}

/** The settings the draft's preview, the new-draft defaults and the issue snapshot come from. */
export const INVOICE_SETTINGS_SELECT = {
  businessName: true,
  tagline: true,
  logoKey: true,
  logoUrl: true,
  contactEmail: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  timeZone: true,
  currencyCode: true,
  invoiceDueDays: true,
  invoiceFooter: true,
  paymentInstructions: true,
} as const satisfies Prisma.BusinessSettingsSelect;

export type InvoiceSettingsRow = Prisma.BusinessSettingsGetPayload<{
  select: typeof INVOICE_SETTINGS_SELECT;
}>;

// ---- The issue-time snapshots (DM-04) ------------------------------------------------------------

export const addressSnapshotSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string(),
});

export const businessSnapshotSchema = z.object({
  name: z.string(),
  tagline: z.string().nullable(),
  logoKey: z.string().nullable(),
  logoUrl: z.string().nullable(),
  email: z.string(),
  phone: z.string(),
  address: addressSnapshotSchema,
});

export const customerSnapshotSchema = z.object({
  name: z.string(),
  email: z.string(),
  address: addressSnapshotSchema,
});

/** The business details as the invoice will keep them: a plain JSON object of the document's fields. */
export function businessSnapshotOf(settings: InvoiceSettingsRow): QuotationBusinessDto {
  return toQuotationBusiness(settings);
}

/** The customer details as the invoice will keep them. Access notes are not part of an invoice. */
export function customerSnapshotOf(input: {
  name: string;
  email: string;
  address: QuotationAddressDto;
}): InvoiceCustomerDto {
  return {
    name: input.name,
    email: input.email,
    address: {
      line1: input.address.line1,
      line2: input.address.line2,
      city: input.address.city,
      region: input.address.region,
      postalCode: input.address.postalCode,
    },
  };
}

// ---- Reading one -------------------------------------------------------------------------------

/** Everything on an invoice's page, in one query (the history and the settings are fetched beside it). */
export const INVOICE_DETAIL_SELECT = {
  id: true,
  invoiceNumber: true,
  workOrderId: true,
  customerId: true,
  status: true,
  currencyCode: true,
  taxRate: true,
  subtotal: true,
  discountAmount: true,
  taxableBase: true,
  taxAmount: true,
  totalAmount: true,
  amountPaid: true,
  issueDate: true,
  dueDate: true,
  issuedAt: true,
  customerNote: true,
  businessSnapshot: true,
  customerSnapshot: true,
  paymentInstructionsSnapshot: true,
  footerSnapshot: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  issuedBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
  quotation: { select: { id: true, reference: true } },
  customer: { select: { user: { select: { name: true, email: true } } } },
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
  payments: {
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      method: true,
      reference: true,
      notes: true,
      createdAt: true,
      voidedAt: true,
      voidReason: true,
      recordedBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
    },
  },
  workOrder: {
    select: {
      id: true,
      reference: true,
      serviceNameSnapshot: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostalCode: true,
      request: { select: { id: true, reference: true } },
    },
  },
} as const satisfies Prisma.InvoiceSelect;

export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_DETAIL_SELECT }>;

function toPayments(rows: InvoiceDetailRow["payments"]): InvoicePaymentDto[] {
  return rows.map((payment) => ({
    id: payment.id,
    amount: payment.amount.toFixed(2),
    paymentDate: toDateOnly(payment.paymentDate),
    method: payment.method,
    methodLabel: paymentMethodLabel(payment.method),
    reference: payment.reference,
    notes: payment.notes,
    recordedBy: { name: payment.recordedBy.name },
    createdAt: payment.createdAt.toISOString(),
    voided:
      payment.voidedAt === null
        ? null
        : {
            at: payment.voidedAt.toISOString(),
            by: payment.voidedBy === null ? null : { name: payment.voidedBy.name },
            reason: payment.voidReason ?? "",
          },
  }));
}

function statusOf(
  row: Pick<InvoiceDetailRow, "issuedAt" | "voidedAt" | "totalAmount" | "amountPaid" | "dueDate">,
  context: InvoiceViewContext,
) {
  return deriveInvoiceStatus({
    issuedAt: row.issuedAt,
    voidedAt: row.voidedAt,
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    dueDate: row.dueDate === null ? null : toDateOnly(row.dueDate),
    now: context.now,
    timeZone: context.timeZone,
  });
}

/** What an invoice is now, for the places that show only the status (the job's link). */
export function currentStatusOf(row: Parameters<typeof statusOf>[0], context: InvoiceViewContext) {
  return statusOf(row, context);
}

/** What the parties part of an invoice reads: the issue-time snapshots and the live records behind them. */
export interface InvoicePartiesSource {
  issuedAt: Date | null;
  businessSnapshot: Prisma.JsonValue;
  customerSnapshot: Prisma.JsonValue;
  paymentInstructionsSnapshot: string | null;
  footerSnapshot: string | null;
  customer: { user: { name: string; email: string } };
  workOrder: {
    addressLine1: string;
    addressLine2: string | null;
    addressCity: string;
    addressRegion: string | null;
    addressPostalCode: string;
  };
}

/**
 * Who the invoice is from and for, and how to pay it. Once issued these are the snapshot taken at that
 * moment (DM-04); an invoice that was issued always has one, and a missing or unreadable snapshot falls
 * back to the current details rather than failing the page. Before it is issued they are the current
 * ones (a preview). Shared by the business's view, the customer's view and the PDF, so the three always
 * agree.
 */
export function invoiceParties(
  row: InvoicePartiesSource,
  settings: InvoiceSettingsRow,
): {
  isSnapshot: boolean;
  business: QuotationBusinessDto;
  customer: InvoiceCustomerDto;
  paymentInstructions: string | null;
  footer: string | null;
} {
  const businessSnapshot = businessSnapshotSchema.safeParse(row.businessSnapshot);
  const customerSnapshot = customerSnapshotSchema.safeParse(row.customerSnapshot);
  if (row.issuedAt !== null && businessSnapshot.success && customerSnapshot.success) {
    return {
      isSnapshot: true,
      business: businessSnapshot.data,
      customer: customerSnapshot.data,
      paymentInstructions: row.paymentInstructionsSnapshot,
      footer: row.footerSnapshot,
    };
  }
  return {
    isSnapshot: false,
    business: toQuotationBusiness(settings),
    customer: customerSnapshotOf({
      name: row.customer.user.name,
      email: row.customer.user.email,
      address: {
        line1: row.workOrder.addressLine1,
        line2: row.workOrder.addressLine2,
        city: row.workOrder.addressCity,
        region: row.workOrder.addressRegion,
        postalCode: row.workOrder.addressPostalCode,
      },
    }),
    paymentInstructions: settings.paymentInstructions,
    footer: settings.invoiceFooter,
  };
}

/**
 * The invoice for the business. Before it is issued the business, customer, payment instructions and
 * footer are the current ones (a preview). Once issued they are the snapshot taken at that moment
 * (DM-04); an invoice that was issued always has one, and a missing or unreadable snapshot falls back
 * to the current details rather than failing the page.
 */
export function toAdminInvoiceDto(input: {
  row: InvoiceDetailRow;
  context: InvoiceViewContext;
  settings: InvoiceSettingsRow;
  timeline: AdminTimelineEventDto[];
}): AdminInvoiceDto {
  const { row, context, settings, timeline } = input;
  const status = statusOf(row, context);
  const dueDate = row.dueDate === null ? null : toDateOnly(row.dueDate);

  const parties = invoiceParties(row, settings);

  const activePayments = row.payments.filter((payment) => payment.voidedAt === null);
  const actionContext: InvoiceActionContext = { hasActivePayments: activePayments.length > 0 };

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status,
    statusLabel: invoiceStatusLabel(status),
    currencyCode: row.currencyCode,
    taxRate: row.taxRate.toFixed(2),
    lines: toQuotationLines(row.lineItems),
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    taxableBase: row.taxableBase.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    balanceDue: balanceDue(row.totalAmount.toFixed(2), row.amountPaid.toFixed(2)),
    issueDate: row.issueDate === null ? null : toDateOnly(row.issueDate),
    dueDate,
    daysOverdue: daysOverdue({ status, dueDate, now: context.now, timeZone: context.timeZone }),
    customerNote: row.customerNote,
    ...parties,
    serviceName: row.workOrder.serviceNameSnapshot,
    customerId: row.customerId,
    job: { id: row.workOrder.id, reference: row.workOrder.reference },
    request: { id: row.workOrder.request.id, reference: row.workOrder.request.reference },
    quotation:
      row.quotation === null ? null : { id: row.quotation.id, reference: row.quotation.reference },
    payments: toPayments(row.payments),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    issuedAt: row.issuedAt === null ? null : row.issuedAt.toISOString(),
    createdBy: { name: row.createdBy.name },
    issuedBy: row.issuedBy === null ? null : { name: row.issuedBy.name },
    voided:
      row.voidedAt === null
        ? null
        : {
            at: row.voidedAt.toISOString(),
            by: row.voidedBy === null ? null : { name: row.voidedBy.name },
            reason: row.voidReason ?? "",
          },
    timeZone: context.timeZone,
    timeline,
    availableActions: availableInvoiceActions(status, actionContext),
  };
}

// ---- The list ----------------------------------------------------------------------------------

/** What the list reads of an invoice. */
export const INVOICE_LIST_SELECT = {
  id: true,
  invoiceNumber: true,
  customerId: true,
  workOrderId: true,
  currencyCode: true,
  totalAmount: true,
  amountPaid: true,
  issueDate: true,
  dueDate: true,
  issuedAt: true,
  voidedAt: true,
  createdAt: true,
  customer: { select: { user: { select: { name: true } } } },
  workOrder: { select: { reference: true } },
} as const satisfies Prisma.InvoiceSelect;

export type InvoiceListRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_LIST_SELECT }>;

export function toAdminInvoiceListItem(
  row: InvoiceListRow,
  context: InvoiceViewContext,
): AdminInvoiceListItemDto {
  const status = statusOf(row, context);
  const dueDate = row.dueDate === null ? null : toDateOnly(row.dueDate);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status,
    statusLabel: invoiceStatusLabel(status),
    customerId: row.customerId,
    customerName: row.customer.user.name,
    workOrderId: row.workOrderId,
    jobReference: row.workOrder.reference,
    issueDate: row.issueDate === null ? null : toDateOnly(row.issueDate),
    dueDate,
    currencyCode: row.currencyCode,
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    balanceDue: balanceDue(row.totalAmount.toFixed(2), row.amountPaid.toFixed(2)),
    daysOverdue: daysOverdue({ status, dueDate, now: context.now, timeZone: context.timeZone }),
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- The job's link ------------------------------------------------------------------------------

/** What a job reads of its live invoice. */
export const JOB_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  issuedAt: true,
  voidedAt: true,
  totalAmount: true,
  amountPaid: true,
  dueDate: true,
} as const satisfies Prisma.InvoiceSelect;

export type JobInvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof JOB_INVOICE_SELECT }>;

export function toJobInvoiceLink(
  row: JobInvoiceRow,
  context: InvoiceViewContext,
): JobInvoiceLinkDto {
  const status = statusOf(row, context);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status,
    statusLabel: invoiceStatusLabel(status),
  };
}
