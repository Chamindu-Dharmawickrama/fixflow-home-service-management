import { ActivityEntityType, dateOnlyInTimeZone, InvoiceStatus } from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { notFound, serviceUnavailable } from "../../lib/errors.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import {
  assertInvoiceTransition,
  deriveInvoiceStatus,
  type InvoiceTrigger,
  InvoiceTrigger as Trigger,
  overdueTexts,
  staleInvoiceError,
} from "./invoices.domain.js";

/**
 * The only code that writes an invoice's `status` (CLAUDE.md §7): {@link transitionInvoice} for the
 * change itself, and {@link syncOverdueInvoices} for the one change time makes. Each runs inside the
 * caller's transaction.
 */

const NOT_SET_UP = "The business settings have not been set up yet.";

/**
 * Locks the invoice's row until the transaction ends, so two admins (or an admin and the overdue
 * sync) working on the same invoice take turns instead of racing. Every operation that can change an
 * invoice takes it first. Returns whether the invoice exists.
 */
export async function lockInvoice(tx: DbClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export interface InvoiceTransitionInput {
  invoiceId: string;
  to: InvoiceStatus;
  trigger: InvoiceTrigger;
  /**
   * The status the caller saw (D-46). A different current status is `409 STALE_STATE`, before the
   * change is judged: the caller's view is out of date.
   */
  expectedStatus?: InvoiceStatus;
  /** Other columns that change with the status, in the same statement (when it was issued, why voided). */
  data?: Prisma.InvoiceUncheckedUpdateManyInput;
}

/**
 * Moves an invoice to a new status inside the caller's transaction and returns the status it left.
 *
 * - `404` when the invoice does not exist;
 * - `409 STALE_STATE` when `expectedStatus` is not the current status, or when the status changed
 *   between reading it and writing it (the update is conditional on the status that was read);
 * - `409 INVALID_STATE_TRANSITION` when D-26 does not allow the change for this trigger, leaving the
 *   record untouched.
 *
 * This conditional update, behind the row lock, is what makes a double issue and an issue racing a
 * void safe: exactly one of them finds the status it expected.
 */
export async function transitionInvoice(
  tx: DbClient,
  input: InvoiceTransitionInput,
): Promise<{ from: InvoiceStatus }> {
  const { invoiceId, to, trigger, expectedStatus, data } = input;

  const current = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  if (current === null) {
    throw notFound();
  }
  if (expectedStatus !== undefined && current.status !== expectedStatus) {
    throw staleInvoiceError(current.status);
  }
  assertInvoiceTransition(current.status, to, trigger);

  const { count } = await tx.invoice.updateMany({
    where: { id: invoiceId, status: current.status },
    // The status comes last, so `data` can never overwrite it.
    data: { ...data, status: to },
  });
  if (count === 0) {
    const now = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    });
    throw now === null ? notFound() : staleInvoiceError(now.status);
  }
  return { from: current.status };
}

// ---- Payments (D-26, D-27) ---------------------------------------------------------------------

/**
 * Stores the invoice's new `amountPaid` together with the status it now has, inside the caller's
 * transaction (it also holds the invoice's row lock). `amountPaid` is only ever written here and is
 * always the sum of the payments that stand, which the caller has just worked out. When the status
 * changes the change goes through {@link transitionInvoice}, so D-26's table still decides; when a part
 * payment leaves it where it was (a second part payment, or one on an overdue invoice) only the amount
 * moves, conditional on the status that was read. Returns the status the invoice left.
 */
export async function applyPaymentToInvoice(
  tx: DbClient,
  input: { invoiceId: string; to: InvoiceStatus; amountPaid: string },
): Promise<{ from: InvoiceStatus }> {
  const { invoiceId, to, amountPaid } = input;
  const current = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true },
  });
  if (current === null) {
    throw notFound();
  }
  if (current.status !== to) {
    return transitionInvoice(tx, {
      invoiceId,
      to,
      trigger: Trigger.PAYMENT,
      data: { amountPaid },
    });
  }
  const { count } = await tx.invoice.updateMany({
    where: { id: invoiceId, status: current.status },
    data: { amountPaid },
  });
  if (count === 0) {
    const now = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
    throw now === null ? notFound() : staleInvoiceError(now.status);
  }
  return { from: current.status };
}

// ---- Overdue (D-23, D-26) -----------------------------------------------------------------------

/**
 * Saves every overdue invoice that has not been saved yet: an issued or partly paid invoice with a
 * balance whose due date is behind us on the business's calendar becomes `OVERDUE`, and the event is
 * recorded (D-23).
 *
 * It is idempotent and safe to run from any read: an invoice that was paid, voided or already saved
 * by someone else meanwhile is found in its new status and left alone, and a second run finds
 * nothing. Invoices are locked in id order, so two runs cannot wait on each other. The pure
 * `deriveInvoiceStatus` is what the screens trust in the instant before the sync has run.
 */
export async function syncOverdueInvoices(
  tx: DbClient,
  now: Date,
): Promise<{ markedOverdue: number }> {
  const settings = await tx.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true },
  });
  if (settings === null) {
    throw serviceUnavailable(NOT_SET_UP);
  }
  const { timeZone } = settings;

  const today = dateOnlyInTimeZone(now, timeZone);
  const due = await tx.invoice.findMany({
    where: {
      status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      dueDate: { lt: fromDateOnly(today) },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  let markedOverdue = 0;
  for (const { id } of due) {
    await lockInvoice(tx, id);

    // Re-read under the lock: a payment may have settled it, or an admin voided it, while we waited.
    const row = await tx.invoice.findUnique({
      where: { id },
      select: {
        invoiceNumber: true,
        status: true,
        issuedAt: true,
        voidedAt: true,
        totalAmount: true,
        amountPaid: true,
        dueDate: true,
        customerId: true,
        workOrder: { select: { requestId: true } },
      },
    });
    if (
      row === null ||
      row.invoiceNumber === null ||
      (row.status !== InvoiceStatus.ISSUED && row.status !== InvoiceStatus.PARTIALLY_PAID)
    ) {
      continue;
    }
    const derived = deriveInvoiceStatus({
      issuedAt: row.issuedAt,
      voidedAt: row.voidedAt,
      totalAmount: row.totalAmount.toFixed(2),
      amountPaid: row.amountPaid.toFixed(2),
      dueDate: row.dueDate === null ? null : toDateOnly(row.dueDate),
      now,
      timeZone,
    });
    if (derived !== InvoiceStatus.OVERDUE) {
      continue;
    }

    const { from } = await transitionInvoice(tx, {
      invoiceId: id,
      to: InvoiceStatus.OVERDUE,
      trigger: Trigger.SYSTEM,
      expectedStatus: row.status,
    });
    await recordActivity(tx, {
      actorUserId: null,
      entityType: ActivityEntityType.INVOICE,
      entityId: id,
      requestId: row.workOrder.requestId,
      customerId: row.customerId,
      action: "invoice.overdue",
      fromStatus: from,
      toStatus: InvoiceStatus.OVERDUE,
      metadata: {
        invoiceReference: row.invoiceNumber,
        dueDate: row.dueDate === null ? "" : toDateOnly(row.dueDate),
      },
      ...buildActivitySummaries({
        actor: { kind: "system" },
        ...overdueTexts({ invoiceNumber: row.invoiceNumber }),
      }),
    });
    markedOverdue += 1;
  }
  return { markedOverdue };
}
