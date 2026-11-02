import {
  type AdminQuotationDto,
  type AdminTimelineEventDto,
  type CustomerQuotationDto,
  type CustomerQuotationListItemDto,
  type CustomerQuotationSummaryDto,
  type QuotationBusinessDto,
  type QuotationDocumentDto,
  type QuotationLineDto,
  type QuotationLinkDto,
  type QuotationReplacementDto,
  type QuotationStatus,
  quotationStatusLabel,
  type QuotationSummaryDto,
  requestStatusLabel,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly } from "../../lib/date-only.js";
import { availableQuotationActions, effectiveQuotationStatus } from "./quotations.domain.js";

/**
 * Serializers for quotations (D-41, CLAUDE.md §7). The customer's {@link toCustomerQuotationDto} is
 * built field by field from {@link QuotationDocumentDto}, never by spreading a row, so a column added
 * to the table cannot reach a customer; a test pins its key list. The business's
 * {@link toAdminQuotationDto} adds who did what, the internal void reason, the chain and the history.
 */

/** What every serializer needs to know about "now" and the business. */
export interface QuotationViewContext {
  now: Date;
  timeZone: string;
}

/** The settings the document header and the new-draft defaults come from. */
export const QUOTATION_SETTINGS_SELECT = {
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
  defaultTaxRate: true,
  quotationValidityDays: true,
  defaultQuotationTerms: true,
} as const satisfies Prisma.BusinessSettingsSelect;

export type QuotationSettingsRow = Prisma.BusinessSettingsGetPayload<{
  select: typeof QUOTATION_SETTINGS_SELECT;
}>;

export function toQuotationBusiness(settings: QuotationSettingsRow): QuotationBusinessDto {
  return {
    name: settings.businessName,
    tagline: settings.tagline,
    logoKey: settings.logoKey,
    logoUrl: settings.logoUrl,
    email: settings.contactEmail,
    phone: settings.phone,
    address: {
      line1: settings.addressLine1,
      line2: settings.addressLine2,
      city: settings.city,
      region: settings.region,
      postalCode: settings.postalCode,
    },
  };
}

/** Everything on a quotation's page, in one query (the history and the settings are fetched beside it). */
export const QUOTATION_DETAIL_SELECT = {
  id: true,
  reference: true,
  requestId: true,
  status: true,
  currencyCode: true,
  taxRate: true,
  subtotal: true,
  discountAmount: true,
  taxableBase: true,
  taxAmount: true,
  totalAmount: true,
  validUntil: true,
  terms: true,
  customerNote: true,
  sentAt: true,
  respondedAt: true,
  declineReason: true,
  expiredAt: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  sentBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
  replaces: { select: { id: true, reference: true, status: true, validUntil: true } },
  // `sentAt`: a replacement the customer has not been sent is not theirs to know about.
  replacedBy: {
    select: { id: true, reference: true, status: true, validUntil: true, sentAt: true },
  },
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
  request: {
    select: {
      id: true,
      reference: true,
      status: true,
      serviceNameSnapshot: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostalCode: true,
      customer: {
        select: { id: true, phone: true, user: { select: { name: true, email: true } } },
      },
    },
  },
} as const satisfies Prisma.QuotationSelect;

export type QuotationDetailRow = Prisma.QuotationGetPayload<{
  select: typeof QUOTATION_DETAIL_SELECT;
}>;

/** A line of the list on a request's page. */
export const QUOTATION_SUMMARY_SELECT = {
  id: true,
  reference: true,
  status: true,
  currencyCode: true,
  totalAmount: true,
  validUntil: true,
  sentAt: true,
  createdAt: true,
  replaces: { select: { reference: true } },
} as const satisfies Prisma.QuotationSelect;

export type QuotationSummaryRow = Prisma.QuotationGetPayload<{
  select: typeof QUOTATION_SUMMARY_SELECT;
}>;

