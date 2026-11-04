import { addDaysToDateOnly, isDateOnly } from "@fixflow/shared";

/**
 * Calendar-day arithmetic for the scheduling calendar (T19). Every value here is a date-only string
 * (`YYYY-MM-DD`) on the **business's** calendar; nothing reads the browser's time zone or clock, so
 * the week a screen shows is the same week everywhere (BR-17). It is calendar arithmetic, not
 * "24 hours", so a week in which the clocks change still has seven days.
 */

/**
 * The week starts on **Monday** (D-107): a home-service business plans Monday to Friday, with the
 * weekend at the end of the view, and ISO 8601 weeks start on Monday. `0` is Sunday, as in `Date`.
 */
export const WEEK_STARTS_ON = 1;

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SHORT_MONTH_NAMES = MONTH_NAMES.map((name) => name.slice(0, 3));

function parts(date: string): { year: number; month: number; day: number } {
  if (!isDateOnly(date)) {
    throw new RangeError(`"${date}" is not a date written YYYY-MM-DD.`);
  }
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** The weekday of a calendar date, `0` (Sunday) to `6` (Saturday). */
export function dayOfWeek(date: string): number {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The full weekday name of a calendar date: "Tuesday". */
export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[dayOfWeek(date)] ?? "";
}

/** "Tue". */
export function shortWeekdayName(date: string): string {
  return weekdayName(date).slice(0, 3);
}

/** The first day of the week that holds `date`: the Monday on or before it. */
export function weekStart(date: string): string {
  const behind = (dayOfWeek(date) - WEEK_STARTS_ON + 7) % 7;
  return addDaysToDateOnly(date, -behind);
}

/** The seven days of the week that holds `date`, Monday first. */
export function weekDays(date: string): string[] {
  const first = weekStart(date);
  return Array.from({ length: 7 }, (_, index) => addDaysToDateOnly(first, index));
}

/** The first and last day of the week that holds `date`, both inclusive: what the API is asked for. */
export function weekRange(date: string): { from: string; to: string } {
  const first = weekStart(date);
  return { from: first, to: addDaysToDateOnly(first, 6) };
}

export type CalendarView = "week" | "day" | "agenda";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["week", "day", "agenda"];

export const VIEW_LABELS: Readonly<Record<CalendarView, string>> = {
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};

/**
 * The date one step before or after `date`: a day in the day view, a week in the other two (the
 * agenda lists a week, like the grid). The week view keeps the weekday, so "Previous" from a
 * Wednesday lands on the Wednesday before.
 */
export function stepDate(date: string, view: CalendarView, direction: -1 | 1): string {
  return addDaysToDateOnly(date, (view === "day" ? 1 : 7) * direction);
}

/** The day-of-month, "3". */
export function dayOfMonth(date: string): string {
  return String(parts(date).day);
}

/** "Mar 3". */
export function shortDateLabel(date: string): string {
  const { month, day } = parts(date);
  return `${SHORT_MONTH_NAMES[month - 1] ?? ""} ${String(day)}`;
}

/** "Tuesday, March 3, 2026". */
export function longDateLabel(date: string): string {
  const { year, month, day } = parts(date);
  return `${weekdayName(date)}, ${MONTH_NAMES[month - 1] ?? ""} ${String(day)}, ${String(year)}`;
}

/** "Tuesday, Mar 3": the heading of a day in the agenda. */
export function agendaDayLabel(date: string): string {
  return `${weekdayName(date)}, ${shortDateLabel(date)}`;
}

/**
 * The visible range as a heading: "Mar 2 – 8, 2026" for a week within one month, "Mar 30 – Apr 5,
 * 2026" across months, "Dec 28, 2026 – Jan 3, 2027" across years, and the full date for a day.
 */
export function rangeHeading(view: CalendarView, date: string): string {
  if (view === "day") {
    return longDateLabel(date);
  }
  const { from, to } = weekRange(date);
  const a = parts(from);
  const b = parts(to);
  if (a.year !== b.year) {
    return `${shortDateLabel(from)}, ${String(a.year)} – ${shortDateLabel(to)}, ${String(b.year)}`;
  }
  if (a.month !== b.month) {
    return `${shortDateLabel(from)} – ${shortDateLabel(to)}, ${String(b.year)}`;
  }
  return `${shortDateLabel(from)} – ${String(b.day)}, ${String(b.year)}`;
}

/** What the empty calendar calls the span it is showing: "this week", "today", or the week or day by its date. */
export function spanPhrase(view: CalendarView, date: string, today: string): string {
  if (view === "day") {
    return date === today ? "today" : `on ${longDateLabel(date)}`;
  }
  const { from, to } = weekRange(date);
  return today >= from && today <= to ? "this week" : `the week of ${shortDateLabel(from)}`;
}
