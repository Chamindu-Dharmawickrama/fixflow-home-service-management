import {
  ActivityEntityType,
  type AdminInvoiceDto,
  InvoiceStatus,
  NotificationType,
  paymentMethodLabel,
} from "@fixflow/shared";

import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import type { DbClient } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import {
  type InvoiceDeps,
  loadSettings,
  readAdminInvoice,
  syncOverdueInvoicesIfDue,
} from "./invoices.service.js";
import { applyPaymentToInvoice, lockInvoice } from "./invoices.transitions.js";
import {
  assertPayable,
  assertPaymentDateNotFuture,
  invoiceVoidedPaymentsError,
  ledgerAfterRecording,
  ledgerAfterVoiding,
  ledgerOf,
  paymentAlreadyVoidedError,
  type PaymentInvoiceFacts,
  paymentRecordedNotification,
  paymentRecordedTexts,
  paymentVoidedNotification,
  paymentVoidedTexts,
} from "./payments.domain.js";
import type { RecordPaymentInput, VoidPaymentInput } from "./payments.schemas.js";

/**
 * Manual payment records on an invoice (spec §7.6 steps 6 to 8, D-27, FR-073 to FR-076). FixFlow takes
 * no money: staff enter what the business already received. Every change runs under the invoice's row
 * lock, in one transaction, and works the balance out from the stored total and the payments that
 * stand, never from a number the client sends or from the stored `amountPaid`, so two payments at once
 * cannot overpay and `amountPaid` is always the sum of the active payments.
 */

/** The invoice as the money rules need it, read under the lock. */
async function readInvoiceFacts(tx: DbClient, id: string, now: Date) {
  const invoice = await tx.invoice.findUnique({
    where: { id },
    select: {
      invoiceNumber: true,
      status: true,
      issuedAt: true,
      voidedAt: true,
      totalAmount: true,
      dueDate: true,
      currencyCode: true,
      customerId: true,
      workOrder: { select: { requestId: true, serviceNameSnapshot: true } },
    },
  });
  if (invoice === null) {
    throw notFound();
  }
  const { timeZone } = await loadSettings(tx);
  const facts: PaymentInvoiceFacts = {
    issuedAt: invoice.issuedAt,
    voidedAt: invoice.voidedAt,
    totalAmount: invoice.totalAmount.toFixed(2),
    dueDate: invoice.dueDate === null ? null : toDateOnly(invoice.dueDate),
    now,
    timeZone,
    currencyCode: invoice.currencyCode,
  };
  return { invoice, facts };
}

/** The amounts of the payments that stand (not voided) on the invoice, as two-place decimal strings. */
async function standingAmounts(tx: DbClient, invoiceId: string): Promise<string[]> {
  const rows = await tx.paymentRecord.findMany({
    where: { invoiceId, voidedAt: null },
    select: { amount: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.amount.toFixed(2));
}

async function customerOf(tx: DbClient, customerId: string) {
  const profile = await tx.customerProfile.findUniqueOrThrow({
    where: { id: customerId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return profile.user;
}

// ---- Recording (FR-073, FR-074, FR-075) ----------------------------------------------------------

/**
 * Records a payment the business received outside FixFlow.
 *
 * - The invoice must be issued, partly paid or overdue (`409 INVOICE_NOT_PAYABLE` for a draft, a void
 *   or a paid one, with a message for each).
 * - The date may not be in the future on the business's calendar (`422` on `paymentDate`).
 * - The amount may not exceed what is still owed, worked out under the lock (`422
 *   PAYMENT_EXCEEDS_BALANCE`, naming the remaining balance). Two payments racing for the same balance
 *   take turns; the second sees the first and is refused if there is not enough left.
 *
 * Then the payment is inserted, `amountPaid` and the status are stored together (the status is
 * `PARTIALLY_PAID`, `OVERDUE` for a part payment past the due date, or `PAID` when nothing is owed),
 * the history gets its event and the customer their notification. The email is queued in the
 * transaction and sent only after the commit, worded as "recorded" (BR-22, spec §10.4).
 */
export async function recordPayment(
  deps: InvoiceDeps,
  auth: AuthContext,
  id: string,
  input: RecordPaymentInput,
): Promise<AdminInvoiceDto> {
  const { prisma, clock, config, emailDispatcher } = deps;
  await syncOverdueInvoicesIfDue(deps);
  const now = clock.now();

  const { afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    if (!(await lockInvoice(tx, id))) {
      throw notFound();
    }
    const { invoice, facts } = await readInvoiceFacts(tx, id, now);
    const standing = await standingAmounts(tx, id);

    // What the invoice is now, from the money that stands: a stale stored status cannot let a payment through.
    assertPayable(ledgerOf(facts, standing).status);
    assertPaymentDateNotFuture(input.paymentDate, now, facts.timeZone);
    const ledger = ledgerAfterRecording(facts, standing, input.amount);

    await tx.paymentRecord.create({
      data: {
        invoiceId: id,
        amount: input.amount,
        paymentDate: fromDateOnly(input.paymentDate),
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedByUserId: auth.userId,
      },
    });
    const { from } = await applyPaymentToInvoice(tx, {
      invoiceId: id,
      to: ledger.status,
      amountPaid: ledger.amountPaid,
    });

    const [customer, actor] = await Promise.all([
      customerOf(tx, invoice.customerId),
      tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true } }),
    ]);
    // A payment is only possible on an issued invoice, which always has its number.
    const invoiceNumber = invoice.invoiceNumber ?? "";
    const words = {
      amount: input.amount,
      currencyCode: invoice.currencyCode,
      paymentDate: input.paymentDate,
      method: input.method,
    };
    // The reference and notes are deliberately not metadata, not summaries and not notification text.
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.INVOICE,
      entityId: id,
      requestId: invoice.workOrder.requestId,
      customerId: invoice.customerId,
      action: "payment.recorded",
      ...(from !== ledger.status && { fromStatus: from, toStatus: ledger.status }),
      metadata: {
        invoiceReference: invoiceNumber,
        amount: input.amount,
        currencyCode: invoice.currencyCode,
        paymentMethod: input.method,
        paymentDate: input.paymentDate,
        amountPaid: ledger.amountPaid,
        balance: ledger.balance,
      },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...paymentRecordedTexts(words),
      }),
    });

    const linkPath = `/portal/invoices/${id}`;
    const notification = await notify(tx, {
      recipientUserId: customer.id,
      type: NotificationType.PAYMENT_RECORDED,
      ...paymentRecordedNotification({
        invoiceNumber,
        serviceName: invoice.workOrder.serviceNameSnapshot,
        amount: input.amount,
        currencyCode: invoice.currencyCode,
        paymentDate: input.paymentDate,
        balance: ledger.balance,
      }),
      linkPath,
      entity: { type: ActivityEntityType.INVOICE, id },
    });
    after.email(
      emailJob(
        "payment-recorded",
        customer.email,
        {
          customerName: customer.name,
          invoiceReference: invoiceNumber,
          paymentAmount: input.amount,
          currencyCode: invoice.currencyCode,
          paymentDate: input.paymentDate,
          paymentMethod: paymentMethodLabel(input.method),
          balance: ledger.balance,
          invoiceUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
        },
        { notificationId: notification.id },
      ),
    );
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return readAdminInvoice(prisma, now, id);
}

