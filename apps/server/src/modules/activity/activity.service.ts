import type { ActivityEntityType } from "@fixflow/shared";

import type { ActivityEvent } from "../../generated/prisma/client.js";
import type { DbClient } from "../../lib/db.js";
import {
  type ActivityMetadata,
  ActivityValidationError,
  validateActivityMetadata,
} from "./activity.metadata.js";

export interface RecordActivityInput {
  /** The user who acted. `null` means the system did (for example an expiry job). Required on purpose. */
  actorUserId: string | null;
  entityType: ActivityEntityType;
  entityId: string;
  /** Dotted, lower-case verb phrase: `quotation.sent`, `work_order.rescheduled`. */
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  /** What happened, for staff. May mention internal detail; never shown to customers. */
  summary: string;
  /** What the customer sees on their timeline. Leave out to keep the event staff-only. */
  publicSummary?: string | null;
  /** Allowlisted, non-sensitive facts only. */
  metadata?: ActivityMetadata;
  /** The request this event belongs to, for the request timeline. */
  requestId?: string | null;
  /** The customer this event belongs to; scopes the customer-visible timeline. */
  customerId?: string | null;
}

const MAX_SUMMARY_LENGTH = 500;
const MAX_PUBLIC_SUMMARY_LENGTH = 300;
const MAX_ACTION_LENGTH = 60;
const ACTION_FORMAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const STATUS_FORMAT = /^[A-Z][A-Z0-9_]{0,39}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(name: string, value: string | null | undefined): void {
  if (value !== null && value !== undefined && !UUID_FORMAT.test(value)) {
    throw new ActivityValidationError(`Activity ${name} must be a UUID.`);
  }
}

function requireText(name: string, value: string | null | undefined, maxLength: number): void {
  if (value !== null && value !== undefined && (value.trim() === "" || value.length > maxLength)) {
    throw new ActivityValidationError(`Activity ${name} must be 1-${maxLength} characters.`);
  }
}

function requireStatus(name: string, value: string | null | undefined): void {
  if (value !== null && value !== undefined && !STATUS_FORMAT.test(value)) {
    throw new ActivityValidationError(`Activity ${name} must be an upper-case status name.`);
  }
}

/**
 * Appends one event to the activity history (D-29, FR-093). Call it inside the transaction of the
 * business change it describes, so the event exists exactly when the change does. Nothing in the
 * application updates or deletes events. The input is validated first; an invalid event throws
 * {@link ActivityValidationError} (a programming error) and writes nothing.
 */
export async function recordActivity(
  tx: DbClient,
  input: RecordActivityInput,
): Promise<ActivityEvent> {
  requireUuid("actorUserId", input.actorUserId);
  requireUuid("entityId", input.entityId);
  requireUuid("requestId", input.requestId);
  requireUuid("customerId", input.customerId);

  if (input.action.length > MAX_ACTION_LENGTH || !ACTION_FORMAT.test(input.action)) {
    throw new ActivityValidationError(
      'Activity action must look like "quotation.sent" (lower-case words separated by dots).',
    );
  }
  requireStatus("fromStatus", input.fromStatus);
  requireStatus("toStatus", input.toStatus);
  requireText("summary", input.summary, MAX_SUMMARY_LENGTH);
  requireText("publicSummary", input.publicSummary, MAX_PUBLIC_SUMMARY_LENGTH);
  const metadata = validateActivityMetadata(input.metadata ?? {});

  return tx.activityEvent.create({
    data: {
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      summary: input.summary,
      publicSummary: input.publicSummary ?? null,
      metadata,
      requestId: input.requestId ?? null,
      customerId: input.customerId ?? null,
    },
  });
}
