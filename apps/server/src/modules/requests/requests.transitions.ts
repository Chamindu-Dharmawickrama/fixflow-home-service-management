import { type RequestAction, ServiceRequestStatus } from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import {
  assertAdminAction,
  assertRequestTransition,
  RequestTrigger,
  staleRequestError,
} from "./requests.domain.js";

/**
 * The only code that writes a request's `status` (CLAUDE.md §7). Every change, by an admin or by
 * the system, goes through {@link transitionRequest}: it checks the change against the D-21 table
 * and makes it with a conditional update, so two people acting at once cannot both succeed.
 */

export interface TransitionInput {
  requestId: string;
  to: ServiceRequestStatus;
  trigger: RequestTrigger;
  /**
   * The status the caller saw (D-46). A different current status is `409 STALE_STATE`, before the
   * change is judged: the caller's view is out of date, and refreshing may show that the action is
   * no longer on offer at all.
   */
  expectedStatus?: ServiceRequestStatus;
  /** For an admin: the action being taken, checked against the current status as well as the target. */
  action?: RequestAction;
  /** Other columns that change with the status, in the same statement (for example the cancellation). */
  data?: Prisma.ServiceRequestUncheckedUpdateManyInput;
}

/**
 * Moves a request to a new status inside the caller's transaction and returns the status it left.
 *
 * - `404` when the request does not exist;
 * - `409 STALE_STATE` when `expectedStatus` is not the current status, or when the status changed
 *   between reading it and writing it (the update is conditional on the status that was read);
 * - `409 INVALID_STATE_TRANSITION` when D-21 does not allow the change for this trigger, leaving the
 *   record untouched.
 */
export async function transitionRequest(
  tx: DbClient,
  input: TransitionInput,
): Promise<{ from: ServiceRequestStatus }> {
  const { requestId, to, trigger, expectedStatus, action, data } = input;

  const current = await tx.serviceRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (current === null) {
    throw notFound();
  }
  if (expectedStatus !== undefined && current.status !== expectedStatus) {
    throw staleRequestError(current.status);
  }
  if (action !== undefined) {
    assertAdminAction(current.status, action);
  }
  assertRequestTransition(current.status, to, trigger);

  const { count } = await tx.serviceRequest.updateMany({
    where: { id: requestId, status: current.status },
    // The status comes last, so `data` can never overwrite it.
    data: { ...data, status: to },
  });
  if (count === 0) {
    // Someone else moved it between the read and the write.
    const now = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    throw now === null ? notFound() : staleRequestError(now.status);
  }
  return { from: current.status };
}

// ---- System transitions (D-21): called by later tasks, never by an endpoint of this one -----------

/**
 * A system transition: no admin, no `expectedStatus`. The table decides, so from any status other
 * than the one D-21 names for it, the call is `409 INVALID_STATE_TRANSITION` and nothing changes.
 * The caller records its own history and notifications (it knows the quotation or the job).
 */
function systemTransition(to: ServiceRequestStatus) {
  return (tx: DbClient, requestId: string) =>
    transitionRequest(tx, { requestId, to, trigger: RequestTrigger.SYSTEM });
}

/** A quotation was sent: `UNDER_REVIEW` → `QUOTED`. Called by the quotation-sending workflow (T14). */
export const markQuoted = systemTransition(ServiceRequestStatus.QUOTED);

/** The customer accepted the quotation: `QUOTED` → `ACCEPTED` (T15). */
export const markAccepted = systemTransition(ServiceRequestStatus.ACCEPTED);

/** The customer declined the quotation: `QUOTED` → `DECLINED` (T15). */
export const markDeclined = systemTransition(ServiceRequestStatus.DECLINED);

/** The only sent quotation was voided or expired with no replacement: `QUOTED` → `UNDER_REVIEW` (T14, T15). */
export const revertToUnderReview = systemTransition(ServiceRequestStatus.UNDER_REVIEW);

/** A work order was created from the accepted request: `ACCEPTED` → `CONVERTED_TO_JOB` (T17). */
export const markConvertedToJob = systemTransition(ServiceRequestStatus.CONVERTED_TO_JOB);

// ---- Hook for T14 ---------------------------------------------------------------------------------

export interface CancellationContext {
  requestId: string;
  /** The admin who cancelled, for the voided quotation's own history. */
  actorUserId: string;
  /** The internal reason, to be recorded on each voided quotation (BR-16). */
  reason: string;
}

/**
 * **T14 hook.** D-21 says that cancelling a request voids any open (`DRAFT` or `SENT`) quotation in
 * the same transaction, with the reason, the actor and an activity event on each. Quotations cannot
 * be created until T14, so there is nothing to void yet and this does nothing; `changeRequestStatus`
 * already calls it inside the cancellation's transaction, so T14 only has to fill in this body and
 * add its tests. It is recorded in `docs/IMPLEMENTATION_PROGRESS.md` as a T14 follow-up.
 */
export async function voidOpenQuotationsOnCancel(
  _tx: DbClient,
  _context: CancellationContext,
): Promise<void> {
  // Intentionally empty until T14 (see above).
}
