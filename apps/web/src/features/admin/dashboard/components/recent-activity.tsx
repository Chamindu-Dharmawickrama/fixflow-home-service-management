import type { DashboardActivityDto } from "@fixflow/shared";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { eventAppearance } from "@/features/activity/lib/event-appearance";
import { SYSTEM_ACTOR } from "@/features/activity/lib/to-timeline-events";

function toEvent(event: DashboardActivityDto): TimelineEvent {
  const { tone, icon } = eventAppearance(event.toStatus);
  return {
    id: event.id,
    title:
      event.link === null ? (
        event.summary
      ) : (
        <Link
          href={event.link}
          className="rounded-sm text-ink underline-offset-4 [overflow-wrap:anywhere] hover:text-brand hover:underline"
        >
          {event.summary}
        </Link>
      ),
    timestamp: event.createdAt,
    actor: event.actorName ?? SYSTEM_ACTOR,
    tone,
    icon,
  };
}

/**
 * "Recent activity" (FR-083): the latest events across the business, newest first, each opening the
 * record it is about. These are the staff's own history lines (D-41); the customer's shape is a
 * different endpoint and never reaches this page.
 */
export function RecentActivity({
  events,
  timeZone,
}: {
  events: readonly DashboardActivityDto[];
  timeZone: string;
}) {
  return (
    <Card aria-labelledby="activity-heading" role="region" data-testid="recent-activity">
      <CardHeader>
        <CardTitle as="h2" id="activity-heading">
          Recent activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            Nothing has happened yet. Requests, quotations, jobs and payments are recorded here as
            they go.
          </p>
        ) : (
          <Timeline events={events.map(toEvent)} timeZone={timeZone} label="Recent activity" />
        )}
      </CardContent>
    </Card>
  );
}
