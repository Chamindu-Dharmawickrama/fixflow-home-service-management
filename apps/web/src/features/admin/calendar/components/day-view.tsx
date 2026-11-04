import type { CalendarItemDto } from "@fixflow/shared";
import { useMemo } from "react";

import { TECHNICIAN_COLOR_STYLES } from "@/features/admin/lib/technician-colors";
import { cn } from "@/lib/utils";

import { dayOfMonth, longDateLabel, shortWeekdayName } from "../lib/dates";
import { visibleHoursFor } from "../lib/layout";
import type { BusinessNow } from "../lib/use-calendar-clock";
import { blocksByDay, splitByTechnician } from "../lib/visits";
import { TimeGrid, type TimeGridColumn } from "./time-grid";

export interface DayViewProps {
  items: readonly CalendarItemDto[];
  /** The day to show. */
  date: string;
  today: string;
  timeZone: string;
  now: BusinessNow | null;
  /** One column for each technician who has a visit that day, instead of one column for everyone. */
  split: boolean;
  onOpen: (visit: CalendarItemDto, trigger: HTMLButtonElement) => void;
}

/**
 * One day on the hour grid: a single column, or (when asked) a column for each technician who has a
 * visit that day, so each person's day reads on its own. Visits that overlap in a column are laid
 * side by side, as in the week.
 */
export function DayView({ items, date, today, timeZone, now, split, onOpen }: DayViewProps) {
  const { columns, hours } = useMemo(() => {
    const blocks = blocksByDay(items, [date], timeZone).get(date) ?? [];
    const isToday = date === today;
    const dayHeading = (
      <>
        <span className="uppercase tracking-wide">{shortWeekdayName(date)}</span>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
            isToday ? "bg-brand text-surface" : "text-ink",
          )}
        >
          {dayOfMonth(date)}
        </span>
      </>
    );
    const dayLabel = `${longDateLabel(date)}${isToday ? ", today" : ""}`;

    const built: TimeGridColumn[] =
      split && blocks.length > 0
        ? splitByTechnician(blocks).map((column) => ({
            key: column.technicianId ?? "none",
            date,
            isToday,
            headingLabel: `${column.name}, ${dayLabel}`,
            heading: (
              <>
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    column.calendarColor === null
                      ? "bg-border-strong"
                      : TECHNICIAN_COLOR_STYLES[column.calendarColor].dot,
                  )}
                />
                <span className="max-w-full truncate text-sm font-semibold text-ink">
                  {column.name}
                </span>
              </>
            ),
            blocks: column.blocks,
          }))
        : [
            {
              key: date,
              date,
              isToday,
              headingLabel: dayLabel,
              heading: dayHeading,
              blocks,
            },
          ];
    return { columns: built, hours: visibleHoursFor(blocks.map((block) => block.segment)) };
  }, [items, date, today, timeZone, split]);

  return (
    <TimeGrid
      columns={columns}
      hours={hours}
      timeZone={timeZone}
      now={now}
      label={`${longDateLabel(date)}, scrolls sideways on a narrow screen`}
      onOpen={onOpen}
    />
  );
}
