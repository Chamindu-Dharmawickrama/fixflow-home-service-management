import type { WorkOrderStatus, WorkOrderStatusAction } from "@fixflow/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import {
  assertWorkOrderAction,
  staleWorkOrderError,
  WORK_ORDER_ACTION_TARGET,
} from "./work-orders.domain.js";

/**
 * The only code that writes a work order's `status` (CLAUDE.md §7): {@link createPendingWorkOrder}
 * makes one (it starts `PENDING_SCHEDULING`, the database default) and {@link transitionWorkOrder}
 * moves it on. Both run inside the caller's transaction, which also records the history.
 */

/**
 * Makes a work order. Its status is the column's default, `PENDING_SCHEDULING` (D-24): a job has no
 * earlier status, so creating one is not a transition. The unique foreign keys (`quotationId`,
 * `requestId`) make a second job for the same quotation or request impossible.
 */
export function createPendingWorkOrder(
  tx: DbClient,
  data: Omit<
    Prisma.WorkOrderUncheckedCreateInput,
    "status" | "scheduledStart" | "scheduledEnd" | "technicianId"
  >,
) {
  return tx.workOrder.create({ data, select: { id: true, reference: true } });
}

/**
 * Locks the work order's row until the transaction ends, so two admins acting on the same job take
 * turns instead of racing (a reschedule is a change from `SCHEDULED` to `SCHEDULED`, which the
 * conditional status update alone cannot tell apart from a second one). Returns whether it exists.
 */
export async function lockWorkOrder(tx: DbClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export interface LockedTechnician {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Locks the technician's row until the transaction ends and reads it under the lock (D-25). Every
 * scheduling that names this technician takes it first, so the check "do they have a job in that
 * time?" and the write that books the time happen one scheduling at a time: of two that overlap, the
 * second waits here, then sees the first one's job and is refused. `null` when there is no such
 * technician.
 */
export async function lockTechnician(tx: DbClient, id: string): Promise<LockedTechnician | null> {
  const rows = await tx.$queryRaw<{ id: string; name: string; is_active: boolean }[]>`
    SELECT id, name, is_active FROM technicians WHERE id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, name: row.name, isActive: row.is_active };
}

export interface WorkOrderTransitionInput {
  workOrderId: string;
  /** The admin action being taken, checked against the current status as well as the target. */
  action: WorkOrderStatusAction;
  /**
   * The status the caller saw (D-46). A different current status is `409 STALE_STATE`, before the
   * change is judged: the caller's view is out of date.
   */
  expectedStatus?: WorkOrderStatus;
  /** Other columns that change with the status, in the same statement (the appointment, the technician). */
  data?: Prisma.WorkOrderUncheckedUpdateManyInput;
}

/**
 * Moves a work order to the status an action leads to, inside the caller's transaction, and returns
 * the status it left.
 *
 * - `404` when the work order does not exist;
 * - `409 STALE_STATE` when `expectedStatus` is not the current status, or when the status changed
 *   between reading it and writing it (the update is conditional on the status that was read);
 * - `409 INVALID_STATE_TRANSITION` when D-24 does not allow the action here, leaving the record
 *   untouched.
 */
export async function transitionWorkOrder(
  tx: DbClient,
  input: WorkOrderTransitionInput,
): Promise<{ from: WorkOrderStatus }> {
  const { workOrderId, action, expectedStatus, data } = input;

  const current = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true },
  });
  if (current === null) {
    throw notFound();
  }
  if (expectedStatus !== undefined && current.status !== expectedStatus) {
    throw staleWorkOrderError(current.status);
  }
  assertWorkOrderAction(current.status, action);

  const { count } = await tx.workOrder.updateMany({
    where: { id: workOrderId, status: current.status },
    // The status comes last, so `data` can never overwrite it.
    data: { ...data, status: WORK_ORDER_ACTION_TARGET[action] },
  });
  if (count === 0) {
    // Someone else moved it between the read and the write.
    const now = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true },
    });
    throw now === null ? notFound() : staleWorkOrderError(now.status);
  }
  return { from: current.status };
}