function toLines(rows: QuotationDetailRow["lineItems"]): QuotationLineDto[] {
  return rows.map((line) => ({
    id: line.id,
    position: line.position,
    description: line.description,
    quantity: line.quantity.toFixed(2),
    unitPrice: line.unitPrice.toFixed(2),
    taxable: line.taxable,
    lineTotal: line.lineSubtotal.toFixed(2),
  }));
}

function statusOf(
  row: { status: QuotationStatus; validUntil: Date },
  context: QuotationViewContext,
): QuotationStatus {
  return effectiveQuotationStatus(
    { status: row.status, validUntil: toDateOnly(row.validUntil) },
    context.now,
    context.timeZone,
  );
}

export function toQuotationSummary(
  row: QuotationSummaryRow,
  context: QuotationViewContext,
): QuotationSummaryDto {
  const status = statusOf(row, context);
  return {
    id: row.id,
    reference: row.reference,
    status,
    statusLabel: quotationStatusLabel(status),
    totalAmount: row.totalAmount.toFixed(2),
    currencyCode: row.currencyCode,
    validUntil: toDateOnly(row.validUntil),
    sentAt: row.sentAt === null ? null : row.sentAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    replacesReference: row.replaces === null ? null : row.replaces.reference,
  };
}

/** The document, field by field: the part both audiences read. Nothing internal is in it. */
function toDocument(
  row: QuotationDetailRow,
  context: QuotationViewContext,
  business: QuotationBusinessDto,
): QuotationDocumentDto {
  const status = statusOf(row, context);
  return {
    id: row.id,
    reference: row.reference,
    status,
    statusLabel: quotationStatusLabel(status),
    requestReference: row.request.reference,
    serviceName: row.request.serviceNameSnapshot,
    customerName: row.request.customer.user.name,
    // The access notes (gate codes, pets) are not even read: a quotation document has no use for them.
    address: {
      line1: row.request.addressLine1,
      line2: row.request.addressLine2,
      city: row.request.addressCity,
      region: row.request.addressRegion,
      postalCode: row.request.addressPostalCode,
    },
    business,
    currencyCode: row.currencyCode,
    taxRate: row.taxRate.toFixed(2),
    lines: toLines(row.lineItems),
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    taxableBase: row.taxableBase.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    validUntil: toDateOnly(row.validUntil),
    terms: row.terms,
    customerNote: row.customerNote,
    sentAt: row.sentAt === null ? null : row.sentAt.toISOString(),
    respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
  };
}

/**
 * What the customer sees (D-41). `preview` is true only when an admin looks at a quotation the
 * customer has not been sent.
 */
export function toCustomerQuotationDto(input: {
  row: QuotationDetailRow;
  context: QuotationViewContext;
  business: QuotationBusinessDto;
  preview: boolean;
}): CustomerQuotationDto {
  const { row, context, business, preview } = input;
  return {
    ...toDocument(row, context, business),
    requestId: row.requestId,
    replacedBy: toCustomerReplacement(row.replacedBy),
    preview,
  };
}

/** The replacement, only once the customer has been sent it. */
function toCustomerReplacement(
  replacement: { id: string; reference: string; sentAt: Date | null } | null,
): QuotationReplacementDto | null {
  return replacement === null || replacement.sentAt === null
    ? null
    : { id: replacement.id, reference: replacement.reference };
}

/**
 * What the customer's lists need of a quotation they were sent. Never a draft: the `where` that
 * reads these rows asks for `sentAt` to be set, and {@link toCustomerQuotationSummary} refuses one
 * that is not, so a draft cannot be serialized for a customer whatever a query did.
 */
export const CUSTOMER_QUOTATION_SUMMARY_SELECT = {
  id: true,
  reference: true,
  status: true,
  currencyCode: true,
  totalAmount: true,
  validUntil: true,
  sentAt: true,
  respondedAt: true,
  replacedBy: { select: { id: true, reference: true, sentAt: true } },
} as const satisfies Prisma.QuotationSelect;

