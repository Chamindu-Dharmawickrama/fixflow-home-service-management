import {
  ActivityEntityType,
  dateOnlyInTimeZone,
  NotificationType,
  QuotationStatus,
  ServiceRequestStatus,
} from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { fromDateOnly, toDateOnly } from "../../lib/date-only.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { notFound, serviceUnavailable } from "../../lib/errors.js";
import type { AfterCommit } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import { revertToUnderReview } from "../requests/requests.transitions.js";
import {
  assertQuotationTransition,
  expiredTexts,
  expiryInstant,
  QuotationTrigger,
  requestResumedTexts,
  staleQuotationError,
  voidedTexts,
  withdrawnNotification,
} from "./quotations.domain.js";

/**
 * The only code that writes a quotation's `status` (CLAUDE.md §7): {@link transitionQuotation} for the
 * change itself, and the three workflows that end an offer without a customer's answer: voiding it,
 * letting it expire, and cancelling the request it belongs to. Each runs inside the caller's
 * transaction, writes its own activity event, and leaves the request in step with the quotations.
 */

const NOT_SET_UP = "The business settings have not been set up yet.";

/**
 * Locks the request's row until the transaction ends, so two admins (or an admin and the expiry
 * sync) working on the same request's quotations take turns instead of racing. Every operation that
 * can change which quotation is the request's draft or sent one takes it first.
 */
export async function lockRequest(tx: DbClient, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
}

export interface QuotationTransitionInput {
  quotationId: string;
  to: QuotationStatus;
  trigger: QuotationTrigger;
  /**
   * The status the caller saw (D-46). A different current status is `409 STALE_STATE`, before the
   * change is judged: the caller's view is out of date.
   */
  expectedStatus?: QuotationStatus;
  /** Other columns that change with the status, in the same statement (when it was sent, why voided). */
  data?: Prisma.QuotationUncheckedUpdateManyInput;
  /**
   * More conditions the row must meet for the update to apply, beside its id and the status that was
   * read: the customer's answer adds the owner and the last valid day. When they do not hold the
   * update writes nothing and the call is `409 STALE_STATE`.
   */
  guard?: Prisma.QuotationWhereInput;
}

/**
 * Moves a quotation to a new status inside the caller's transaction and returns the status it left.
 *
 * - `404` when the quotation does not exist;
 * - `409 STALE_STATE` when `expectedStatus` is not the current status, or when the status changed
 *   between reading it and writing it (the update is conditional on the status that was read);
 * - `409 INVALID_STATE_TRANSITION` when D-22 does not allow the change for this trigger, leaving the
 *   record untouched.
 *
 * This conditional update is what makes a double send, a send racing a void and a customer's answer
 * racing an expiry safe: exactly one of them finds the status it expected.
 */
export async function transitionQuotation(
  tx: DbClient,
  input: QuotationTransitionInput,
): Promise<{ from: QuotationStatus }> {
  const { quotationId, to, trigger, expectedStatus, data, guard } = input;

  const current = await tx.quotation.findUnique({
    where: { id: quotationId },
    select: { status: true },
  });
  if (current === null) {
    throw notFound();
  }
  if (expectedStatus !== undefined && current.status !== expectedStatus) {
    throw staleQuotationError(current.status);
  }
  assertQuotationTransition(current.status, to, trigger);

  const { count } = await tx.quotation.updateMany({
    where: { ...guard, id: quotationId, status: current.status },
    // The status comes last, so `data` can never overwrite it.
    data: { ...data, status: to },
  });
  if (count === 0) {
    const now = await tx.quotation.findUnique({
      where: { id: quotationId },
      select: { status: true },
    });
    throw now === null ? notFound() : staleQuotationError(now.status);
  }
  return { from: current.status };
}

/** The queued emails and where links should point. */
export interface QuotationWorkflowDeps {
  after: AfterCommit;
  publicWebUrl: string;
}

/**
 * After a quotation stops being the request's sent one, puts a `QUOTED` request back under review so
 * the admin can prepare another (D-21). It does nothing while another sent quotation remains or when
 * the request is not `QUOTED`. Records a staff-only event; the quotation's own event is what the
 * customer reads.
 */
async function resumeReviewIfNothingIsSent(
  tx: DbClient,
  request: { id: string; reference: string; customerId: string },
  actorUserId: string | null,
  actorName: string | null,
): Promise<void> {
  // One after the other: a transaction has a single connection, which runs one query at a time.
  const current = await tx.serviceRequest.findUnique({
    where: { id: request.id },
    select: { status: true },
  });
  if (current?.status !== ServiceRequestStatus.QUOTED) {
    return;
  }
  const stillSent = await tx.quotation.count({
    where: { requestId: request.id, status: QuotationStatus.SENT },
  });
  if (stillSent > 0) {
    return;
  }
  await revertToUnderReview(tx, request.id);
  await recordActivity(tx, {
    actorUserId,
    entityType: ActivityEntityType.SERVICE_REQUEST,
    entityId: request.id,
    requestId: request.id,
    customerId: request.customerId,
    action: "request.review_resumed",
    fromStatus: ServiceRequestStatus.QUOTED,
    toStatus: ServiceRequestStatus.UNDER_REVIEW,
    metadata: { requestReference: request.reference },
    ...buildActivitySummaries({
      actor: actorName === null ? { kind: "system" } : { kind: "staff", name: actorName },
      ...requestResumedTexts({ requestReference: request.reference }),
    }),
  });
}

