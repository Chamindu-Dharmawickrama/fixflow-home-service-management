import { addDaysToDateOnly, dateOnlyInTimeZone } from "@fixflow/shared";

import { withDatabase } from "./accounts.js";

/**
 * Quotation scenarios for the E2E suite (T14): rows read back from, and a few inserted into, the E2E
 * database, as the rest of the fixtures are (CLAUDE.md §11). There is no test-only endpoint in the
 * product; the quotation screens are driven through the real pages and checked here against what
 * was actually stored.
 */

export const BUSINESS_TIME_ZONE = "America/New_York";

/** A quotation as stored, newest first, with the columns the specs assert on. */
export interface StoredQuotation {
  id: string;
  reference: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  totalAmount: string;
  taxRate: string;
  validUntil: string;
  terms: string | null;
  customerNote: string | null;
  replacesQuotationId: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  sentAt: Date | null;
  lineCount: number;
}

/** All quotations of a request, newest first. */
export async function quotationsOf(requestId: string): Promise<StoredQuotation[]> {
  return withDatabase(async (prisma) => {
    const rows = await prisma.quotation.findMany({
      where: { requestId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { _count: { select: { lineItems: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      subtotal: row.subtotal.toFixed(2),
      discountAmount: row.discountAmount.toFixed(2),
      taxableBase: row.taxableBase.toFixed(2),
      taxAmount: row.taxAmount.toFixed(2),
      totalAmount: row.totalAmount.toFixed(2),
      taxRate: row.taxRate.toFixed(2),
      validUntil: row.validUntil.toISOString().slice(0, 10),
      terms: row.terms,
      customerNote: row.customerNote,
      replacesQuotationId: row.replacesQuotationId,
      voidReason: row.voidReason,
      voidedAt: row.voidedAt,
      sentAt: row.sentAt,
      lineCount: row._count.lineItems,
    }));
  });
}

/** The lines of a quotation as stored, in order. */
export async function quotationLinesOf(quotationId: string) {
  return withDatabase(async (prisma) => {
    const rows = await prisma.quotationLineItem.findMany({
      where: { quotationId },
      orderBy: { position: "asc" },
    });
    return rows.map((row) => ({
      description: row.description,
      quantity: row.quantity.toFixed(2),
      unitPrice: row.unitPrice.toFixed(2),
      taxable: row.taxable,
      lineSubtotal: row.lineSubtotal.toFixed(2),
    }));
  });
}

/** Moves a quotation's last valid day, as the passing of time would, without waiting for it. */
export async function setValidUntil(quotationId: string, date: string): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { validUntil: new Date(`${date}T00:00:00.000Z`) },
    });
  });
}

/** A date in the business time zone, `days` from today (negative for the past). */
export function businessDay(days: number): string {
  return addDaysToDateOnly(dateOnlyInTimeZone(new Date(), BUSINESS_TIME_ZONE), days);
}

/** The business's settings that a new draft is filled in from. */
export async function quotationDefaults(): Promise<{
  taxRate: string;
  validityDays: number;
  terms: string | null;
  currencyCode: string;
}> {
  return withDatabase(async (prisma) => {
    const settings = await prisma.businessSettings.findFirstOrThrow();
    return {
      taxRate: settings.defaultTaxRate.toFixed(2),
      validityDays: settings.quotationValidityDays,
      terms: settings.defaultQuotationTerms,
      currencyCode: settings.currencyCode,
    };
  });
}

/** In-app notifications of one type for a user, newest first. */
export async function notificationsFor(userId: string, type: string) {
  return withDatabase((prisma) =>
    prisma.notification.findMany({
      where: { recipientUserId: userId, type: type as never },
      orderBy: { createdAt: "desc" },
      select: { title: true, message: true, linkPath: true },
    }),
  );
}

/** The quotation events recorded for a request. */
export async function quotationEventsOf(requestId: string) {
  return withDatabase((prisma) =>
    prisma.activityEvent.findMany({
      where: { requestId, entityType: "QUOTATION" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, summary: true, publicSummary: true, toStatus: true },
    }),
  );
}
