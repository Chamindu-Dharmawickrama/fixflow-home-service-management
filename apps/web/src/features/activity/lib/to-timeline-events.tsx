import type { AdminTimelineEventDto, CustomerTimelineEventDto } from "@fixflow/shared";

import { Badge } from "@/components/ui/badge";
import type { TimelineEvent } from "@/components/ui/timeline";

import { eventAppearance } from "./event-appearance";

/** Shown as the actor of an event the system recorded (an expiry job, an automatic change). */
export const SYSTEM_ACTOR = "System";

/**
 * Staff timeline entry. The title is the internal summary. An event the customer does not see is
 * marked with an "Internal" badge (text, not colour alone); one the customer does see also shows
 * exactly what they read, so staff know what the customer was told.
 */
export function toAdminTimelineEvent(event: AdminTimelineEventDto): TimelineEvent {
  const { tone, icon } = eventAppearance(event.toStatus);
  return {
    id: event.id,
    title: event.customerVisible ? (
      event.summary
    ) : (
      <>
        {event.summary} <Badge className="align-middle">Internal</Badge>
      </>
    ),
    description: event.customerVisible
      ? `Customer sees: “${event.publicSummary ?? ""}”`
      : undefined,
    timestamp: event.createdAt,
    actor: event.actor?.name ?? SYSTEM_ACTOR,
    tone,
    icon,
  };
}

/**
 * Customer timeline entry: the sentence written for them, when it happened, and who did it as
 * `"You"` or the business name. There is no internal text to show, because none is in the DTO.
 */
export function toCustomerTimelineEvent(event: CustomerTimelineEventDto): TimelineEvent {
  const { tone, icon } = eventAppearance(event.toStatus);
  return {
    id: event.id,
    title: event.publicSummary,
    timestamp: event.createdAt,
    actor: event.actor,
    tone,
    icon,
  };
}