// ---- Voiding a payment (FR-076, BR-16) -----------------------------------------------------------

/**
 * Voids one recorded payment with a written reason: the correction for a payment entered wrongly (a
 * void plus, if needed, a new record; payments are never edited or deleted). The record stays, with
 * who voided it, when and why. `amountPaid` and the status are worked out again from the payments
 * that still stand, so a paid invoice falls back to partly paid, issued or overdue. The customer is
 * told in the app, because their balance has gone up; the internal reason is not an input of the
 * notice and cannot reach it.
 *
 * - A payment that is not on this invoice is `404`.
 * - A voided invoice, or a payment that is already voided, is `409`, and nothing changes.
 */
export async function voidPayment(
  deps: InvoiceDeps,
  auth: AuthContext,
  id: string,
  paymentId: string,
  input: VoidPaymentInput,
): Promise<AdminInvoiceDto> {
  const { prisma, clock } = deps;
  await syncOverdueInvoicesIfDue(deps);
  const now = clock.now();

  await prisma.$transaction(async (tx) => {
    if (!(await lockInvoice(tx, id))) {
      throw notFound();
    }
    const { invoice, facts } = await readInvoiceFacts(tx, id, now);
    // Re-read under the lock: another admin may have voided it while this request waited for its turn.
    const payment = await tx.paymentRecord.findFirst({
      where: { id: paymentId, invoiceId: id },
      select: { amount: true, paymentDate: true, method: true, voidedAt: true },
    });
    if (payment === null) {
      throw notFound();
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw invoiceVoidedPaymentsError();
    }
    if (payment.voidedAt !== null) {
      throw paymentAlreadyVoidedError();
    }

    const { count } = await tx.paymentRecord.updateMany({
      where: { id: paymentId, invoiceId: id, voidedAt: null },
      data: { voidedAt: now, voidedByUserId: auth.userId, voidReason: input.reason },
    });
    if (count === 0) {
      throw paymentAlreadyVoidedError();
    }
    const after = ledgerAfterVoiding(facts, await standingAmounts(tx, id));
    const { from } = await applyPaymentToInvoice(tx, {
      invoiceId: id,
      to: after.status,
      amountPaid: after.amountPaid,
    });

    const [customer, actor] = await Promise.all([
      customerOf(tx, invoice.customerId),
      tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true } }),
    ]);
    const invoiceNumber = invoice.invoiceNumber ?? "";
    const amount = payment.amount.toFixed(2);
    const paymentDate = toDateOnly(payment.paymentDate);
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.INVOICE,
      entityId: id,
      requestId: invoice.workOrder.requestId,
      customerId: invoice.customerId,
      action: "payment.voided",
      ...(from !== after.status && { fromStatus: from, toStatus: after.status }),
      metadata: {
        invoiceReference: invoiceNumber,
        amount,
        currencyCode: invoice.currencyCode,
        paymentMethod: payment.method,
        paymentDate,
        amountPaid: after.amountPaid,
        balance: after.balance,
      },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        ...paymentVoidedTexts({
          amount,
          currencyCode: invoice.currencyCode,
          paymentDate,
          method: payment.method,
          balance: after.balance,
        }),
      }),
    });

    // Voiding a payment always raises the balance the customer sees, so they are always told.
    await notify(tx, {
      recipientUserId: customer.id,
      type: NotificationType.PAYMENT_RECORDED,
      ...paymentVoidedNotification({
        invoiceNumber,
        serviceName: invoice.workOrder.serviceNameSnapshot,
        amount,
        currencyCode: invoice.currencyCode,
        paymentDate,
        balance: after.balance,
      }),
      linkPath: `/portal/invoices/${id}`,
      entity: { type: ActivityEntityType.INVOICE, id },
    });
  });

  return readAdminInvoice(prisma, now, id);
}
