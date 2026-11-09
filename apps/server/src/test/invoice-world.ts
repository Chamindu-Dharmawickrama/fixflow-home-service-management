import {
  type AdminInvoiceDto,
  calculateDocumentTotals,
  type InvoiceStatus,
  sumAmounts,
  type UpdateInvoiceBody,
  WorkOrderStatus,
} from "@fixflow/shared";
import { expect } from "vitest";

import { toDateOnly } from "../lib/date-only.js";
import type { PrismaClient } from "../lib/db.js";
import { deriveInvoiceStatus } from "../modules/invoices/invoices.domain.js";
import { signInAs } from "./auth-helpers.js";
import type { TestAppOverrides } from "./build-test-app.js";
import { dataOf, EXAMPLE_LINES, type QuotationWorld } from "./quotation-world.js";
import { insertJob, type WorkOrderWorld, workOrderWorld } from "./work-order-world.js";

/**
 * What the invoice integration tests start from: the work-order world (two customers, an admin, three
 * technicians, everyone signed in) plus helpers that make a completed job the way a test needs it and
 * drive the invoice endpoints. The test clock starts at 2 March 2026, 04:00 in New York.
 */

export const ADMIN_INVOICES = "/api/v1/admin/invoices";
export const ADMIN_JOBS = "/api/v1/admin/work-orders";

export async function invoiceWorld(prisma: PrismaClient, options: TestAppOverrides = {}) {
  return workOrderWorld(prisma, options);
}

export type InvoiceWorld = WorkOrderWorld;

/** The discount the accepted quotation of a test job carries. */
export const QUOTED_DISCOUNT = "10.00";

/**
 * Gives the accepted quotation of an inserted job the example lines, a discount and totals worked out
 * by the shared calculation, as a quotation that was really sent has. Returns those totals.
 */
export async function giveQuotationLines(
  prisma: PrismaClient,
  quotationId: string,
  options: { discountAmount?: string; taxRate?: string } = {},
) {
  const { discountAmount = QUOTED_DISCOUNT, taxRate = "8.00" } = options;
  const totals = calculateDocumentTotals({ lines: EXAMPLE_LINES, discountAmount, taxRate });
  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      taxRate,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableBase: totals.taxableBase,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
    },
  });
  await prisma.quotationLineItem.createMany({
    data: EXAMPLE_LINES.map((line, index) => ({
      quotationId,
      position: index + 1,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxable: line.taxable,
      lineSubtotal: totals.lines[index]?.lineSubtotal ?? "0.00",
    })),
  });
  return totals;
}

/** A job inserted directly in `status` whose quotation has lines, so an invoice can be made from it. */
export async function jobWithQuote(
  w: QuotationWorld,
  options: Parameters<typeof insertJob>[1] = {},
) {
  const job = await insertJob(w, options);
  const totals = await giveQuotationLines(w.prisma, job.quotationId);
  return { job, totals };
}

/** A completed job ready to be invoiced. */
export function completedJob(w: QuotationWorld, owner: "alex" | "priya" = "alex") {
  return jobWithQuote(w, { status: WorkOrderStatus.COMPLETED, owner });
}

export function createInvoiceRequest(w: QuotationWorld, jobId: string, cookie = w.adminCookie) {
  return w.client.post(`${ADMIN_JOBS}/${jobId}/invoice`, { cookie }).send({});
}

