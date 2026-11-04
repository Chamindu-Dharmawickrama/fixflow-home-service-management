import { LIMITS } from "./limits.js";

/**
 * Calendar-date rules for things the customer picks as a day (the preferred date of a request).
 * A "date-only" value is `YYYY-MM-DD` with no time and no time zone; what "today" is depends on the
 * business time zone, never on the browser's or the server's (BR-17). Everything here is pure and
 * built on `Intl`, so the web form and the API run the very same functions.
 */

/** A date-only value: four-digit year, two-digit month and day. Whether it exists is `isDateOnly`'s job. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): { year: number; month: number; day: number } | undefined {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return undefined;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // `Date.UTC` rolls 31 February into March; a real date survives the round trip unchanged.
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? { year, month, day } : undefined;
}

/** True for a date that exists on the calendar, written `YYYY-MM-DD` (`2026-02-30` is not). */
export function isDateOnly(value: string): boolean {
  return parseDateOnly(value) !== undefined;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** The calendar date that `instant` falls on in `timeZone` (an IANA name), as `YYYY-MM-DD`. */
export function dateOnlyInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day"): string => {
    const found = parts.find((candidate) => candidate.type === type)?.value;
    if (found === undefined) {
      throw new Error(`Cannot read the ${type} of a date in the time zone "${timeZone}".`);
    }
    return found;
  };
  return `${pad(Number(part("year")), 4)}-${part("month")}-${part("day")}`;
}

/**
 * Moves a date-only value by whole calendar days. This is calendar arithmetic, not "24 hours": a
 * day on which the clocks change still counts as one day.
 */
export function addDaysToDateOnly(value: string, days: number): string {
  const parsed = parseDateOnly(value);
  if (parsed === undefined) {
    throw new RangeError(`"${value}" is not a date written YYYY-MM-DD.`);
  }
  const moved = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

/**
 * How many calendar days `to` is after `from` (negative when it is before): `2026-03-02` to
 * `2026-03-08` is 6. Calendar arithmetic, like {@link addDaysToDateOnly}, so a day on which the
 * clocks change is still one day.
 */
export function daysBetweenDateOnly(from: string, to: string): number {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (a === undefined || b === undefined) {
    throw new RangeError(`"${a === undefined ? from : to}" is not a date written YYYY-MM-DD.`);
  }
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

export interface DateRange {
  /** The earliest date allowed, inclusive. */
  min: string;
  /** The latest date allowed, inclusive. */
  max: string;
}

/**
 * The days a customer may ask for (D-35): from tomorrow to 90 days from today, inclusive, where
 * "today" is the business's own calendar day at `now`. A request made at 9 pm in New York is
 * already "tomorrow" in UTC, which must not shift the range.
 */
export function preferredDateRange(now: Date, timeZone: string): DateRange {
  const today = dateOnlyInTimeZone(now, timeZone);
  const { minDaysAhead, maxDaysAhead } = LIMITS.preferredDate;
  return {
    min: addDaysToDateOnly(today, minDaysAhead),
    max: addDaysToDateOnly(today, maxDaysAhead),
  };
}

export const PREFERRED_DATE_TOO_SOON_MESSAGE = "Choose a date from tomorrow onwards.";
export const PREFERRED_DATE_TOO_LATE_MESSAGE = `Choose a date within the next ${LIMITS.preferredDate.maxDaysAhead} days.`;
export const PREFERRED_DATE_INVALID_MESSAGE = "Choose a date.";

/**
 * Why a preferred date cannot be used, written for the person who picked it, or `null` when it is
 * fine. The server calls it with its own clock and is the authority; the form calls it to save a
 * round trip.
 */
export function preferredDateProblem(value: string, now: Date, timeZone: string): string | null {
  if (!isDateOnly(value)) {
    return PREFERRED_DATE_INVALID_MESSAGE;
  }
  const { min, max } = preferredDateRange(now, timeZone);
  // Date-only strings of the same shape compare correctly as text.
  if (value < min) {
    return PREFERRED_DATE_TOO_SOON_MESSAGE;
  }
  if (value > max) {
    return PREFERRED_DATE_TOO_LATE_MESSAGE;
  }
  return null;
}
