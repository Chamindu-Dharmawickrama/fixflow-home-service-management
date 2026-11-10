import {
  balanceDue,
  type CustomerInvoiceDto,
  type CustomerInvoiceListItemDto,
  type CustomerInvoicePaymentDto,
  type CustomerJobInvoiceLinkDto,
  InvoiceStatus,
  invoiceStatusLabel,
  paymentMethodLabel,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { toQuotationLines } from "../quotations/quotations.dto.js";
import { daysOverdue, deriveInvoiceStatus } from "./invoices.domain.js";
import {
  invoiceParties,
  type InvoicePartiesSource,
  type InvoiceSettingsRow,
  type InvoiceViewContext,
} from "./invoices.dto.js";
import type { InvoicePdfSnapshot } from "./pdf/invoice-pdf.types.js";

/**
 * Serializers for an invoice as its customer sees it (CLAUDE.md §7, D-41, BR-19, D-110). Each is an
 * explicit allowlist: the database is asked for these columns only (`select`), and the DTO is built
 * field by field. The internal void reason, the staff who created, issued or voided the invoice, a
 * payment's reference, notes and recorder, a voided payment, and any column added later cannot reach
 * a customer, because none is ever read. The business's view is a different serializer
 * (`invoices.dto.ts`).
 */

/** What the customer's list reads of an invoice. */
export const CUSTOMER_INVOICE_LIST_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  currencyCode: true,
  totalAmount: true,
  amountPaid: true,
  issueDate: true,
  dueDate: true,
  issuedAt: true,
  voidedAt: true,
  workOrder: { select: { reference: true, serviceNameSnapshot: true } },
} as const satisfies Prisma.InvoiceSelect;

export type CustomerInvoiceListRow = Prisma.InvoiceGetPayload<{
  select: typeof CUSTOMER_INVOICE_LIST_SELECT;
}>;

/**
 * Everything on an invoice's page and in its PDF. The payments are the ones that stand
 * (`voidedAt: null`): a voided payment is never read, so it cannot be shown (D-110). The customer
 * and service address are the invoice's own snapshot, or the live record before it was issued.
 */
export const CUSTOMER_INVOICE_DETAIL_SELECT = {
  id: true,
  invoiceNumber: true,
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
  voidedAt: true,
  customerNote: true,
  businessSnapshot: true,
  customerSnapshot: true,
  paymentInstructionsSnapshot: true,
  footerSnapshot: true,
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
    where: { voidedAt: null },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amount: true, paymentDate: true, method: true },
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

export type CustomerInvoiceDetailRow = Prisma.InvoiceGetPayload<{
  select: typeof CUSTOMER_INVOICE_DETAIL_SELECT;
}>;

