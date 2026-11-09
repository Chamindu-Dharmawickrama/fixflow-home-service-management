import {
  balanceDue,
  calculateDocumentTotals,
  type InvoiceStatus,
  isPositiveAmount,
  sumAmounts,
} from "@fixflow/shared";

import { withDatabase } from "./accounts.js";
import { createJobFor } from "./customers.js";

/**
 * Helpers for the invoice specs (T20), in the style of the other fixtures: a spec inserts the completed
 * job it needs in the E2E database, drives the screens as a person would, and checks what was stored.
 * Nothing here is a test-only endpoint of the product.
 */

/** The three lines of the worked examples (D-19): subtotal 252.00, only the 45.50 line taxed. */
export const QUOTED_LINES = [
  { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
  { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
] as const;

/** The discount the quotation of a fixture job carries, so the invoice's pre-fill is checked for it. */
export const QUOTED_DISCOUNT = "10.00";

/**
 * A completed job whose accepted quotation has lines, a discount and totals worked out by the shared
 * calculation, as a quotation that was really sent has. The job has no invoice, so it is on the Ready
 * to invoice tab.
 */
export async function createCompletedJobWithQuote(
  customerUserId: string,
  options: { discountAmount?: string } = {},
) {
  const { discountAmount = QUOTED_DISCOUNT } = options;
  const job = await createJobFor(customerUserId, { status: "COMPLETED" });
  const totals = calculateDocumentTotals({
    lines: QUOTED_LINES,
    discountAmount,
    taxRate: "8.00",
  });
  await withDatabase(async (prisma) => {
    await prisma.quotation.update({
      where: { id: job.quotationId },
      data: {
        taxRate: "8.00",
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableBase: totals.taxableBase,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
      },
    });
    await prisma.quotationLineItem.createMany({
      data: QUOTED_LINES.map((line, index) => ({
        quotationId: job.quotationId,
        position: index + 1,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxable: line.taxable,
        lineSubtotal: totals.lines[index]?.lineSubtotal ?? "0.00",
      })),
    });
    await prisma.workOrder.update({
      where: { id: job.jobId },
      data: {
        completionNote: "Replaced the run capacitor and confirmed the unit cools to 68 degrees.",
      },
    });
  });
  return { ...job, totals };
}

/** The job's invoices as stored, oldest first, with their lines. */
export async function invoicesOfJob(jobId: string) {
  return withDatabase((prisma) =>
    prisma.invoice.findMany({
      where: { workOrderId: jobId },
      orderBy: { createdAt: "asc" },
      include: { lineItems: { orderBy: { position: "asc" } } },
    }),
  );
}

/** An invoice as stored, by id. */
export async function invoiceById(id: string) {
  return withDatabase((prisma) =>
    prisma.invoice.findUniqueOrThrow({
      where: { id },
      include: { lineItems: { orderBy: { position: "asc" } } },
    }),
  );
}

/** The events recorded for an invoice, oldest first, with both voices of the sentence. */
export async function invoiceEventsOf(invoiceId: string) {
  return withDatabase((prisma) =>
    prisma.activityEvent.findMany({
      where: { entityType: "INVOICE", entityId: invoiceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        action: true,
        summary: true,
        publicSummary: true,
        fromStatus: true,
        toStatus: true,
      },
    }),
  );
}

/** The customer's notifications about invoices, newest first. */
export async function invoiceNotificationsFor(customerUserId: string) {
  return withDatabase((prisma) =>
    prisma.notification.findMany({
      where: {
        recipientUserId: customerUserId,
        type: { in: ["INVOICE_ISSUED", "INVOICE_VOIDED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { type: true, title: true, message: true, linkPath: true },
    }),
  );
}

/**
 * An invoice inserted straight into the database in the state a screen test needs: the quotation's
 * lines, an issue date and a due date given as business-calendar days, and a number taken from the
 * real counter. Use it for the states the screens reach only with time (overdue) or that would
 * otherwise take many steps.
 */
export async function insertInvoiceFor(
  job: Awaited<ReturnType<typeof createCompletedJobWithQuote>>,
  customerUserId: string,
  options: {
    status?: InvoiceStatus;
    issueDate?: string;
    dueDate?: string;
    note?: string | null;
    voidReason?: string;
  } = {},
) {
  const { status = "ISSUED", issueDate = "2026-01-05", dueDate = "2026-01-19" } = options;
  return withDatabase(async (prisma) => {
    const profile = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerUserId },
      select: { id: true },
    });
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "BUSINESS_ADMIN" },
      select: { id: true },
    });
    const settings = await prisma.businessSettings.findFirstOrThrow();
    const workOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.jobId } });
    const number =
      status === "DRAFT"
        ? null
        : await prisma.$transaction(async (tx) => {
            const year = 2026;
            const rows = await tx.$queryRaw<{ value: number }[]>`
                INSERT INTO "reference_counters" ("type", "year", "value")
                VALUES ('INVOICE'::"reference_type", ${year}::int, 1)
                ON CONFLICT ("type", "year") DO UPDATE SET "value" = "reference_counters"."value" + 1
                RETURNING "value"`;
            return `INV-${year}-${String(rows[0]?.value ?? 0).padStart(5, "0")}`;
          });
    // A void invoice here was issued first, so it has a number and its snapshots; a draft has neither.
    const issued = status !== "DRAFT";
    const customerUser = await prisma.user.findUniqueOrThrow({ where: { id: customerUserId } });
    const snapshots = issued
      ? {
          businessSnapshot: {
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
          },
          customerSnapshot: {
            name: customerUser.name,
            email: customerUser.email,
            address: {
              line1: workOrder.addressLine1,
              line2: workOrder.addressLine2,
              city: workOrder.addressCity,
              region: workOrder.addressRegion,
              postalCode: workOrder.addressPostalCode,
            },
          },
        }
      : {};
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: number,
        workOrderId: job.jobId,
        quotationId: job.quotationId,
        customerId: profile.id,
        status,
        currencyCode: "USD",
        taxRate: "8.00",
        subtotal: job.totals.subtotal,
        discountAmount: job.totals.discountAmount,
        taxableBase: job.totals.taxableBase,
        taxAmount: job.totals.taxAmount,
        totalAmount: job.totals.totalAmount,
        issueDate: issued ? new Date(`${issueDate}T00:00:00.000Z`) : null,
        dueDate: new Date(`${dueDate}T00:00:00.000Z`),
        issuedAt: issued ? new Date(`${issueDate}T15:00:00.000Z`) : null,
        issuedByUserId: issued ? admin.id : null,
        customerNote: options.note ?? null,
        ...snapshots,
        paymentInstructionsSnapshot: issued ? settings.paymentInstructions : null,
        footerSnapshot: issued ? settings.invoiceFooter : null,
        ...(status === "VOID" && {
          voidedAt: new Date(),
          voidedByUserId: admin.id,
          voidReason: options.voidReason ?? "Raised for the wrong visit.",
        }),
        createdByUserId: admin.id,
        lineItems: {
          create: QUOTED_LINES.map((line, index) => ({
            position: index + 1,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxable: line.taxable,
            lineSubtotal: job.totals.lines[index]?.lineSubtotal ?? "0.00",
          })),
        },
      },
    });
    return { id: invoice.id, invoiceNumber: number };
  });
}

