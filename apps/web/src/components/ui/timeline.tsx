import type { LucideIcon } from "lucide-react";
import { Circle } from "lucide-react";
import type { ReactNode } from "react";

import { DateTimeText } from "@/components/ui/date-time-text";
import type { StatusTone } from "@/lib/formatting/status";
import { cn } from "@/lib/utils";

export interface TimelineEvent {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** ISO 8601 instant. */
  timestamp: string;
  /** Who did it: a person's name, or "System". */
  actor?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: StatusTone | undefined;
}

export interface TimelineProps {
  events: readonly TimelineEvent[];
  /** The business time zone, used to show every timestamp. */
  timeZone: string;
  /** Names the list for screen readers: "Request history". */
  label: string;
  className?: string | undefined;
}

const DOT_TONES: Record<StatusTone, string> = {
  info: "bg-info-soft text-info",
  attention: "bg-attention-soft text-attention",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-neutral-soft text-neutral",
};

/**
 * A vertical history of what happened and when, in the order given (callers pass newest first for
 * activity feeds, oldest first for a record's life cycle). Customer timelines must be built from
 * customer-safe events only; this component displays whatever it is given.
 */
export function Timeline({ events, timeZone, label, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {events.map((event, index) => {
        const Icon = event.icon ?? Circle;
        const isLast = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-4 top-8 w-px -translate-x-1/2 bg-border"
              />
            )}
            <span
              className={cn(
                "relative flex size-8 shrink-0 items-center justify-center rounded-full",
                DOT_TONES[event.tone ?? "neutral"],
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
              <p className="text-sm font-medium text-ink">{event.title}</p>
              {event.description ? (
                <p className="text-sm text-ink-secondary">{event.description}</p>
              ) : null}
              <p className="text-xs text-ink-muted">
                <DateTimeText value={event.timestamp} timeZone={timeZone} />
                {event.actor ? <span> · {event.actor}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
