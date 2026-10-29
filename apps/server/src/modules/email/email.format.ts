/**
 * Display formatting for email copy: money, dates and appointment windows in the business time zone
 * (BR-17). Text is assembled from `Intl` parts so the output is the same on every Node version
 * (recent ICU puts a narrow no-break space before "PM", which mail clients render inconsistently).
 */

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `"1284.50"`, `"USD"` → `"$1,284.50"`. The string is read as an exact decimal; no float is involved. */
export function formatEmailMoney(amount: string, currencyCode: string): string {
  if (!DECIMAL_STRING.test(amount)) {
    throw new RangeError("Expected a decimal string such as 1284.50.");
  }
  if (!CURRENCY_CODE.test(currencyCode)) {
    throw new RangeError("Expected an ISO 4217 currency code such as USD.");
  }
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode });
  // `format` accepts exact decimal strings; its typings only admit this template type.
  return formatter.format(amount as `${number}`);
}

/** `"2026-11-10"` → `"Nov 10, 2026"`. A date-only value has no time zone, so it is shown as written. */
export function formatEmailDate(dateOnly: string): string {
  const match = DATE_ONLY.exec(dateOnly);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    match === null ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError("Expected a real calendar date such as 2026-11-10.");
  }
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

interface WallClock {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  zoneName: string;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Expected a valid date and time.");
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZoneName: "short",
    }).formatToParts(instant);
  } catch {
    throw new RangeError("Expected an IANA time zone such as America/New_York.");
  }
  const text = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: text("weekday"),
    year: Number(text("year")),
    month: Number(text("month")),
    day: Number(text("day")),
    hour: Number(text("hour")) % 24,
    minute: Number(text("minute")),
    zoneName: text("timeZoneName"),
  };
}

function clock({ hour, minute }: Pick<WallClock, "hour" | "minute">, meridiem = true): string {
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
  return meridiem ? `${time} ${hour < 12 ? "AM" : "PM"}` : time;
}

function dayText({ weekday, month, day, year }: WallClock): string {
  return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}`;
}

/** `Tue, Nov 10, 2026, 9:00 AM EST` in the business time zone. */
export function formatEmailDateTime(instant: Date, timeZone: string): string {
  const at = wallClock(instant, timeZone);
  return `${dayText(at)}, ${clock(at)} ${at.zoneName}`;
}

/**
 * An appointment window in the business time zone: `Tue, Nov 10, 2026, 9:00 – 11:00 AM EST`, or
 * both ends in full when it crosses midnight.
 */
export function formatEmailWindow(start: Date, end: Date, timeZone: string): string {
  const from = wallClock(start, timeZone);
  const to = wallClock(end, timeZone);
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    const sameHalf = from.hour < 12 === to.hour < 12;
    return `${dayText(from)}, ${clock(from, !sameHalf)} – ${clock(to)} ${to.zoneName}`;
  }
  return `${dayText(from)}, ${clock(from)} – ${dayText(to)}, ${clock(to)} ${to.zoneName}`;
}