/** Starts a draft through the endpoint and returns it, failing the setup if it is refused. */
export async function startInvoice(w: QuotationWorld, jobId: string): Promise<AdminInvoiceDto> {
  const response = await createInvoiceRequest(w, jobId);
  if (response.status !== 201) {
    throw new Error(
      `Creating an invoice failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<AdminInvoiceDto>(response);
}

/** A draft for a freshly completed job. */
export async function draftInvoice(w: QuotationWorld, owner: "alex" | "priya" = "alex") {
  const { job, totals } = await completedJob(w, owner);
  const invoice = await startInvoice(w, job.id);
  return { job, totals, invoice };
}

/** The body that saves `invoice` as it stands, with `overrides` on top. */
export function saveInvoiceBody(
  invoice: Pick<
    AdminInvoiceDto,
    "lines" | "discountAmount" | "taxRate" | "issueDate" | "dueDate" | "customerNote" | "updatedAt"
  >,
  overrides: Partial<UpdateInvoiceBody> = {},
): UpdateInvoiceBody {
  return {
    lines: invoice.lines.map(({ description, quantity, unitPrice, taxable }) => ({
      description,
      quantity,
      unitPrice,
      taxable,
    })),
    discountAmount: invoice.discountAmount,
    taxRate: invoice.taxRate,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? "2026-03-16",
    customerNote: invoice.customerNote,
    expectedUpdatedAt: invoice.updatedAt,
    ...overrides,
  };
}

export function patchInvoiceRequest(
  w: QuotationWorld,
  id: string,
  body: object,
  cookie = w.adminCookie,
) {
  return w.client.patch(`${ADMIN_INVOICES}/${id}`, { cookie }).send(body);
}

export async function saveInvoice(
  w: QuotationWorld,
  invoice: AdminInvoiceDto,
  overrides: Partial<UpdateInvoiceBody> = {},
): Promise<AdminInvoiceDto> {
  const response = await patchInvoiceRequest(w, invoice.id, saveInvoiceBody(invoice, overrides));
  if (response.status !== 200) {
    throw new Error(
      `Saving an invoice failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return dataOf<AdminInvoiceDto>(response);
}

export function issueRequest(w: QuotationWorld, id: string, cookie = w.adminCookie) {
  return w.client
    .post(`${ADMIN_INVOICES}/${id}/issue`, { cookie })
    .send({ expectedStatus: "DRAFT" });
}

/** Issues a draft through the endpoint and returns it, failing the setup if it is refused. */
export async function issued(w: QuotationWorld, id: string): Promise<AdminInvoiceDto> {
  const response = await issueRequest(w, id);
  if (response.status !== 200) {
    throw new Error(`Issuing failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  await w.deps.emailDispatcher.idle();
  return dataOf<AdminInvoiceDto>(response);
}

/** A completed job with an invoice that has been issued. */
export async function issuedInvoice(w: QuotationWorld, owner: "alex" | "priya" = "alex") {
  const made = await draftInvoice(w, owner);
  const invoice = await issued(w, made.invoice.id);
  return { ...made, invoice };
}

export function voidInvoiceRequest(
  w: QuotationWorld,
  id: string,
  body: object,
  cookie = w.adminCookie,
) {
  return w.client.post(`${ADMIN_INVOICES}/${id}/void`, { cookie }).send(body);
}

export function getInvoiceRequest(w: QuotationWorld, id: string, cookie = w.adminCookie) {
  return w.client.get(`${ADMIN_INVOICES}/${id}`, { cookie });
}

/** The stored columns a refusal must leave alone, as text. */
export async function invoiceSnapshot(prisma: PrismaClient, id: string): Promise<string> {
  const row = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  return JSON.stringify(row);
}

/** Everything a successful issue or void would have added, which a refusal must not. */
export async function invoiceFootprint(w: QuotationWorld) {
  await w.deps.emailDispatcher.idle();
  return {
    events: await w.prisma.activityEvent.count(),
    notifications: await w.prisma.notification.count(),
    emails: w.emails.sent.length,
    emailLogs: await w.prisma.emailDeliveryLog.count(),
    counters: await w.prisma.referenceCounter.findMany({ where: { type: "INVOICE" } }),
  };
}

/** A payment inserted directly (T21 records them through the API). */
export function insertPayment(
  prisma: PrismaClient,
  input: {
    invoiceId: string;
    recordedByUserId: string;
    amount?: string;
    voided?: boolean;
  },
) {
  return prisma.paymentRecord.create({
    data: {
      invoiceId: input.invoiceId,
      amount: input.amount ?? "50.00",
      paymentDate: new Date("2026-03-02"),
      method: "BANK_TRANSFER",
      recordedByUserId: input.recordedByUserId,
      ...(input.voided === true && {
        voidedAt: new Date("2026-03-02T12:00:00.000Z"),
        voidedByUserId: input.recordedByUserId,
        voidReason: "Recorded against the wrong invoice.",
      }),
    },
  });
}

export type { InvoiceStatus };

/** Moves the clock and signs the admin in again: a session does not outlive days of fake time. */
export async function moveClockTo(w: QuotationWorld, time: string): Promise<void> {
  w.clock.set(time);
  w.adminCookie = await signInAs(w.app, w.admin.email);
}

// ---- Payments (T21) --------------------------------------------------------------------------------

export function recordPaymentRequest(
  w: QuotationWorld,
  id: string,
  body: object,
  cookie = w.adminCookie,
) {
  return w.client.post(`${ADMIN_INVOICES}/${id}/payments`, { cookie }).send(body);
}

export function voidPaymentRequest(
  w: QuotationWorld,
  id: string,
  paymentId: string,
  body: object,
  cookie = w.adminCookie,
) {
  return w.client.post(`${ADMIN_INVOICES}/${id}/payments/${paymentId}/void`, { cookie }).send(body);
}

/** A valid payment body on the test clock's day (2 March 2026), with `overrides` on top. */
export function paymentBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: "100.00",
    paymentDate: "2026-03-02",
    method: "BANK_TRANSFER",
    ...overrides,
  };
}

/**
 * A completed job with an issued invoice whose total is exactly `total` (300.00 unless asked): a
 * single untaxed line, so the numbers in a test are the numbers on the page. Due 16 March 2026.
 */
export async function payableInvoice(
  w: QuotationWorld,
  options: { total?: string; owner?: "alex" | "priya" } = {},
) {
  const { total = "300.00", owner = "alex" } = options;
  const made = await draftInvoice(w, owner);
  const saved = await saveInvoice(w, made.invoice, {
    lines: [{ description: "Service call", quantity: "1", unitPrice: total, taxable: false }],
    discountAmount: "0.00",
    taxRate: "0.00",
    issueDate: null,
    dueDate: "2026-03-16",
  });
  expect(saved.totalAmount).toBe(total);
  const invoice = await issued(w, saved.id);
  return { ...made, invoice };
}

/** Records a payment through the endpoint and returns the invoice, failing the setup if it is refused. */
export async function paid(
  w: QuotationWorld,
  id: string,
  amount: string,
  overrides: Record<string, unknown> = {},
): Promise<AdminInvoiceDto> {
  const response = await recordPaymentRequest(w, id, paymentBody({ amount, ...overrides }));
  if (response.status !== 201) {
    throw new Error(`Recording failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  await w.deps.emailDispatcher.idle();
  return dataOf<AdminInvoiceDto>(response);
}

/**
 * The invariant to check after every scenario (D-26): the invoice's `amountPaid` is the sum of its
 * payments that have not been voided, never more than the total, and its stored status is the one
 * the derivation gives for those facts at the clock's time.
 */
export async function expectLedgerInvariant(w: QuotationWorld, invoiceId: string): Promise<void> {
  const invoice = await w.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const standing = await w.prisma.paymentRecord.findMany({
    where: { invoiceId, voidedAt: null },
  });
  const settings = await w.prisma.businessSettings.findFirstOrThrow({
    select: { timeZone: true },
  });
  const sum = sumAmounts(standing.map((payment) => payment.amount.toFixed(2)));
  expect(invoice.amountPaid.toFixed(2)).toBe(sum);
  expect(invoice.amountPaid.lte(invoice.totalAmount)).toBe(true);
  expect(invoice.status).toBe(
    deriveInvoiceStatus({
      issuedAt: invoice.issuedAt,
      voidedAt: invoice.voidedAt,
      totalAmount: invoice.totalAmount.toFixed(2),
      amountPaid: sum,
      dueDate: invoice.dueDate === null ? null : toDateOnly(invoice.dueDate),
      now: w.clock.now(),
      timeZone: settings.timeZone,
    }),
  );
}

/** Everything a payment adds that a refusal must not: rows, events, notifications and emails. */
export async function paymentFootprint(w: QuotationWorld, invoiceId: string) {
  await w.deps.emailDispatcher.idle();
  return {
    payments: JSON.stringify(
      await w.prisma.paymentRecord.findMany({ where: { invoiceId }, orderBy: { id: "asc" } }),
    ),
    invoice: await invoiceSnapshot(w.prisma, invoiceId),
    ...(await invoiceFootprint(w)),
  };
}
