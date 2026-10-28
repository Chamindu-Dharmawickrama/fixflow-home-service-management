import { FORMAT_LOCALE } from "./locale";

/*
 * Date and time formatting in an explicit IANA time zone.
 *
 * The conversion uses `Intl.DateTimeFormat#formatToParts`, which reads the platform's time zone
 * database (so daylight saving time is always right), and the text is assembled here from the
 * numeric parts. Two reasons for not using `Intl`'s own formatted strings or `@date-fns/tz`:
 *
 * - Recent ICU versions put a narrow no-break space (U+202F) before "PM"; building the text
 *   ourselves keeps the output identical on every server and browser, so hydration never differs.
 * - `TZDate` calls `new Date()` with no argument in its constructor, which Next.js Cache
 *   Components rejects while prerendering a server component (the value would be frozen into the
 *   static shell). Nothing here reads the current time: callers pass `now` (see D-62).
 */

/** A date-only field such as an invoice due date: `YYYY-MM-DD`, no time and no time zone. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An ISO 8601 instant with an explicit offset, as the API sends them (`2026-10-28T15:30:00.000Z`). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 instant, or a date-only string for the functions that accept one. */
export type IsoInput = string;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MS_PER_DAY = 86_400_000;

interface WallClock {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(FORMAT_LOCALE, {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      });
    } catch {
      throw new RangeError(`"${timeZone}" is not a valid IANA time zone.`);
    }
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function parseInstant(value: string): number {
  const milliseconds = INSTANT.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(milliseconds)) {
    throw new RangeError(`Expected an ISO 8601 date-time with an offset, received "${value}".`);
  }
  return milliseconds;
}

function wallClock(milliseconds: number, timeZone: string): WallClock {
  const parts = partFormatter(timeZone).formatToParts(milliseconds);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** The number of the calendar day (days since 1970-01-01) of a wall-clock date. */
function dayNumber({ year, month, day }: Pick<WallClock, "year" | "month" | "day">): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function dateOnlyParts(value: string): Pick<WallClock, "year" | "month" | "day"> | null {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`"${value}" is not a real calendar date.`);
  }
  return { year, month, day };
}

function dateText({ year, month, day }: Pick<WallClock, "year" | "month" | "day">): string {
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function clockText(
  { hour, minute }: Pick<WallClock, "hour" | "minute">,
  withMeridiem = true,
): string {
  const clock = `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
  return withMeridiem ? `${clock} ${hour < 12 ? "AM" : "PM"}` : clock;
}

/**
 * `"Oct 28, 2026"`. An ISO instant is shown on the calendar day it falls on in `timeZone` (the
 * business time zone). A date-only value (`2026-10-28`) is shown as written; the time zone does not
 * apply to it.
 */
export function formatDate(value: IsoInput, timeZone: string): string {
  const dateOnly = dateOnlyParts(value);
  return dateText(dateOnly ?? wallClock(parseInstant(value), timeZone));
}

/** `"Oct 28, 2026, 3:30 PM"` in `timeZone`. */
export function formatDateTime(value: IsoInput, timeZone: string): string {
  const clock = wallClock(parseInstant(value), timeZone);
  return `${dateText(clock)}, ${clockText(clock)}`;
}

/** `"3:30 PM"` in `timeZone`. */
export function formatTime(value: IsoInput, timeZone: string): string {
  return clockText(wallClock(parseInstant(value), timeZone));
}

/**
 * The short zone name at that instant, for example `"EDT"` or `"EST"`. It reflects daylight saving
 * time on the given date.
 */
export function formatTimeZoneName(value: IsoInput, timeZone: string): string {
  const milliseconds = parseInstant(value);
  partFormatter(timeZone); // validates the zone name
  const parts = new Intl.DateTimeFormat(FORMAT_LOCALE, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(milliseconds);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * An appointment window in `timeZone`.
 *
 * - same day, same half of the day: `"9:00 – 11:00 AM"`
 * - same day: `"11:00 AM – 1:00 PM"`
 * - across midnight: `"Oct 28, 11:00 PM – Oct 29, 1:00 AM"` (the year is added when it differs)
 */
export function formatTimeRange(start: IsoInput, end: IsoInput, timeZone: string): string {
  const from = wallClock(parseInstant(start), timeZone);
  const to = wallClock(parseInstant(end), timeZone);

  if (dayNumber(from) === dayNumber(to)) {
    const sameHalf = from.hour < 12 === to.hour < 12;
    return `${clockText(from, !sameHalf)} – ${clockText(to)}`;
  }

  const stamp = (clock: WallClock, withYear: boolean) =>
    `${MONTHS[clock.month - 1]} ${clock.day}${withYear ? `, ${clock.year}` : ""}, ${clockText(clock)}`;
  const withYear = from.year !== to.year;
  return `${stamp(from, withYear)} – ${stamp(to, withYear)}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * A human phrase for how far `value` is from `now`, with calendar days counted in `timeZone`:
 * `"just now"`, `"12 minutes ago"`, `"in 3 hours"`, `"Yesterday at 9:00 AM"`, `"in 4 days"`, and
 * the plain date beyond a week. `now` is a parameter so output is deterministic (inject a `Clock`).
 */
export function formatRelative(value: IsoInput, now: Date | string, timeZone: string): string {
  const targetMs = parseInstant(value);
  const nowMs = typeof now === "string" ? parseInstant(now) : now.getTime();
  const target = wallClock(targetMs, timeZone);
  const reference = wallClock(nowMs, timeZone);

  const diffMs = targetMs - nowMs;
  const future = diffMs > 0;
  const absMs = Math.abs(diffMs);
  const phrase = (amount: string) => (future ? `in ${amount}` : `${amount} ago`);

  if (absMs < 45_000) {
    return "just now";
  }
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 60) {
    return phrase(plural(Math.max(minutes, 1), "minute"));
  }

  const dayDifference = dayNumber(target) - dayNumber(reference);
  if (dayDifference === 0) {
    return phrase(plural(Math.round(absMs / 3_600_000), "hour"));
  }
  if (dayDifference === -1) {
    return `Yesterday at ${clockText(target)}`;
  }
  if (dayDifference === 1) {
    return `Tomorrow at ${clockText(target)}`;
  }
  if (Math.abs(dayDifference) <= 6) {
    return phrase(plural(Math.abs(dayDifference), "day"));
  }
  return dateText(target);
}