export interface VoidQuotationInput {
  quotationId: string;
  /** The admin who voided it, for the record. */
  actorUserId: string;
  /** Internal: stored on the quotation and never sent to the customer. */
  reason: string;
  now: Date;
  /** The status the caller saw, when the caller is an admin acting on a screen (D-46). */
  expectedStatus?: QuotationStatus;
  /**
   * Put a `QUOTED` request back under review when this was its only sent quotation. Voiding on its
   * own does; a replacement (the new quotation is sent in the same transaction) and a cancellation
   * (the request ends) do not.
   */
  requestEffect: "resume" | "none";
  /**
   * Tell the customer, with a notification and an email, that a sent quotation was withdrawn. A
   * replacement and a cancellation have their own notice, so they pass `"none"`.
   */
  customerNotice: "withdrawn" | "none";
  /** What the withdrawn notice says instead of the standard line. Never the internal reason. */
  customerMessage?: string | undefined;
  /** For a replacement: the quotation that takes its place. */
  replacedByReference?: string | undefined;
  /** For a cancellation: the request ended, which the customer is told separately. */
  requestCancelled?: boolean | undefined;
}

/**
 * Voids a draft or a sent quotation: records who, when and why (BR-16), writes the event and, as the
 * caller asks, notifies the customer and puts the request back under review.
 *
 * A draft that was started as a replacement lets go of the quotation it was to replace
 * (`replacesQuotationId` becomes `null`): that draft never reached the customer, the sent quotation is
 * still the live offer and can be replaced again, and a quotation can be replaced only once.
 */