// ---- Payments (T21) --------------------------------------------------------------------------------

/** The payments recorded on an invoice as stored, oldest first (voided ones included). */
export async function paymentsOfInvoice(invoiceId: string) {
  return withDatabase((prisma) =>
    prisma.paymentRecord.findMany({
      where: { invoiceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  );
}

/**
 * A payment inserted straight into the E2E database, with the invoice's `amountPaid` and status kept
 * in step the way the server keeps them, for screens that need a history without clicking through it.
 * A `voidReason` makes it a voided payment (which then does not count towards `amountPaid`).
 */
export async function insertPaymentFor(
  invoiceId: string,
  options: {
    amount: string;
    paymentDate?: string;
    method?: "CASH" | "BANK_TRANSFER" | "CARD_TERMINAL" | "CHEQUE" | "OTHER";
    reference?: string;
    notes?: string;
    voidReason?: string;
  },
) {
  const {
    amount,
    paymentDate = "2026-11-03",
    method = "BANK_TRANSFER",
    reference,
    notes,
    voidReason,
  } = options;
  return withDatabase(async (prisma) => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "BUSINESS_ADMIN" },
      select: { id: true },
    });
    await prisma.paymentRecord.create({
      data: {
        invoiceId,
        amount,
        paymentDate: new Date(`${paymentDate}T00:00:00.000Z`),
        method,
        reference: reference ?? null,
        notes: notes ?? null,
        recordedByUserId: admin.id,
        ...(voidReason !== undefined && {
          voidedAt: new Date(),
          voidedByUserId: admin.id,
          voidReason,
        }),
      },
    });
    const standing = await prisma.paymentRecord.findMany({ where: { invoiceId, voidedAt: null } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const amountPaid = sumAmounts(standing.map((row) => row.amount.toFixed(2)));
    const settled = !isPositiveAmount(balanceDue(invoice.totalAmount.toFixed(2), amountPaid));
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid,
        status: settled ? "PAID" : isPositiveAmount(amountPaid) ? "PARTIALLY_PAID" : "ISSUED",
      },
    });
  });
}

/** The customer's notifications about payments, newest first. */
export async function paymentNotificationsFor(customerUserId: string) {
  return withDatabase((prisma) =>
    prisma.notification.findMany({
      where: { recipientUserId: customerUserId, type: "PAYMENT_RECORDED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { title: true, message: true, linkPath: true },
    }),
  );
}
