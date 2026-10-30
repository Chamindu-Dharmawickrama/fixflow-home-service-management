import { randomBytes } from "node:crypto";

import type { InvoiceStatus, WorkOrderStatus } from "@fixflow/shared";

import { nextReference } from "../../apps/server/src/lib/references.js";
import {
  createInvoice,
  createQuotation,
  createServiceRequest,
  createUser,
  createWorkOrder,
} from "../../apps/server/src/test/fixtures.js";
import { DEMO_ADMIN_EMAIL } from "../support/env.js";
import { withDatabase } from "./accounts.js";
import { seededServiceId } from "./requests.js";

/**
 * Customer-management scenarios for the E2E suite (T13): quotations, jobs and invoices for a
 * customer, inserted straight into the E2E database with the references the API itself would issue,
 * and read back from it (CLAUDE.md §11). There is no test-only endpoint in the product. Customers
 * are created per test; the shared demo customers are only read.
 */

const BUSINESS_TIME_ZONE = "America/New_York";

type Db = Parameters<Parameters<typeof withDatabase>[0]>[0];

async function customerIdOf(prisma: Db, userId: string): Promise<string> {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { userId },
    select: { id: true },
  });
  return profile.id;
}

/** The profile id the customer pages are keyed by. */
export async function profileIdOf(userId: string): Promise<string> {
  return withDatabase((prisma) => customerIdOf(prisma, userId));
}

/** A tag that is unique per call, so a search finds exactly the customers one test made. */
export function newTag(): string {
  return randomBytes(3).toString("hex");
}

/** Gives a customer a phone number (the account fixture gives every customer the same one). */
export async function setPhone(userId: string, phone: string | null): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.customerProfile.update({ where: { userId }, data: { phone } });
  });
}

/** A phone number that is the customer's alone: `(646) 555-NNNN`, with the digits `646555NNNN`. */
export function newPhone(): { text: string; digits: string } {
  const last = String(Math.floor(Math.random() * 9000) + 1000);
  return { text: `(646) 555-${last}`, digits: `646555${last}` };
}

/**
 * Many customers in one go, for the list's paging and sorting. They have no password (nobody signs
 * in as them), a name that carries the tag, and a unique email. Names are `<Prefix> <tag> NN`.
 */
export async function createCustomersTagged(
  tag: string,
  count: number,
  options: { namePrefix?: string } = {},
): Promise<{ userId: string; name: string }[]> {
  const { namePrefix = "Tagged" } = options;
  return withDatabase(async (prisma) => {
    const created: { userId: string; name: string }[] = [];
    for (let index = 0; index < count; index += 1) {
      const name = `${namePrefix} ${tag} ${String(index + 1).padStart(2, "0")}`;
      const user = await createUser(prisma, {
        role: "CUSTOMER",
        name,
        email: `tagged.${tag}.${index + 1}@example.test`,
      });
      await prisma.customerProfile.create({ data: { userId: user.id, phone: null } });
      created.push({ userId: user.id, name });
    }
    return created;
  });
}

export interface InsertedJob {
  requestId: string;
  requestReference: string;
  quotationId: string;
  quotationReference: string;
  jobId: string;
  jobReference: string;
}

/**
 * A customer's job with the request and the accepted quotation the database requires behind it.
 * References come from the counter the API uses, so they are unique and have the real format.
 */
export async function createJobFor(
  userId: string,
  options: { status?: WorkOrderStatus; serviceName?: string; scheduledStart?: Date } = {},
): Promise<InsertedJob> {
  const { status = "SCHEDULED", serviceName = "AC Routine Maintenance" } = options;
  const serviceId = await seededServiceId(serviceName);
  return withDatabase(async (prisma) => {
    const customerId = await customerIdOf(prisma, userId);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ADMIN_EMAIL },
      select: { id: true },
    });
    const now = new Date();
    const [requestReference, quotationReference, jobReference] = await Promise.all(
      (["REQUEST", "QUOTATION", "WORK_ORDER"] as const).map((type) =>
        prisma.$transaction((tx) => nextReference(tx, type, now, BUSINESS_TIME_ZONE)),
      ),
    );
    const request = await createServiceRequest(prisma, {
      customerId,
      serviceId,
      serviceNameSnapshot: serviceName,
      reference: requestReference as string,
      status: "CONVERTED_TO_JOB",
    });
    const quotation = await createQuotation(prisma, {
      requestId: request.id,
      customerId,
      createdByUserId: admin.id,
      reference: quotationReference as string,
      status: "ACCEPTED",
      sentAt: new Date(Date.now() - 3 * 86_400_000),
    });
    const scheduled = options.scheduledStart;
    const job = await createWorkOrder(prisma, {
      requestId: request.id,
      quotationId: quotation.id,
      customerId,
      serviceId,
      createdByUserId: admin.id,
      reference: jobReference as string,
      serviceNameSnapshot: serviceName,
      status,
      ...(scheduled !== undefined && {
        scheduledStart: scheduled,
        scheduledEnd: new Date(scheduled.getTime() + 2 * 3_600_000),
      }),
      ...(status === "COMPLETED" && { completedAt: new Date() }),
      ...(status === "CANCELLED" && { cancelledAt: new Date(), cancelReason: "Customer moved." }),
    });
    return {
      requestId: request.id,
      requestReference: request.reference,
      quotationId: quotation.id,
      quotationReference: quotation.reference,
      jobId: job.id,
      jobReference: job.reference,
    };
  });
}

export interface InsertedInvoice extends InsertedJob {
  invoiceId: string;
  invoiceNumber: string | null;
}

/** An invoice for a customer (on a completed job of its own), with the fields its status requires. */
export async function createInvoiceFor(
  userId: string,
  options: { status: InvoiceStatus; total?: string; paid?: string },
): Promise<InsertedInvoice> {
  const job = await createJobFor(userId, { status: "COMPLETED" });
  const { status, total = "108.00", paid = "0.00" } = options;
  return withDatabase(async (prisma) => {
    const customerId = await customerIdOf(prisma, userId);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_ADMIN_EMAIL },
      select: { id: true },
    });
    const issued = status !== "DRAFT" && status !== "VOID";
    const number = issued
      ? await prisma.$transaction((tx) =>
          nextReference(tx, "INVOICE", new Date(), BUSINESS_TIME_ZONE),
        )
      : null;
    const invoice = await createInvoice(prisma, {
      workOrderId: job.jobId,
      customerId,
      createdByUserId: admin.id,
      status,
      totalAmount: total,
      amountPaid: paid,
      ...(number !== null && {
        invoiceNumber: number,
        issuedAt: new Date(),
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 14 * 86_400_000),
      }),
      ...(status === "VOID" && { voidedAt: new Date(), voidReason: "Raised by mistake." }),
    });
    return { ...job, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber };
  });
}

/** The internal notes on a customer as stored, oldest first. */
export async function customerNotesOf(userId: string) {
  return withDatabase(async (prisma) => {
    const customerId = await customerIdOf(prisma, userId);
    return prisma.customerNote.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { body: true, author: { select: { name: true } }, authorUserId: true },
    });
  });
}

/** The activity events recorded about a customer. */
export async function activityAboutCustomer(userId: string) {
  return withDatabase(async (prisma) => {
    const customerId = await customerIdOf(prisma, userId);
    return prisma.activityEvent.findMany({
      where: { customerId, entityType: "CUSTOMER" },
      select: { action: true, summary: true, publicSummary: true },
    });
  });
}
