import type { CalendarItemDto } from "@fixflow/shared";
import { type CSSProperties, type ReactNode, useId, useMemo } from "react";

import { ScrollRegion } from "@/components/ui/scroll-region";
import { cn } from "@/lib/utils";

import { HOUR_HEIGHT_REM, hourCount, layoutColumns, type VisibleHours } from "../lib/layout";
import type { BusinessNow } from "../lib/use-calendar-clock";
import type { DayVisit } from "../lib/visits";
import { VisitBlock } from "./visit-block";

/** The narrowest a day may get before the grid scrolls sideways instead of squeezing its blocks. */
const MIN_COLUMN_REM = 5.5;
const GUTTER_REM = 3.5;

export interface TimeGridColumn {
  key: string;
  /** The business day this column is, for the line across today. `null` for a column that is not a day. */
  date: string | null;
  /** The visible heading: a day's name and number, or a technician. */
  heading: ReactNode;
  /** What a screen reader hears for the heading: "Tuesday, March 3, today". */
  headingLabel: string;
  isToday: boolean;
  blocks: DayVisit[];
}

export interface TimeGridProps {
  columns: readonly TimeGridColumn[];
  hours: VisibleHours;
  timeZone: string;
  now: BusinessNow | null;
  /** Names the scrolling region: "Week of Mar 2 – 8, 2026". */
  label: string;
  onOpen: (visit: CalendarItemDto, trigger: HTMLButtonElement) => void;
}

// A crisp line under every hour, and a fainter one under every half hour, drawn with the border tokens.
const HOUR_LINES =
  "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour-height) - 1px), var(--color-border) calc(var(--hour-height) - 1px), var(--color-border) var(--hour-height))";
const HALF_HOUR_LINES =
  "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour-height) / 2 - 1px), var(--color-surface-muted) calc(var(--hour-height) / 2 - 1px), var(--color-surface-muted) calc(var(--hour-height) / 2))";

/** "7 AM", "12 PM". */
export function hourLabel(hour: number): string {
  return `${String(hour % 12 || 12)} ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
}

/**
 * The hour grid the week and day views share: a gutter of hour labels and one column per day (or per
 * technician), each as tall as its hours and with its visits laid on top. Plain CSS grid: the columns
 * share the width, the blocks inside a column are positioned by percentages of its height, so the
 * layout never needs measuring. On a narrow window the columns stop shrinking at a readable width and
 * the grid scrolls sideways inside its own focusable region (the page itself never does).
 *
 * Reading order is day by day: each column is a list headed by its day, with its visits in time order,
 * so Tab walks Monday's visits, then Tuesday's, and the hour labels and lines are hidden from
 * assistive technology (every block says its own time).
 */
export function TimeGrid({ columns, hours, timeZone, now, label, onOpen }: TimeGridProps) {
  const prefix = useId();
  const rows = hourCount(hours);
  const hourNumbers = Array.from({ length: rows }, (_, index) => hours.startHour + index);
  const template = `${String(GUTTER_REM)}rem repeat(${String(columns.length)}, minmax(${String(MIN_COLUMN_REM)}rem, 1fr))`;
  const bodyHeight = `calc(${String(rows)} * var(--hour-height))`;

  return (
    // `relative` makes the region the containing block of the screen-reader-only day headings, which
    // are absolutely positioned: without it they sit relative to the page, off to the right of the
    // columns they belong to, and stretch the page sideways on a narrow screen.
    <ScrollRegion label={label} className="relative rounded-xl border border-border bg-surface">
      <div
        data-testid="time-grid"
        className="grid"
        style={
          {
            gridTemplateColumns: template,
            "--hour-height": `${String(HOUR_HEIGHT_REM)}rem`,
          } as CSSProperties
        }
      >
        {/* The header row. The corner stays put when the grid scrolls sideways. */}
        <div className="sticky left-0 z-20 border-b border-border bg-surface" />
        {columns.map((column) => (
          <h3
            key={column.key}
            id={`${prefix}-${column.key}`}
            aria-current={column.isToday ? "date" : undefined}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 border-b border-l border-border px-1 py-2 text-center text-xs font-medium text-ink-secondary",
              column.isToday && "bg-brand-soft text-brand",
            )}
          >
            <span className="sr-only">{column.headingLabel}</span>
            <span aria-hidden="true" className="flex min-w-0 flex-col items-center gap-0.5">
              {column.heading}
            </span>
          </h3>
        ))}

        {/* The hour labels. */}
        <div
          aria-hidden="true"
          className="sticky left-0 z-10 bg-surface"
          style={{ height: bodyHeight }}
        >
          {hourNumbers.map((hour) => (
            <div
              key={hour}
              data-hour={hour}
              className="relative pr-2 text-right text-xs text-ink-muted"
              style={{ height: "var(--hour-height)" }}
            >
              <span className="absolute right-2 top-1 tabular-nums">{hourLabel(hour)}</span>
            </div>
          ))}
        </div>

        {columns.map((column) => (
          <DayColumn
            key={column.key}
            column={column}
            labelledBy={`${prefix}-${column.key}`}
            hours={hours}
            timeZone={timeZone}
            now={now}
            height={bodyHeight}
            onOpen={onOpen}
          />
        ))}
      </div>
    </ScrollRegion>
  );
}

function DayColumn({
  column,
  labelledBy,
  hours,
  timeZone,
  now,
  height,
  onOpen,
}: {
  column: TimeGridColumn;
  labelledBy: string;
  hours: VisibleHours;
  timeZone: string;
  now: BusinessNow | null;
  height: string;
  onOpen: TimeGridProps["onOpen"];
}) {
  // The side-by-side layout depends only on this column's blocks: not recomputed when something else changes.
  const slots = useMemo(
    () => layoutColumns(column.blocks.map((block) => block.segment)),
    [column.blocks],
  );

  const nowTop =
    now !== null && column.date !== null && now.date === column.date
      ? ((now.minutes - hours.startHour * 60) / ((hours.endHour - hours.startHour) * 60)) * 100
      : null;

  return (
    <div
      className={cn("relative border-l border-border", column.isToday && "bg-brand-soft/40")}
      style={{ height }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: `${HOUR_LINES}, ${HALF_HOUR_LINES}` }}
      />
      <ul aria-labelledby={labelledBy} className="absolute inset-0 m-0 list-none p-0">
        {column.blocks.map(({ visit, segment }) => (
          <VisitBlock
            key={visit.id}
            visit={visit}
            segment={segment}
            hours={hours}
            slot={slots.get(visit.id) ?? { column: 0, columns: 1 }}
            timeZone={timeZone}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {nowTop !== null && nowTop >= 0 && nowTop <= 100 ? (
        <div
          aria-hidden="true"
          data-testid="now-indicator"
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
          style={{ top: `${String(nowTop)}%` }}
        >
          <span className="-ml-1 size-2 shrink-0 rounded-full bg-danger" />
          <span className="h-px flex-1 bg-danger" />
        </div>
      ) : null}
    </div>
  );
}