export async function voidQuotation(
  tx: DbClient,
  deps: QuotationWorkflowDeps,
  input: VoidQuotationInput,
): Promise<void> {
  // One relation at a time: a transaction has a single connection, and Prisma would otherwise ask
  // for several relations at once, which the driver can only queue (a warning today, an error in pg 9).
  const row = await tx.quotation.findUnique({
    where: { id: input.quotationId },
    select: {
      id: true,
      reference: true,
      requestId: true,
      customerId: true,
      status: true,
      replaces: { select: { reference: true } },
    },
  });
  if (row === null) {
    throw notFound();
  }
  const request = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: row.requestId },
    select: { id: true, reference: true, serviceNameSnapshot: true },
  });
  const { user: customer } = await tx.customerProfile.findUniqueOrThrow({
    where: { id: row.customerId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const actor = await tx.user.findUniqueOrThrow({
    where: { id: input.actorUserId },
    select: { name: true },
  });

  const wasDraft = row.status === QuotationStatus.DRAFT;
  const { from } = await transitionQuotation(tx, {
    quotationId: row.id,
    to: QuotationStatus.VOID,
    trigger: QuotationTrigger.ADMIN,
    ...(input.expectedStatus !== undefined && { expectedStatus: input.expectedStatus }),
    data: {
      voidedAt: input.now,
      voidedByUserId: input.actorUserId,
      voidReason: input.reason,
      ...(wasDraft && { replacesQuotationId: null }),
    },
  });

  const wasSent = from === QuotationStatus.SENT;
  await recordActivity(tx, {
    actorUserId: input.actorUserId,
    entityType: ActivityEntityType.QUOTATION,
    entityId: row.id,
    requestId: row.requestId,
    customerId: row.customerId,
    action: "quotation.voided",
    fromStatus: from,
    toStatus: QuotationStatus.VOID,
    metadata: {
      quotationReference: row.reference,
      requestReference: request.reference,
      // A released draft keeps a note of which quotation it was to replace.
      ...(wasDraft && row.replaces !== null && { replacesReference: row.replaces.reference }),
    },
    ...buildActivitySummaries({
      actor: { kind: "staff", name: actor.name },
      ...voidedTexts({
        reference: row.reference,
        wasSent,
        replacedByReference: input.replacedByReference ?? null,
        requestCancelled: input.requestCancelled ?? false,
      }),
    }),
  });

  if (wasSent && input.customerNotice === "withdrawn") {
    const texts = withdrawnNotification({
      reference: row.reference,
      serviceName: request.serviceNameSnapshot,
      customerMessage: input.customerMessage,
    });
    const linkPath = `/portal/requests/${row.requestId}`;
    const notification = await notify(tx, {
      recipientUserId: customer.id,
      type: NotificationType.QUOTATION_WITHDRAWN,
      ...texts,
      linkPath,
      entity: { type: ActivityEntityType.QUOTATION, id: row.id },
    });
    // `reason` is not an input of the template, so the internal reason cannot reach the email.
    deps.after.email(
      emailJob(
        "quotation-withdrawn",
        customer.email,
        {
          customerName: customer.name,
          quotationReference: row.reference,
          serviceName: request.serviceNameSnapshot,
          requestUrl: absoluteAppUrl(deps.publicWebUrl, linkPath),
          ...(input.customerMessage !== undefined &&
            input.customerMessage.trim() !== "" && { customerMessage: input.customerMessage }),
        },
        { notificationId: notification.id },
      ),
    );
  }

  if (wasSent && input.requestEffect === "resume") {
    await resumeReviewIfNothingIsSent(
      tx,
      { id: row.requestId, reference: request.reference, customerId: row.customerId },
      input.actorUserId,
      actor.name,
    );
  }
}

// ---- Expiry (D-23) ------------------------------------------------------------------------------

/**
 * Saves the expiry of every sent quotation whose last day has passed on the business's calendar:
 * the quotation becomes `EXPIRED` (at the start of the day after `validUntil`, whenever this runs),
 * the event is recorded, and a `QUOTED` request with nothing else waiting goes back under review.
 *
 * It is idempotent and safe to run from any read: a quotation that was answered, voided or expired
 * by someone else meanwhile is found in its new status and left alone, and a second run finds
 * nothing. Requests are locked in id order, so two runs cannot wait on each other. The pure
 * `effectiveQuotationStatus` is what the screens trust in the instant before the sync has run.
 */
export async function syncExpiredQuotations(tx: DbClient, now: Date): Promise<{ expired: number }> {
  const settings = await tx.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { timeZone: true },
  });
  if (settings === null) {
    throw serviceUnavailable(NOT_SET_UP);
  }
  const { timeZone } = settings;

  const today = dateOnlyInTimeZone(now, timeZone);
  const due = await tx.quotation.findMany({
    where: {
      status: QuotationStatus.SENT,
      validUntil: { lt: fromDateOnly(today) },
    },
    select: { id: true, requestId: true },
    orderBy: [{ requestId: "asc" }, { id: "asc" }],
  });

  let expired = 0;
  for (const { id, requestId } of due) {
    await lockRequest(tx, requestId);

    // Re-read under the lock: the customer may have answered, or an admin voided it, while we waited.
    const row = await tx.quotation.findUnique({
      where: { id },
      select: {
        reference: true,
        status: true,
        validUntil: true,
        customerId: true,
        request: { select: { id: true, reference: true } },
      },
    });
    if (row === null || row.status !== QuotationStatus.SENT) {
      continue;
    }
    const validUntil = toDateOnly(row.validUntil);

    await transitionQuotation(tx, {
      quotationId: id,
      to: QuotationStatus.EXPIRED,
      trigger: QuotationTrigger.SYSTEM,
      expectedStatus: QuotationStatus.SENT,
      data: { expiredAt: expiryInstant(validUntil, timeZone) },
    });
    await recordActivity(tx, {
      actorUserId: null,
      entityType: ActivityEntityType.QUOTATION,
      entityId: id,
      requestId,
      customerId: row.customerId,
      action: "quotation.expired",
      fromStatus: QuotationStatus.SENT,
      toStatus: QuotationStatus.EXPIRED,
      metadata: {
        quotationReference: row.reference,
        requestReference: row.request.reference,
        validUntil,
      },
      ...buildActivitySummaries({
        actor: { kind: "system" },
        ...expiredTexts({ reference: row.reference }),
      }),
    });
    await resumeReviewIfNothingIsSent(
      tx,
      { id: requestId, reference: row.request.reference, customerId: row.customerId },
      null,
      null,
    );
    expired += 1;
  }
  return { expired };
}

// ---- Cancelling a request (D-21, BR-16) ---------------------------------------------------------

export interface CancellationContext {
  requestId: string;
  /** The admin who cancelled the request. */
  actorUserId: string;
  /** The request's internal reason, which each voided quotation keeps. */
  reason: string;
  now: Date;
}

/**
 * Cancelling a request voids every open (`DRAFT` or `SENT`) quotation of it in the same transaction,
 * with the reason, the actor and an event on each (D-21, BR-16). The request is already `CANCELLED`
 * and holds the row lock, so nothing can be sent in between. The customer is told once, by the
 * cancellation notice, so no separate "withdrawn" notice goes out.
 */
export async function voidOpenQuotationsOnCancel(
  tx: DbClient,
  deps: QuotationWorkflowDeps,
  context: CancellationContext,
): Promise<void> {
  const open = await tx.quotation.findMany({
    where: {
      requestId: context.requestId,
      status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const { id } of open) {
    await voidQuotation(tx, deps, {
      quotationId: id,
      actorUserId: context.actorUserId,
      reason: `Request cancelled: ${context.reason}`,
      now: context.now,
      requestEffect: "none",
      customerNotice: "none",
      requestCancelled: true,
    });
  }
}
