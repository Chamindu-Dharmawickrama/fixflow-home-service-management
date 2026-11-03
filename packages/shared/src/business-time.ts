import { isDateOnly } from "./business-dates.js";

/**
 * Wall-clock times in the business's time zone (BR-17). A person scheduling a visit types a day and
 * a time of day as they read on the business's clocks ("Tuesday 10:00"); the API takes the UTC
 * instant. These two functions are the only conversion between them, in the web form and in the
 * tests, and they use `Intl` with the zone given explicitly, so the zone of the browser or the
 * server never enters into it (D-104).
 */

/** A time of day, written `HH:mm` on a 24-hour clock. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

export interface WallClock {
  /** The calendar day, `YYYY-MM-DD`. */
  date: string;
  /** The time of day, `HH:mm` (24-hour). */
  time: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The numeric parts of an instant on the wall clock of `timeZone`. */
function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)?.value;
    if (found === undefined) {
      throw new RangeError(`Cannot read the ${type} of a time in the time zone "${timeZone}".`);
    }
    return Number(found);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    // Some engines write midnight as 24 even with `h23`.
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

/** How many minutes `timeZone` is ahead of UTC at `instant` (negative when it is behind). */
function offsetMinutes(instant: number, timeZone: string): number {
  const at = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second);
  return Math.round((asIfUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/**
 * The instant at which the business's clocks read `date` and `time`, or `null` for a time that does
 * not exist or is not valid input.
 *
 * - On the night the clocks go forward, an hour of wall-clock times is skipped (02:30 on 8 March 2026
 *   in New York): there is no instant to name, so the answer is `null` and the form asks for another
 *   time.
 * - On the night they go back, an hour is lived twice (01:30 on 1 November 2026): the first one is
 *   returned, the same choice the clocks themselves make when you say "half past one".
 *
 * Every other time maps to exactly one instant, found from the zone's offsets a day either side so a
 * change of offset on the day itself is honoured.
 */
export function wallClockToInstant(date: string, time: string, timeZone: string): Date | null {
  if (!isDateOnly(date)) {
    return null;
  }
  const match = TIME_OF_DAY_PATTERN.exec(time);
  if (match === null) {
    return null;
  }
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(match[1]),
    Number(match[2]),
  );

  const offsets = new Set([
    offsetMinutes(naive - DAY, timeZone),
    offsetMinutes(naive + DAY, timeZone),
  ]);
  const instants = [...offsets]
    .map((offset) => naive - offset * MINUTE)
    // Keep a candidate only if the zone's clocks really read the time asked for at that instant.
    .filter((instant) => offsetMinutes(instant, timeZone) * MINUTE === naive - instant)
    .sort((a, b) => a - b);

  const first = instants[0];
  return first === undefined ? null : new Date(first);
}

/** The day and time of day that the business's clocks read at `instant`. */
export function instantToWallClock(instant: Date | string, timeZone: string): WallClock {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError("Expected a valid date and time.");
  }
  const at = zonedParts(ms, timeZone);
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return {
    date: `${pad(at.year, 4)}-${pad(at.month, 2)}-${pad(at.day, 2)}`,
    time: `${pad(at.hour, 2)}:${pad(at.minute, 2)}`,
  };
}

/**
 * The first instant of the business day `date` and of the day after it: the bounds of "that day" for
 * a day's appointments. A day whose midnight does not exist (some zones skip it when the clocks go
 * forward) starts at the first time that does.
 */
export function businessDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  const next = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1),
  );
  const nextDate = next.toISOString().slice(0, 10);
  const startOf = (day: string): Date => {
    for (const time of ["00:00", "01:00", "02:00"]) {
      const found = wallClockToInstant(day, time, timeZone);
      if (found !== null) {
        return found;
      }
    }
    throw new RangeError(`Cannot find the start of ${day} in the time zone "${timeZone}".`);
  };
  return { start: startOf(date), end: startOf(nextDate) };
}