function statusOf(
  row: Pick<CustomerInvoiceListRow, "issuedAt" | "voidedAt" | "totalAmount" | "amountPaid"> & {
    dueDate: Date | null;
  },
  context: InvoiceViewContext,
): InvoiceStatus {
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

/** The fields the list and the detail share. */
function toListFields(
  row: CustomerInvoiceListRow | CustomerInvoiceDetailRow,
  serviceName: string,
  jobReference: string,
  context: InvoiceViewContext,
): CustomerInvoiceListItemDto {
  const status = statusOf(row, context);
  const dueDate = row.dueDate === null ? null : toDateOnly(row.dueDate);
  return {
    id: row.id,
    // A customer is only shown an invoice that was issued, and issuing sets all three of these. A
    // row without them (it cannot happen) would never have passed the service's ownership check.
    invoiceNumber: row.invoiceNumber ?? "",
    status,
    statusLabel: invoiceStatusLabel(status),
    issueDate: row.issueDate === null ? "" : toDateOnly(row.issueDate),
    dueDate: dueDate ?? "",
    currencyCode: row.currencyCode,
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    balanceDue: balanceDue(row.totalAmount.toFixed(2), row.amountPaid.toFixed(2)),
    daysOverdue: daysOverdue({ status, dueDate, now: context.now, timeZone: context.timeZone }),
    serviceName,
    jobReference,
  };
}

export function toCustomerInvoiceListItem(
  row: CustomerInvoiceListRow,
  context: InvoiceViewContext,
): CustomerInvoiceListItemDto {
  return toListFields(row, row.workOrder.serviceNameSnapshot, row.workOrder.reference, context);
}

/** The payments that stand, as the customer reads them: when, how and how much. */
export function toCustomerPayments(
  rows: CustomerInvoiceDetailRow["payments"],
): CustomerInvoicePaymentDto[] {
  return rows.map((payment) => ({
    id: payment.id,
    paymentDate: toDateOnly(payment.paymentDate),
    method: payment.method,
    methodLabel: paymentMethodLabel(payment.method),
    amount: payment.amount.toFixed(2),
  }));
}

/**
 * The invoice in the customer's shape, for a caller that has already decided the viewer may see it
 * (an issued invoice, of its owner or of an admin who is previewing). `paidOn` is the day of the last
 * payment that stands, and only for an invoice that is paid in full.
 */
export function toCustomerInvoiceDto(input: {
  row: CustomerInvoiceDetailRow;
  context: InvoiceViewContext;
  settings: InvoiceSettingsRow;
}): CustomerInvoiceDto {
  const { row, context, settings } = input;
  const base = toListFields(
    row,
    row.workOrder.serviceNameSnapshot,
    row.workOrder.reference,
    context,
  );
  const { business, customer, paymentInstructions, footer } = invoiceParties(
    row satisfies InvoicePartiesSource,
    settings,
  );
  const payments = toCustomerPayments(row.payments);
  return {
    ...base,
    taxRate: row.taxRate.toFixed(2),
    lines: toQuotationLines(row.lineItems),
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    taxableBase: row.taxableBase.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    customerNote: row.customerNote,
    business,
    customer,
    paymentInstructions,
    footer,
    job: { id: row.workOrder.id, reference: row.workOrder.reference },
    request: { id: row.workOrder.request.id, reference: row.workOrder.request.reference },
    payments,
    paidOn: base.status === InvoiceStatus.PAID ? (payments.at(-1)?.paymentDate ?? null) : null,
    voidedAt: row.voidedAt === null ? null : row.voidedAt.toISOString(),
    timeZone: context.timeZone,
  };
}

// ---- The job's link ------------------------------------------------------------------------------

/** What a job reads of the invoice its customer may see. */
export const CUSTOMER_JOB_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  issuedAt: true,
  voidedAt: true,
  totalAmount: true,
  amountPaid: true,
  dueDate: true,
} as const satisfies Prisma.InvoiceSelect;

export type CustomerJobInvoiceRow = Prisma.InvoiceGetPayload<{
  select: typeof CUSTOMER_JOB_INVOICE_SELECT;
}>;

/** The link on the customer's job: the issued invoice that is not void, with what it is now. */
export function toCustomerJobInvoiceLink(
  row: CustomerJobInvoiceRow,
  context: InvoiceViewContext,
): CustomerJobInvoiceLinkDto | null {
  if (row.invoiceNumber === null || row.issuedAt === null || row.voidedAt !== null) {
    return null;
  }
  const status = statusOf(row, context);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status,
    statusLabel: invoiceStatusLabel(status),
  };
}

// ---- The PDF's snapshot --------------------------------------------------------------------------

/**
 * What the invoice PDF prints (D-28). Built from the same row and the same helpers as the customer's
 * page, so the document and the screen always agree; the difference is that an admin may download a
 * draft (watermarked), which has no number and no dates yet.
 */
export function toInvoicePdfSnapshot(input: {
  row: CustomerInvoiceDetailRow;
  context: InvoiceViewContext;
  settings: InvoiceSettingsRow;
}): InvoicePdfSnapshot {
  const { row, context, settings } = input;
  const status = statusOf(row, context);
  const dueDate = row.dueDate === null ? null : toDateOnly(row.dueDate);
  const { business, customer, paymentInstructions, footer } = invoiceParties(row, settings);
  const payments = toCustomerPayments(row.payments);
  const lines = toQuotationLines(row.lineItems);
  return {
    invoiceNumber: row.invoiceNumber,
    status,
    statusLabel: invoiceStatusLabel(status),
    currencyCode: row.currencyCode,
    taxRate: row.taxRate.toFixed(2),
    lines: lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      taxable: line.taxable,
    })),
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    balanceDue: balanceDue(row.totalAmount.toFixed(2), row.amountPaid.toFixed(2)),
    issueDate: row.issueDate === null ? null : toDateOnly(row.issueDate),
    dueDate,
    daysOverdue: daysOverdue({ status, dueDate, now: context.now, timeZone: context.timeZone }),
    customerNote: row.customerNote,
    business,
    customer,
    paymentInstructions,
    footer,
    serviceName: row.workOrder.serviceNameSnapshot,
    jobReference: row.workOrder.reference,
    requestReference: row.workOrder.request.reference,
    payments: payments.map((payment) => ({
      paymentDate: payment.paymentDate,
      method: payment.method,
      methodLabel: payment.methodLabel,
      amount: payment.amount,
    })),
    paidOn: status === InvoiceStatus.PAID ? (payments.at(-1)?.paymentDate ?? null) : null,
  };
}
