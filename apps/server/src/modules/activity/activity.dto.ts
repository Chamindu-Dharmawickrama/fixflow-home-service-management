import type {
  ActivityMetadataDto,
  AdminTimelineEventDto,
  CustomerTimelineEventDto,
  Role,
} from "@fixflow/shared";

import type { ActivityEvent } from "../../generated/prisma/client.js";

/**
 * Timeline serializers (D-41). The customer one is built field by field from an allowlist and never
 * spreads the row, so a column added to `ActivityEvent` later cannot reach a customer unnoticed.
 */

export type AdminTimelineRow = ActivityEvent & {
  actor: { name: string; role: Role } | null;
};

export type CustomerTimelineRow = Pick<
  ActivityEvent,
  "id" | "actorUserId" | "toStatus" | "createdAt"
> & {
  /** Never `null`: internal events are not selected for customers. */
  publicSummary: string;
};

function toMetadata(value: unknown): ActivityMetadataDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const metadata: ActivityMetadataDto = {};
  for (const [key, item] of Object.entries(value) as Array<[string, unknown]>) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      metadata[key] = item;
    } else if (
      Array.isArray(item) &&
      item.every((entry): entry is string => typeof entry === "string")
    ) {
      metadata[key] = item;
    }
  }
  return metadata;
}

/** Everything staff may see about an event, including internal-only events and summaries. */
export function toAdminTimelineEvent(row: AdminTimelineRow): AdminTimelineEventDto {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    summary: row.summary,
    publicSummary: row.publicSummary,
    customerVisible: row.publicSummary !== null,
    metadata: toMetadata(row.metadata),
    actor: row.actor === null ? null : { name: row.actor.name, role: row.actor.role },
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CustomerTimelineViewer {
  /** The signed-in customer's user id, so their own actions read as "You". */
  userId: string;
  businessName: string;
}

export const CUSTOMER_ACTOR_YOU = "You";

/**
 * What a customer may see about an event: the sentence written for them, when it happened, the
 * status it led to, and who did it as `"You"` or the business name. Staff names, the internal
 * summary, metadata and ids of other records are not part of the result.
 */
export function toCustomerTimelineEvent(
  row: CustomerTimelineRow,
  viewer: CustomerTimelineViewer,
): CustomerTimelineEventDto {
  // Fail closed: an internal event must never be serialized for a customer, whatever the query did.
  if ((row.publicSummary as string | null) === null) {
    throw new Error("An internal activity event was passed to the customer serializer.");
  }
  return {
    id: row.id,
    publicSummary: row.publicSummary,
    toStatus: row.toStatus,
    actor: row.actorUserId === viewer.userId ? CUSTOMER_ACTOR_YOU : viewer.businessName,
    createdAt: row.createdAt.toISOString(),
  };
}
