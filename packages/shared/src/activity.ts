import type { ActivityEntityType, Role } from "./enums.js";

/**
 * Activity timeline shapes (D-29, D-41, FR-093, FR-094). There are two on purpose: the admin shape
 * shows everything staff wrote down, the customer shape is built from a short allowlist of fields,
 * so an internal summary or a metadata key can never reach a customer by adding a column.
 */

/** Allowlisted, non-sensitive facts attached to an event (see `activity.metadata.ts` on the server). */
export type ActivityMetadataDto = Record<string, string | number | boolean | string[]>;

/** One event on a staff timeline. Includes internal-only events and internal summaries. */
export interface AdminTimelineEventDto {
  id: string;
  /** Dotted verb phrase such as `quotation.sent`. */
  action: string;
  entityType: ActivityEntityType;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  /** What happened, for staff. */
  summary: string;
  /** What the customer sees for this event; `null` means the event is internal only. */
  publicSummary: string | null;
  /** True when the customer sees this event (`publicSummary` is set). */
  customerVisible: boolean;
  metadata: ActivityMetadataDto;
  /** Who acted; `null` means the system did. */
  actor: { name: string; role: Role } | null;
  /** ISO 8601 instant. */
  createdAt: string;
}

/**
 * One event on a customer's timeline. Only these fields exist: there is deliberately no internal
 * summary, no metadata and no internal user identity.
 */
export interface CustomerTimelineEventDto {
  id: string;
  /** What happened, written for the customer. */
  publicSummary: string;
  toStatus: string | null;
  /** Who did it, as the customer should see it: `"You"` or the business name. */
  actor: string;
  /** ISO 8601 instant. */
  createdAt: string;
}
