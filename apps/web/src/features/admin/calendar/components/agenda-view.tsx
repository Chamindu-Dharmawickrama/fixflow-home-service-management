import type { CalendarItemDto } from "@fixflow/shared";
import { useId, useMemo } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import { TECHNICIAN_COLOR_STYLES } from "@/features/admin/lib/technician-colors";
import { cn } from "@/lib/utils";

import { agendaDayLabel, weekdayName } from "../lib/dates";
import { visitTimeRange } from "../lib/visit-text";
import { agendaDays, businessDateOf } from "../lib/visits";

export interface AgendaViewProps {
  items: readonly CalendarItemDto[];
  today: string;
  timeZone: string;
  onOpen: (visit: CalendarItemDto, trigger: HTMLButtonElement) => void;
}

/**
 * The list alternative to the grid (UX-QB-CAL): the same visits grouped by day, in time order, as
 * cards with the same information. Days with nothing on them are left out, so a quiet week is short.
 * It is the default on a phone and available at every width.
 */
export function AgendaView({ items, today, timeZone, onOpen }: AgendaViewProps) {
  const prefix = useId();
  const days = useMemo(() => agendaDays(items, timeZone), [items, timeZone]);

  return (
    <ol data-testid="agenda" className="flex flex-col gap-6">
      {days.map((day) => (
        <li key={day.date}>
          <h3
            id={`${prefix}-${day.date}`}
            aria-current={day.date === today ? "date" : undefined}
            className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"
          >
            {agendaDayLabel(day.date)}
            {day.date === today ? (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                Today
              </span>
            ) : null}
          </h3>
          <ul aria-labelledby={`${prefix}-${day.date}`} className="flex flex-col gap-2">
            {day.visits.map((visit) => (
              <li key={visit.id}>
                <VisitCard visit={visit} timeZone={timeZone} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function VisitCard({
  visit,
  timeZone,
  onOpen,
}: {
  visit: CalendarItemDto;
  timeZone: string;
  onOpen: AgendaViewProps["onOpen"];
}) {
  const color =
    visit.technician === null ? null : TECHNICIAN_COLOR_STYLES[visit.technician.calendarColor];
  const dayOf = businessDateOf(visit.start, timeZone);
  return (
    <button
      type="button"
      data-testid="visit-card"
      data-visit-id={visit.id}
      data-status={visit.status}
      onClick={(event) => onOpen(visit, event.currentTarget)}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-xl border border-l-4 border-border bg-surface p-3 text-left",
        "shadow-sm motion-safe:transition-shadow hover:shadow-md",
        color === null ? "border-l-border-strong" : color.edge,
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {/* The card is named by what it shows, so its name always contains its visible text; the day heading above it is what names the day to a sighted reader, so it is said here too. */}
        <span className="min-w-0 font-semibold tabular-nums text-ink">
          <span className="sr-only">{weekdayName(dayOf)}, </span>
          {visitTimeRange(visit, timeZone)}
        </span>
        <StatusBadge kind="workOrder" status={visit.status} />
      </span>
      <span className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">
        {visit.reference} · {visit.serviceName}
      </span>
      <span className="min-w-0 text-sm text-ink-secondary [overflow-wrap:anywhere]">
        {visit.customerName} · {visit.city}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink-secondary">
        {visit.technician === null ? (
          "No technician assigned"
        ) : (
          <>
            <span className="sr-only">Technician: </span>
            <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", color?.dot)} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{visit.technician.name}</span>
          </>
        )}
      </span>
    </button>
  );
}
