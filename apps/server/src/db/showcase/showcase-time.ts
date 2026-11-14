import { addDaysToDateOnly, dateOnlyInTimeZone, wallClockToInstant } from "@fixflow/shared";

/**
 * Time for the showcase seed (T24). Every date in the showcase is **relative to the moment the seed
 * runs**, counted in the business's calendar, so the demo always looks current: "this week's jobs",
 * "invoice due in three days", "overdue by nineteen days" are true whenever it is reset. Nothing here
 * reads the browser's or the machine's time zone (BR-17).
 */

/** A day and a time on the business's clocks: `[-3, "14:30"]` is half past two, three days ago. */
export type Moment = readonly [dayOffset: number, time: string];

const MINUTE = 60_000;
/** The latest an event of the past may be placed: a minute before the seed started. */
const PAST_MARGIN = 1 * MINUTE;

export interface ShowcaseCalendar {
  /** When the seed started. */
  readonly now: Date;
  readonly timeZone: string;
  /** Today on the business's calendar, `YYYY-MM-DD`. */
  readonly today: string;
  /** The calendar day `dayOffset` days from today, `YYYY-MM-DD` (negative is the past). */
  dateOf(dayOffset: number): string;
  /** The instant of `time` on that day, exactly as written (it may be later than now). */
  instant(moment: Moment): Date;
  /**
   * The instant of an event that has already happened: the written time, but never later than a
   * minute before now, so nothing in the history is dated in the future when the seed runs early in
   * the day. Order is kept: moments that clamp to the same instant stay in the order they were given.
   */
  past(moment: Moment): Date;
  /** The offset of the `n`th day after today that is not a Sunday (`n` ≥ 1): visits are not booked on Sundays. */
  workday(n: number): number;
}

/** `0` is Sunday. Works on the calendar date alone, so it cannot be moved by a time zone. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function createCalendar(now: Date, timeZone: string): ShowcaseCalendar {
  const today = dateOnlyInTimeZone(now, timeZone);
  const dateOf = (dayOffset: number): string => addDaysToDateOnly(today, dayOffset);

  const instant = ([dayOffset, time]: Moment): Date => {
    const found = wallClockToInstant(dateOf(dayOffset), time, timeZone);
    if (found === null) {
      throw new Error(`${dateOf(dayOffset)} ${time} does not exist in ${timeZone}.`);
    }
    return found;
  };

  return {
    now,
    timeZone,
    today,
    dateOf,
    instant,
    past: (moment) => new Date(Math.min(instant(moment).getTime(), now.getTime() - PAST_MARGIN)),
    workday(n) {
      let offset = 0;
      let remaining = n;
      while (remaining > 0) {
        offset += 1;
        if (dayOfWeek(dateOf(offset)) !== 0) {
          remaining -= 1;
        }
      }
      return offset;
    },
  };
}

/** `HH:mm` of an instant on the business's clock, rounded down to a quarter of an hour. */
export function quarterHourOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: "hour" | "minute"): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const minutes = read("hour") * 60 + Math.floor(read("minute") / 15) * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface TodaysVisit {
  /** The visit the technician is on now: it began before the seed ran. */
  start: Date;
  end: Date;
}

const HOUR = 60 * MINUTE;

/**
 * The visit that is in progress today. It began about forty minutes ago, but its start is kept inside
 * working hours (08:00 to 15:00), so a reset in the small hours does not leave a job at three in the
 * morning, and one late in the day does not leave it running into the night.
 */
export function todaysVisit(calendar: ShowcaseCalendar): TodaysVisit {
  const earliest = calendar.instant([0, "08:00"]).getTime();
  const latest = calendar.instant([0, "15:00"]).getTime();
  const wanted = calendar.now.getTime() - 40 * MINUTE;
  const clamped = Math.min(Math.max(wanted, earliest), latest);

  // Round the start down to a quarter of an hour on the business's clock.
  const time = quarterHourOf(new Date(clamped), calendar.timeZone);
  const start = calendar.instant([0, time]);
  return { start, end: new Date(start.getTime() + 2 * HOUR) };
}