export type CustomerQuotationSummaryRow = Prisma.QuotationGetPayload<{
  select: typeof CUSTOMER_QUOTATION_SUMMARY_SELECT;
}>;

export function toCustomerQuotationSummary(
  row: CustomerQuotationSummaryRow,
  context: QuotationViewContext,
): CustomerQuotationSummaryDto {
  // Fail closed, like the notes: a quotation the customer was never sent is not theirs to see.
  if (row.sentAt === null) {
    throw new Error("A draft quotation was passed to the customer serializer.");
  }
  const status = statusOf(row, context);
  return {
    id: row.id,
    reference: row.reference,
    status,
    statusLabel: quotationStatusLabel(status),
    totalAmount: row.totalAmount.toFixed(2),
    currencyCode: row.currencyCode,
    validUntil: toDateOnly(row.validUntil),
    sentAt: row.sentAt.toISOString(),
    respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
    replacedBy: toCustomerReplacement(row.replacedBy),
  };
}

/** A row of `GET /quotations/me`: the summary and the request it answers. */
export const CUSTOMER_QUOTATION_LIST_SELECT = {
  ...CUSTOMER_QUOTATION_SUMMARY_SELECT,
  requestId: true,
  request: { select: { reference: true, serviceNameSnapshot: true } },
} as const satisfies Prisma.QuotationSelect;

export type CustomerQuotationListRow = Prisma.QuotationGetPayload<{
  select: typeof CUSTOMER_QUOTATION_LIST_SELECT;
}>;

export function toCustomerQuotationListItem(
  row: CustomerQuotationListRow,
  context: QuotationViewContext,
): CustomerQuotationListItemDto {
  return {
    ...toCustomerQuotationSummary(row, context),
    requestId: row.requestId,
    requestReference: row.request.reference,
    serviceName: row.request.serviceNameSnapshot,
  };
}

function toLink(
  neighbour: { id: string; reference: string; status: QuotationStatus; validUntil: Date },
  context: QuotationViewContext,
): QuotationLinkDto {
  const status = statusOf(neighbour, context);
  return {
    id: neighbour.id,
    reference: neighbour.reference,
    status,
    statusLabel: quotationStatusLabel(status),
  };
}

/** The quotation for the business: the document plus who did what, the chain, the history and the next actions (D-43). */
export function toAdminQuotationDto(input: {
  row: QuotationDetailRow;
  context: QuotationViewContext;
  business: QuotationBusinessDto;
  timeline: AdminTimelineEventDto[];
  /** The request has a draft quotation of its own, so a sent one cannot be replaced yet. */
  requestHasDraft: boolean;
}): AdminQuotationDto {
  const { row, context, business, timeline, requestHasDraft } = input;
  const document = toDocument(row, context, business);
  const customer = row.request.customer;
  return {
    ...document,
    requestId: row.requestId,
    requestStatus: row.request.status,
    requestStatusLabel: requestStatusLabel(row.request.status),
    customer: {
      id: customer.id,
      name: customer.user.name,
      email: customer.user.email,
      phone: customer.phone,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: { name: row.createdBy.name },
    sentBy: row.sentBy === null ? null : { name: row.sentBy.name },
    declineReason: row.declineReason,
    expiredAt: row.expiredAt === null ? null : row.expiredAt.toISOString(),
    voided:
      row.voidedAt === null
        ? null
        : {
            at: row.voidedAt.toISOString(),
            by: row.voidedBy === null ? null : { name: row.voidedBy.name },
            reason: row.voidReason ?? "",
          },
    replaces: row.replaces === null ? null : toLink(row.replaces, context),
    replacedBy: row.replacedBy === null ? null : toLink(row.replacedBy, context),
    timeline,
    availableActions: availableQuotationActions(document.status, { requestHasDraft }),
  };
}
