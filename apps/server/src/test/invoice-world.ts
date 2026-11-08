import {
  type AdminInvoiceDto,
  calculateDocumentTotals,
  type InvoiceStatus,
  type UpdateInvoiceBody,
  WorkOrderStatus,
} from "@fixflow/shared";

import type { PrismaClient } from "../lib/db.js";
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
