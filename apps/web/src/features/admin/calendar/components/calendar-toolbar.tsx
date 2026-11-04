"use client";

import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { calendarHref, type CalendarQuery } from "../lib/calendar-url";
import {
  CALENDAR_VIEWS,
  type CalendarView,
  rangeHeading,
  stepDate,
  VIEW_LABELS,
} from "../lib/dates";

export interface ToolbarTechnician {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CalendarToolbarProps {
  /** What the address says (the view may be absent). */
  query: CalendarQuery;
  /** The view on screen: the address's, or the one that fits the window. `null` until the window is known. */
  view: CalendarView | null;
  technicians: readonly ToolbarTechnician[];
  /** The id of the range heading, which names the calendar region. */
  headingId: string;
  needsSchedulingTotal: number;
  panelButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenPanel: () => void;
}

const STEP_LABELS: Record<CalendarView, { previous: string; next: string }> = {
  week: { previous: "Previous week", next: "Next week" },
  day: { previous: "Previous day", next: "Next day" },
  agenda: { previous: "Previous week", next: "Next week" },
};

/**
 * The calendar's controls (UX-QB-CAL): Today, previous and next, a date to jump to, the view, the
 * technician, and the panel of jobs waiting for a time. Everything but the panel lives in the address
 * (`view`, `date`, `technician`, D-40), so a screen can be bookmarked or shared, and the browser's Back
 * button undoes a step. Moving through time and changing the filter ask the server for the data of the
 * new week once; switching between the week, day and agenda of the same week asks for nothing.
 */
export function CalendarToolbar({
  query,
  view,
  technicians,
  headingId,
  needsSchedulingTotal,
  panelButtonRef,
  onOpenPanel,
}: CalendarToolbarProps) {
  const router = useRouter();
  const stepView = view ?? "week";
  const go = (
    patch: Partial<Pick<CalendarQuery, "view" | "technicianId" | "split">> & {
      date?: string | null;
    },
  ) =>
    calendarHref({
      view: patch.view === undefined ? query.view : patch.view,
      date: patch.date === undefined ? query.date : patch.date,
      technicianId: patch.technicianId === undefined ? query.technicianId : patch.technicianId,
      split: patch.split === undefined ? query.split : patch.split,
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline">
            <Link href={go({ date: null })}>Today</Link>
          </Button>
          <Button asChild variant="ghost" className="size-11 px-0 sm:size-10">
            <Link
              href={go({ date: stepDate(query.date, stepView, -1) })}
              aria-label={STEP_LABELS[stepView].previous}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" className="size-11 px-0 sm:size-10">
            <Link
              href={go({ date: stepDate(query.date, stepView, 1) })}
              aria-label={STEP_LABELS[stepView].next}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <h2
          id={headingId}
          tabIndex={-1}
          className="min-w-0 font-display text-lg font-semibold text-ink [overflow-wrap:anywhere]"
        >
          {rangeHeading(stepView === "day" ? "day" : "week", query.date)}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label="Calendar view">
          <ul className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5">
            {CALENDAR_VIEWS.map((candidate) => (
              <li key={candidate}>
                <Link
                  href={go({ view: candidate })}
                  aria-current={view === candidate ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-md px-3 text-sm font-medium sm:h-9",
                    "motion-safe:transition-colors",
                    view === candidate
                      ? "bg-brand text-surface"
                      : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  {VIEW_LABELS[candidate]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="w-44">
          <label htmlFor="calendar-date" className="sr-only">
            Go to date
          </label>
          <DateInput
            id="calendar-date"
            value={query.date}
            onChange={(event) => {
              // A half-typed date is an empty value: wait for a whole one.
              if (event.target.value !== "") {
                router.push(go({ date: event.target.value }));
              }
            }}
          />
        </div>

        <div className="w-52">
          <label htmlFor="calendar-technician" className="sr-only">
            Technician
          </label>
          <Select
            id="calendar-technician"
            value={query.technicianId ?? ""}
            onChange={(event) => router.push(go({ technicianId: event.target.value || null }))}
          >
            <option value="">All technicians</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name}
                {technician.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </div>

        {view === "day" ? (
          <div className="flex items-center gap-2">
            <Switch
              id="calendar-split"
              checked={query.split}
              disabled={query.technicianId !== null}
              onCheckedChange={(checked) => router.push(go({ split: checked }))}
            />
            <label htmlFor="calendar-split" className="text-sm text-ink-secondary">
              Split by technician
            </label>
          </div>
        ) : null}

        <Button
          ref={panelButtonRef}
          variant={needsSchedulingTotal > 0 ? "secondary" : "outline"}
          className="sm:ml-auto"
          onClick={onOpenPanel}
        >
          <CalendarPlus aria-hidden="true" />
          Needs scheduling
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums text-ink">
            {needsSchedulingTotal}
          </span>
        </Button>
      </div>
    </div>
  );
}
