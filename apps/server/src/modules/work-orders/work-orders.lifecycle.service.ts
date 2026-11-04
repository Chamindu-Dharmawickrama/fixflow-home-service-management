import {
  ActivityEntityType,
  type AdminWorkOrderDto,
  NotificationType,
  WorkOrderAction,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/errors.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import type { ActivityMetadata } from "../activity/activity.metadata.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { absoluteAppUrl } from "../email/email.domain.js";
import { emailJob } from "../email/email.jobs.js";
import { notify } from "../notifications/notifications.service.js";
import { loadBusiness } from "../requests/requests.service.js";
import {
  startsBeforeSchedule,
  TRANSITION_EVENT_ACTIONS,
  transitionNotification,
  transitionTexts,
  WORK_ORDER_ACTION_TARGET,
} from "./work-orders.domain.js";
import type { TransitionWorkOrderInput } from "./work-orders.schemas.js";
import { getAdminWorkOrder } from "./work-orders.service.js";
import { lockWorkOrder, transitionWorkOrder } from "./work-orders.transitions.js";

/**
 * Moving a job through its lifecycle (T18, FR-055, workflow 7.5): start it, say it needs a new time,
 * complete it with a note, or cancel it. The scheduling half (T17) lives in `work-orders.service.ts`.
 */

type LifecycleDeps = Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">;

/** The in-app notification each lifecycle action sends (D-38). Starting a job sends none. */
const NOTIFICATION_TYPES = {
  [WorkOrderAction.MARK_NEEDS_RESCHEDULING]: NotificationType.JOB_NEEDS_RESCHEDULING,
  [WorkOrderAction.COMPLETE]: NotificationType.JOB_COMPLETED,
  [WorkOrderAction.CANCEL]: NotificationType.JOB_CANCELLED,
} as const;

export interface TransitionResult {
  workOrder: AdminWorkOrderDto;
  /** The job was started before its scheduled start: allowed (D-24), but the screen says so. */
  startedBeforeSchedule: boolean;
}

/**
 * Applies one of the four lifecycle actions (`POST /admin/work-orders/:id/transitions`). One
 * transaction holds the conditional status update, the history and, where the customer is told, the
 * notification; the email is queued in it and sent only after the commit (BR-22), so a failed email
 * never undoes the change.
 *
 * - The job's row is locked first, so two admins acting on one job take turns and what is recorded
 *   about the appointment it had is the appointment it really had.
 * - The change is judged against D-24 and `expectedStatus`: a status the caller was not looking at
 *   is `409 STALE_STATE`, an action the status does not allow is `409 INVALID_STATE_TRANSITION`;
 *   either leaves the job exactly as it was.
 * - **What the customer reads is chosen field by field.** The reasons and the internal note are
 *   written to the job and to the staff-only history line and nowhere a customer can read. The
 *   notification and the email are built from the job's reference, its service, the customer's
 *   name and, for a cancellation or a new time, the optional message the admin wrote for them.
 * - A job that needs a new time **keeps** its old appointment and technician as a reference (the
 *   history records them too): it holds no technician's time any more, because only `SCHEDULED` and
 *   `IN_PROGRESS` jobs do (D-25). It forgets that it had started.
 */
export async function transitionWorkOrderStatus(
  deps: LifecycleDeps,
  auth: AuthContext,
  id: string,
  input: TransitionWorkOrderInput,
): Promise<TransitionResult> {
  const { prisma, clock, config, emailDispatcher } = deps;
  const { action } = input;

  const { result, afterCommit } = await runInTransaction(prisma, async (tx, after) => {
    if (!(await lockWorkOrder(tx, id))) {
      throw notFound();
    }
    const job = await tx.workOrder.findUniqueOrThrow({
      where: { id },
      select: {
        reference: true,
        requestId: true,
        customerId: true,
        serviceNameSnapshot: true,
        scheduledStart: true,
        scheduledEnd: true,
        technicianId: true,
        customer: { select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    const now = clock.now();
    const business = await loadBusiness(tx);
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { name: true },
    });

    const early = action === WorkOrderAction.START && startsBeforeSchedule(job.scheduledStart, now);
    const previous =
      job.scheduledStart !== null && job.scheduledEnd !== null
        ? { start: job.scheduledStart, end: job.scheduledEnd }
        : null;

    // The columns that change with the status, in the same statement. A reason or note a schema rule
    // requires is present for the action that needs it; `?? null` only satisfies the types.
    const data: Prisma.WorkOrderUncheckedUpdateManyInput = (() => {
      switch (action) {
        case WorkOrderAction.START:
          return { startedAt: now };
        case WorkOrderAction.MARK_NEEDS_RESCHEDULING:
          return { startedAt: null };
        case WorkOrderAction.COMPLETE:
          return {
            completedAt: now,
            completionNote: input.completionNote ?? null,
            internalCompletionNote: input.internalNote ?? null,
          };
        case WorkOrderAction.CANCEL:
          return { cancelledAt: now, cancelReason: input.reason ?? null };
      }
    })();

    const { from } = await transitionWorkOrder(tx, {
      workOrderId: id,
      action,
      expectedStatus: input.expectedStatus,
      data,
    });

    const metadata: ActivityMetadata = {
      workOrderReference: job.reference,
      ...(previous !== null &&
        (action === WorkOrderAction.MARK_NEEDS_RESCHEDULING ||
          action === WorkOrderAction.CANCEL) && {
          previousScheduledStart: previous.start.toISOString(),
          previousScheduledEnd: previous.end.toISOString(),
        }),
      ...(previous !== null &&
        action === WorkOrderAction.START && {
          scheduledStart: previous.start.toISOString(),
          scheduledEnd: previous.end.toISOString(),
        }),
      ...(job.technicianId !== null &&
        action === WorkOrderAction.MARK_NEEDS_RESCHEDULING && { technicianId: job.technicianId }),
    };
    const customerMessage = input.customerMessage ?? undefined;
    const texts = transitionTexts({
      action,
      reference: job.reference,
      timeZone: business.timeZone,
      early,
      previous,
      reason: input.reason ?? null,
      messageSent: customerMessage !== undefined,
    });
    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.WORK_ORDER,
      entityId: id,
      requestId: job.requestId,
      customerId: job.customerId,
      action: TRANSITION_EVENT_ACTIONS[action],
      fromStatus: from,
      toStatus: WORK_ORDER_ACTION_TARGET[action],
      metadata,
      ...buildActivitySummaries({ actor: { kind: "staff", name: actor.name }, ...texts }),
    });

    // Starting a job tells the customer nothing by notification or email: they see it on the job.
    if (action !== WorkOrderAction.START) {
      const customer = job.customer.user;
      const linkPath = `/portal/jobs/${id}`;
      const notification = await notify(tx, {
        recipientUserId: customer.id,
        type: NOTIFICATION_TYPES[action],
        ...transitionNotification({
          action,
          reference: job.reference,
          serviceName: job.serviceNameSnapshot,
        }),
        linkPath,
        entity: { type: ActivityEntityType.WORK_ORDER, id },
      });
      const common = {
        customerName: customer.name,
        jobReference: job.reference,
        serviceName: job.serviceNameSnapshot,
        jobUrl: absoluteAppUrl(config.email.publicWebUrl, linkPath),
      };
      const options = { notificationId: notification.id };
      // The template inputs have fields for the reference, the service and the optional message
      // only: neither the reason nor a note can be handed to them.
      if (action === WorkOrderAction.COMPLETE) {
        after.email(emailJob("job-completed", customer.email, common, options));
      } else if (action === WorkOrderAction.MARK_NEEDS_RESCHEDULING) {
        after.email(
          emailJob(
            "job-needs-rescheduling",
            customer.email,
            { ...common, ...(customerMessage !== undefined && { customerMessage }) },
            options,
          ),
        );
      } else {
        after.email(
          emailJob(
            "job-cancelled",
            customer.email,
            { ...common, ...(customerMessage !== undefined && { customerMessage }) },
            options,
          ),
        );
      }
    }

    return { startedBeforeSchedule: early };
  });

  emailDispatcher.dispatchAfterCommit(afterCommit);
  return {
    workOrder: await getAdminWorkOrder(deps, id),
    startedBeforeSchedule: result.startedBeforeSchedule,
  };
}
