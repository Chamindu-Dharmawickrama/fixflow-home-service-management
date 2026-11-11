import { afterEach, describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatDateWithWeekday,
  formatRelative,
  formatTime,
  formatTimeRange,
  formatTimeZoneName,
  hourInTimeZone,
} from "./datetime";

const NEW_YORK = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
const KOLKATA = "Asia/Kolkata";

describe("formatDate / formatDateTime / formatTime", () => {
  // 2026-10-28T02:30:00Z is still the evening of Oct 27 in New York (EDT, UTC-4).
  const instant = "2026-10-28T02:30:00.000Z";

  it("shows the instant in the business time zone, whatever the machine's zone is", () => {
    expect(formatDate(instant, NEW_YORK)).toBe("Oct 27, 2026");
    expect(formatDateTime(instant, NEW_YORK)).toBe("Oct 27, 2026, 10:30 PM");
    expect(formatTime(instant, NEW_YORK)).toBe("10:30 PM");

    // NZDT is UTC+13: the same instant is already the afternoon of Oct 28.
    expect(formatDate(instant, AUCKLAND)).toBe("Oct 28, 2026");
    expect(formatDateTime(instant, AUCKLAND)).toBe("Oct 28, 2026, 3:30 PM");

    // A half-hour offset (UTC+5:30).
    expect(formatTime(instant, KOLKATA)).toBe("8:00 AM");
    expect(formatTime(instant, "UTC")).toBe("2:30 AM");
  });

  it("formats midnight and noon as 12 AM and 12 PM", () => {
    expect(formatTime("2026-10-28T04:00:00Z", NEW_YORK)).toBe("12:00 AM");
    expect(formatTime("2026-10-28T16:00:00Z", NEW_YORK)).toBe("12:00 PM");
  });

  it("shows a date-only value as written, in any time zone", () => {
    expect(formatDate("2026-10-28", NEW_YORK)).toBe("Oct 28, 2026");
    expect(formatDate("2026-10-28", AUCKLAND)).toBe("Oct 28, 2026");
    expect(formatDate("2026-10-28", "Pacific/Kiritimati")).toBe("Oct 28, 2026");
    expect(formatDate("2026-02-01", NEW_YORK)).toBe("Feb 1, 2026");
  });

  it("rejects values that are not dates", () => {
    expect(() => formatDate("not a date", NEW_YORK)).toThrow(RangeError);
    expect(() => formatDate("2026-02-31", NEW_YORK)).toThrow(RangeError);
    expect(() => formatDateTime("", NEW_YORK)).toThrow(RangeError);
  });

  it("rejects an unknown time zone", () => {
    expect(() => formatDateTime(instant, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("daylight saving time (America/New_York, 2026)", () => {
  it("skips the hour that does not exist on the spring-forward night", () => {
    // 02:00 EST jumps straight to 03:00 EDT on 8 March 2026.
    expect(formatDateTime("2026-03-08T06:59:00Z", NEW_YORK)).toBe("Mar 8, 2026, 1:59 AM");
    expect(formatDateTime("2026-03-08T07:00:00Z", NEW_YORK)).toBe("Mar 8, 2026, 3:00 AM");
    expect(formatTimeZoneName("2026-03-08T06:59:00Z", NEW_YORK)).toBe("EST");
    expect(formatTimeZoneName("2026-03-08T07:00:00Z", NEW_YORK)).toBe("EDT");
  });

  it("repeats the 1 AM hour on the fall-back night, and the zone name tells them apart", () => {
    // 1:30 AM happens twice on 1 November 2026.
    expect(formatDateTime("2026-11-01T05:30:00Z", NEW_YORK)).toBe("Nov 1, 2026, 1:30 AM");
    expect(formatDateTime("2026-11-01T06:30:00Z", NEW_YORK)).toBe("Nov 1, 2026, 1:30 AM");
    expect(formatTimeZoneName("2026-11-01T05:30:00Z", NEW_YORK)).toBe("EDT");
    expect(formatTimeZoneName("2026-11-01T06:30:00Z", NEW_YORK)).toBe("EST");
  });

  it("formats a range across the change by wall-clock time", () => {
    // Two hours of real time, but the clock reads 1:00 AM to 4:00 AM.
    expect(formatTimeRange("2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z", NEW_YORK)).toBe(
      "1:00 – 4:00 AM",
    );
  });
});

describe("independence from the machine's time zone", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it.each(["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Asia/Colombo"])(
    "gives the same text when the process runs in %s",
    (machineZone) => {
      process.env.TZ = machineZone;
      expect(formatDateTime("2026-10-28T02:30:00Z", NEW_YORK)).toBe("Oct 27, 2026, 10:30 PM");
      expect(formatDate("2026-10-28", NEW_YORK)).toBe("Oct 28, 2026");
      expect(formatTimeRange("2026-10-28T13:00:00Z", "2026-10-28T15:00:00Z", NEW_YORK)).toBe(
        "9:00 – 11:00 AM",
      );
    },
  );
});

describe("formatDateWithWeekday and hourInTimeZone (T23)", () => {
  it("writes the weekday with the date, on the business's calendar day", () => {
    expect(formatDateWithWeekday("2026-03-05T15:00:00Z", "America/New_York")).toBe(
      "Thursday, Mar 5, 2026",
    );
    // 04:30 UTC on the 6th is still the evening of Thursday the 5th in New York, and already Friday in Tokyo.
    expect(formatDateWithWeekday("2026-03-06T04:30:00Z", "America/New_York")).toBe(
      "Thursday, Mar 5, 2026",
    );
    expect(formatDateWithWeekday("2026-03-06T04:30:00Z", "Asia/Tokyo")).toBe("Friday, Mar 6, 2026");
  });

  it("writes a date-only value as written", () => {
    expect(formatDateWithWeekday("2026-11-01", "America/New_York")).toBe("Sunday, Nov 1, 2026");
    expect(formatDateWithWeekday("2026-12-31", "Asia/Tokyo")).toBe("Thursday, Dec 31, 2026");
  });

  it("reads the hour of the day on the wall clock of the zone, across a change of the clocks", () => {
    expect(hourInTimeZone("2026-03-05T05:00:00Z", "America/New_York")).toBe(0);
    expect(hourInTimeZone("2026-03-05T04:59:00Z", "America/New_York")).toBe(23);
    // The clocks went forward on 8 March: 07:30 UTC is 03:30 EDT (02:30 does not exist).
    expect(hourInTimeZone("2026-03-08T07:30:00Z", "America/New_York")).toBe(3);
    expect(hourInTimeZone("2026-03-08T00:00:00Z", "Asia/Tokyo")).toBe(9);
  });
});

describe("formatTimeRange", () => {
  it("collapses the meridiem when both ends share it", () => {
    expect(formatTimeRange("2026-10-28T13:00:00Z", "2026-10-28T15:00:00Z", NEW_YORK)).toBe(
      "9:00 – 11:00 AM",
    );
    expect(formatTimeRange("2026-10-28T17:00:00Z", "2026-10-28T19:30:00Z", NEW_YORK)).toBe(
      "1:00 – 3:30 PM",
    );
  });

  it("keeps both meridiems when the range crosses noon", () => {
    expect(formatTimeRange("2026-10-28T15:00:00Z", "2026-10-28T17:00:00Z", NEW_YORK)).toBe(
      "11:00 AM – 1:00 PM",
    );
  });

  it("shows both dates when the range crosses midnight", () => {
    expect(formatTimeRange("2026-10-29T03:00:00Z", "2026-10-29T05:00:00Z", NEW_YORK)).toBe(
      "Oct 28, 11:00 PM – Oct 29, 1:00 AM",
    );
  });

  it("adds the year when the range crosses New Year", () => {
    expect(formatTimeRange("2027-01-01T04:00:00Z", "2027-01-01T06:00:00Z", NEW_YORK)).toBe(
      "Dec 31, 2026, 11:00 PM – Jan 1, 2027, 1:00 AM",
    );
  });
});

describe("formatRelative", () => {
  // 11:00 AM on Wednesday 28 October 2026 in New York.
  const now = new Date("2026-10-28T15:00:00Z");

  it("describes short distances in minutes and hours", () => {
    expect(formatRelative("2026-10-28T14:59:40Z", now, NEW_YORK)).toBe("just now");
    expect(formatRelative("2026-10-28T15:00:20Z", now, NEW_YORK)).toBe("just now");
    expect(formatRelative("2026-10-28T14:59:00Z", now, NEW_YORK)).toBe("1 minute ago");
    expect(formatRelative("2026-10-28T14:48:00Z", now, NEW_YORK)).toBe("12 minutes ago");
    expect(formatRelative("2026-10-28T15:30:00Z", now, NEW_YORK)).toBe("in 30 minutes");
    expect(formatRelative("2026-10-28T12:00:00Z", now, NEW_YORK)).toBe("3 hours ago");
    expect(formatRelative("2026-10-28T16:00:00Z", now, NEW_YORK)).toBe("in 1 hour");
  });

  it("uses calendar days in the business time zone, not 24-hour blocks", () => {
    expect(formatRelative("2026-10-27T13:00:00Z", now, NEW_YORK)).toBe("Yesterday at 9:00 AM");
    expect(formatRelative("2026-10-29T14:00:00Z", now, NEW_YORK)).toBe("Tomorrow at 10:00 AM");

    // 11 PM on Oct 27 → 1 AM on Oct 28 is only two hours, but it is a different calendar day.
    const lateEvening = new Date("2026-10-28T03:00:00Z");
    expect(formatRelative("2026-10-28T05:00:00Z", lateEvening, NEW_YORK)).toBe(
      "Tomorrow at 1:00 AM",
    );
  });

  it("falls back to day counts and then the plain date", () => {
    expect(formatRelative("2026-10-25T15:00:00Z", now, NEW_YORK)).toBe("3 days ago");
    expect(formatRelative("2026-11-01T16:00:00Z", now, NEW_YORK)).toBe("in 4 days");
    expect(formatRelative("2026-11-04T15:00:00Z", now, NEW_YORK)).toBe("Nov 4, 2026");
    expect(formatRelative("2026-09-01T15:00:00Z", now, NEW_YORK)).toBe("Sep 1, 2026");
  });

  it("accepts the current time as an ISO string", () => {
    expect(formatRelative("2026-10-28T14:48:00Z", "2026-10-28T15:00:00Z", NEW_YORK)).toBe(
      "12 minutes ago",
    );
  });
});
