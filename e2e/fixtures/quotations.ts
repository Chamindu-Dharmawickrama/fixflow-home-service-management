import { addDaysToDateOnly, dateOnlyInTimeZone } from "@fixflow/shared";

import { nextReference } from "../../apps/server/src/lib/references.js";
import { createQuotation, createServiceRequest } from "../../apps/server/src/test/fixtures.js";
import { DEMO_ADMIN_EMAIL } from "../support/env.js";
import { withDatabase } from "./accounts.js";
import { seededServiceId } from "./requests.js";

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

// ---- The customer's side (T15) ---------------------------------------------------------------------

export interface InsertedQuotation {
  request: { id: string; reference: string };
  quotation: { id: string; reference: string };
}

/** The worked example of D-19: subtotal 252.00, taxable 45.50, tax 3.64, total 255.64. */
export const EXAMPLE_TOTAL = "255.64";

/**
 * A quotation the business sent to a customer, inserted straight into the E2E database with the
 * references the API itself would issue. It starts as the customer would first see it: `SENT`, with
 * the request `QUOTED`, three lines and the worked example's totals. `validUntil` is a business-calendar
 * day (use {@link businessDay}); pass a past day to get a quotation that has run out before anyone
 * answered, which the product expires the next time it is read.
 *
 * To put a second quotation on the same request (a replacement), pass its `request` and, if it
 * replaces one, `replacesQuotationId`; give the old one `status: "VOID"` first.
 */
export async function createSentQuotationFor(
  customerUserId: string,
  options: {
    validUntil?: string;
    serviceName?: string;
    status?: "SENT" | "VOID";
    request?: { id: string; reference: string };
    replacesQuotationId?: string;
    sentAt?: Date;
    customerNote?: string;
  } = {},
): Promise<InsertedQuotation> {
  const {
    validUntil = businessDay(14),
    serviceName = "AC Routine Maintenance",
    status = "SENT",
    customerNote,
  } = options;
  const serviceId = await seededServiceId(serviceName);

  return withDatabase(async (prisma) => {
    const profile = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerUserId },
      select: { id: true },
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ADMIN_EMAIL },
      select: { id: true },
    });
    const now = new Date();
    const reference = (type: "REQUEST" | "QUOTATION") =>
      prisma.$transaction((tx) => nextReference(tx, type, now, BUSINESS_TIME_ZONE));

    const request =
      options.request ??
      (await (async () => {
        const created = await createServiceRequest(prisma, {
          customerId: profile.id,
          serviceId,
          serviceNameSnapshot: serviceName,
          reference: await reference("REQUEST"),
          status: "QUOTED",
          submittedAt: new Date(now.getTime() - 3 * 86_400_000),
        });
        return { id: created.id, reference: created.reference };
      })());

    const sentAt = options.sentAt ?? new Date(now.getTime() - 60_000);
    const quotation = await createQuotation(prisma, {
      requestId: request.id,
      customerId: profile.id,
      createdByUserId: admin.id,
      reference: await reference("QUOTATION"),
      status,
      currencyCode: "USD",
      taxRate: "8.00",
      subtotal: "252.00",
      discountAmount: "0.00",
      taxableBase: "45.50",
      taxAmount: "3.64",
      totalAmount: EXAMPLE_TOTAL,
      validUntil: new Date(`${validUntil}T00:00:00.000Z`),
      terms: "Prices are valid until the date shown. Workmanship is guaranteed for 30 days.",
      customerNote: customerNote ?? null,
      sentAt,
      sentByUserId: admin.id,
      ...(options.replacesQuotationId !== undefined && {
        replacesQuotationId: options.replacesQuotationId,
      }),
      ...(status === "VOID" && {
        voidedAt: new Date(now.getTime() - 30_000),
        voidedByUserId: admin.id,
        voidReason: "Replaced by a newer quotation.",
      }),
    });
    await prisma.quotationLineItem.createMany({
      data: [
        {
          description: "Diagnostic visit",
          quantity: "1.00",
          unitPrice: "79.00",
          taxable: false,
          lineSubtotal: "79.00",
        },
        {
          description: "Run capacitor",
          quantity: "1.00",
          unitPrice: "45.50",
          taxable: true,
          lineSubtotal: "45.50",
        },
        {
          description: "Labour",
          quantity: "1.50",
          unitPrice: "85.00",
          taxable: false,
          lineSubtotal: "127.50",
        },
      ].map((line, index) => ({ ...line, quotationId: quotation.id, position: index + 1 })),
    });
    return { request, quotation: { id: quotation.id, reference: quotation.reference } };
  });
}

/** A quotation as the answer left it: who answered, when, and why (for a decline). */
export async function quotationDecisionOf(quotationId: string) {
  return withDatabase((prisma) =>
    prisma.quotation.findUniqueOrThrow({
      where: { id: quotationId },
      select: {
        status: true,
        respondedAt: true,
        respondedByUserId: true,
        declineReason: true,
        expiredAt: true,
      },
    }),
  );
}

/** The decision events and admin notifications for a quotation, for what the answer left behind. */
export async function decisionTrailOf(quotationId: string) {
  return withDatabase(async (prisma) => ({
    events: await prisma.activityEvent.findMany({
      where: {
        entityId: quotationId,
        action: { in: ["quotation.accepted", "quotation.declined"] },
      },
      select: { action: true, summary: true, publicSummary: true, actorUserId: true },
    }),
    notifications: await prisma.notification.findMany({
      where: {
        entityId: quotationId,
        type: { in: ["QUOTATION_ACCEPTED", "QUOTATION_DECLINED"] },
      },
      select: { type: true, title: true, linkPath: true, recipientUserId: true },
    }),
  }));
}
