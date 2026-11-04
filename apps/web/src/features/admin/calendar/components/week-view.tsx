import type { CalendarItemDto } from "@fixflow/shared";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { dayOfMonth, longDateLabel, rangeHeading, shortWeekdayName, weekDays } from "../lib/dates";
import { visibleHoursFor } from "../lib/layout";
import type { BusinessNow } from "../lib/use-calendar-clock";
import { blocksByDay } from "../lib/visits";
import { TimeGrid, type TimeGridColumn } from "./time-grid";

export interface WeekViewProps {
  items: readonly CalendarItemDto[];
  /** Any day of the week to show. */
  date: string;
  /** Today on the business's calendar. */
  today: string;
  timeZone: string;
  now: BusinessNow | null;
  onOpen: (visit: CalendarItemDto, trigger: HTMLButtonElement) => void;
}

/**
 * The week (Monday to Sunday, D-107): seven day columns on an hour grid. The hours shown are 07:00 to
 * 20:00, widened to take in an early or a late visit anywhere in the week, so every column lines up.
 */
export function WeekView({ items, date, today, timeZone, now, onOpen }: WeekViewProps) {
  const { columns, hours } = useMemo(() => {
    const days = weekDays(date);
    const byDay = blocksByDay(items, days, timeZone);
    const segments = [...byDay.values()].flatMap((blocks) => blocks.map((block) => block.segment));
    const built: TimeGridColumn[] = days.map((day) => {
      const isToday = day === today;
      return {
        key: day,
        date: day,
        isToday,
        headingLabel: `${longDateLabel(day)}${isToday ? ", today" : ""}`,
        heading: (
          <>
            <span className="uppercase tracking-wide">{shortWeekdayName(day)}</span>
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                isToday ? "bg-brand text-surface" : "text-ink",
              )}
            >
              {dayOfMonth(day)}
            </span>
          </>
        ),
        blocks: byDay.get(day) ?? [],
      };
    });
    return { columns: built, hours: visibleHoursFor(segments) };
  }, [items, date, today, timeZone]);

  return (
    <TimeGrid
      columns={columns}
      hours={hours}
      timeZone={timeZone}
      now={now}
      label={`Week of ${rangeHeading("week", date)}, scrolls sideways on a narrow screen`}
      onOpen={onOpen}
    />
  );
}
