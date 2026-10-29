import type { AdminTimelineEventDto, CustomerTimelineEventDto } from "@fixflow/shared";

import { Timeline } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";

import { toAdminTimelineEvent, toCustomerTimelineEvent } from "../lib/to-timeline-events";

type Variant =
  | { variant: "admin"; events: readonly AdminTimelineEventDto[] }
  | { variant: "customer"; events: readonly CustomerTimelineEventDto[] };

export type ActivityTimelineProps = Variant & {
  /** The business time zone, from the settings. */
  timeZone: string;
  /** Names the list for screen readers. Defaults to "Activity history" (staff) or "Request history" (customer). */
  label?: string | undefined;
  /** Shown when there is nothing to list. */
  emptyMessage?: string | undefined;
  className?: string | undefined;
};

const DEFAULT_LABELS = { admin: "Activity history", customer: "Request history" } as const;

/**
 * The history of a request or record (FR-093, FR-094), as an adapter from the API's timeline DTOs to
 * the design system's `Timeline`.
 *
 * - `variant="admin"` takes the staff DTOs: internal summaries, actor names, and an "Internal" badge
 *   on the events the customer cannot see.
 * - `variant="customer"` takes the customer DTOs, which hold only what the customer may see.
 *
 * The component trusts the DTOs it is given; the separation is enforced by the API (D-41), which
 * returns a different shape for each audience. Pass events in the order they should be read.
 */
export function ActivityTimeline(props: ActivityTimelineProps) {
  const { timeZone, className, emptyMessage = "Nothing has happened yet." } = props;
  const label = props.label ?? DEFAULT_LABELS[props.variant];

  if (props.events.length === 0) {
    return <p className={cn("text-sm text-ink-secondary", className)}>{emptyMessage}</p>;
  }

  const events =
    props.variant === "admin"
      ? props.events.map(toAdminTimelineEvent)
      : props.events.map(toCustomerTimelineEvent);

  return <Timeline events={events} timeZone={timeZone} label={label} className={className} />;
}
