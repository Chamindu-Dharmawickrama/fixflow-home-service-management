import { describe, expect, it } from "vitest";

import {
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  isDateOnly,
  PREFERRED_DATE_INVALID_MESSAGE,
  PREFERRED_DATE_TOO_LATE_MESSAGE,
  PREFERRED_DATE_TOO_SOON_MESSAGE,
  preferredDateProblem,
  preferredDateRange,
} from "./business-dates.js";
import * as shared from "./index.js";

const NEW_YORK = "America/New_York";

describe("isDateOnly", () => {
  it.each(["2026-10-30", "2028-02-29", "2026-12-31", "0999-01-01"])("accepts %s", (value) => {
    expect(isDateOnly(value)).toBe(true);
  });

  it.each([
    "",
    "2026-1-1",
    "26-10-30",
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "2027-02-29",
    "2026-04-31",
    "2026-10-30T00:00:00Z",
    " 2026-10-30",
    "2026/10/30",
  ])("rejects %j", (value) => {
    expect(isDateOnly(value)).toBe(false);
  });
});

describe("dateOnlyInTimeZone", () => {
  it("reads the calendar day of the time zone, not of UTC", () => {
    // 02:30 UTC on 31 October is 22:30 on 30 October in New York.
    const instant = new Date("2026-10-31T02:30:00.000Z");

    expect(dateOnlyInTimeZone(instant, "UTC")).toBe("2026-10-31");
    expect(dateOnlyInTimeZone(instant, NEW_YORK)).toBe("2026-10-30");
    // ... and 15:30 on 31 October in Auckland (NZDT, UTC+13).
    expect(dateOnlyInTimeZone(instant, "Pacific/Auckland")).toBe("2026-10-31");
    expect(dateOnlyInTimeZone(new Date("2026-10-31T12:00:00.000Z"), "Pacific/Auckland")).toBe(
      "2026-11-01",
    );
  });

  it("follows the clocks changing, in both directions", () => {
    // Spring forward on 2026-03-08 (02:00 EST becomes 03:00 EDT): 06:59 UTC is still 01:59 EST.
    expect(dateOnlyInTimeZone(new Date("2026-03-08T06:59:59.000Z"), NEW_YORK)).toBe("2026-03-08");
    expect(dateOnlyInTimeZone(new Date("2026-03-08T04:59:59.000Z"), NEW_YORK)).toBe("2026-03-07");
    // Fall back on 2026-11-01: 05:30 UTC is 01:30 EDT, 06:30 UTC is 01:30 EST, same calendar day.
    expect(dateOnlyInTimeZone(new Date("2026-11-01T05:30:00.000Z"), NEW_YORK)).toBe("2026-11-01");
    expect(dateOnlyInTimeZone(new Date("2026-11-01T06:30:00.000Z"), NEW_YORK)).toBe("2026-11-01");
    expect(dateOnlyInTimeZone(new Date("2026-11-01T04:30:00.000Z"), NEW_YORK)).toBe("2026-11-01");
    expect(dateOnlyInTimeZone(new Date("2026-11-01T03:59:59.000Z"), NEW_YORK)).toBe("2026-10-31");
  });

  it("works for a zone with a half-hour offset", () => {
    // India is UTC+5:30: 19:00 UTC is already 00:30 the next day.
    expect(dateOnlyInTimeZone(new Date("2026-10-30T19:00:00.000Z"), "Asia/Kolkata")).toBe(
      "2026-10-31",
    );
  });

  it("rejects a time zone it does not know", () => {
    expect(() => dateOnlyInTimeZone(new Date(), "Mars/Olympus_Mons")).toThrow();
  });
});

describe("addDaysToDateOnly", () => {
  it("moves across month and year ends", () => {
    expect(addDaysToDateOnly("2026-10-30", 1)).toBe("2026-10-31");
    expect(addDaysToDateOnly("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateOnly("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateOnly("2026-10-30", 90)).toBe("2027-01-28");
  });

  it("knows leap years", () => {
    expect(addDaysToDateOnly("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDateOnly("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("counts calendar days, so the day the clocks change is still one day", () => {
    expect(addDaysToDateOnly("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToDateOnly("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysToDateOnly("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateOnly("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("goes backwards and stays put for zero", () => {
    expect(addDaysToDateOnly("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDateOnly("2026-03-01", 0)).toBe("2026-03-01");
  });

  it("refuses a value that is not a real date", () => {
    expect(() => addDaysToDateOnly("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDaysToDateOnly("tomorrow", 1)).toThrow(RangeError);
  });
});

describe("preferredDateRange (D-35: tomorrow to 90 days ahead, business time zone)", () => {
  it("starts tomorrow and ends 90 days from today", () => {
    const now = new Date("2026-10-30T14:00:00.000Z"); // 10:00 in New York

    expect(preferredDateRange(now, NEW_YORK)).toEqual({ min: "2026-10-31", max: "2027-01-28" });
  });

  it("uses the business's calendar day late in the evening, when UTC is already tomorrow", () => {
    const now = new Date("2026-10-31T02:30:00.000Z"); // 22:30 on 30 October in New York

    expect(preferredDateRange(now, NEW_YORK)).toEqual({ min: "2026-10-31", max: "2027-01-28" });
    expect(preferredDateRange(now, "UTC")).toEqual({ min: "2026-11-01", max: "2027-01-29" });
  });

  it("uses the business's calendar day early in the morning, when UTC is still yesterday", () => {
    const now = new Date("2026-10-30T19:00:00.000Z"); // 00:30 on 31 October in Kolkata

    expect(preferredDateRange(now, "Asia/Kolkata")).toEqual({
      min: "2026-11-01",
      max: "2027-01-29",
    });
  });

  it("is a whole 90 calendar days across the autumn change of the clocks", () => {
    const now = new Date("2026-11-01T17:00:00.000Z"); // noon on the day the clocks go back

    expect(preferredDateRange(now, NEW_YORK)).toEqual({ min: "2026-11-02", max: "2027-01-30" });
  });

  it("is a whole 90 calendar days across the spring change of the clocks", () => {
    const now = new Date("2026-03-07T17:00:00.000Z");

    expect(preferredDateRange(now, NEW_YORK)).toEqual({ min: "2026-03-08", max: "2026-06-05" });
  });
});

describe("preferredDateProblem", () => {
  const now = new Date("2026-10-30T14:00:00.000Z"); // Friday 30 October, 10:00 in New York

  it("accepts tomorrow, the last allowed day and anything between", () => {
    expect(preferredDateProblem("2026-10-31", now, NEW_YORK)).toBeNull();
    expect(preferredDateProblem("2026-12-25", now, NEW_YORK)).toBeNull();
    expect(preferredDateProblem("2027-01-28", now, NEW_YORK)).toBeNull();
  });

  it("refuses today and the past", () => {
    expect(preferredDateProblem("2026-10-30", now, NEW_YORK)).toBe(PREFERRED_DATE_TOO_SOON_MESSAGE);
    expect(preferredDateProblem("2026-10-01", now, NEW_YORK)).toBe(PREFERRED_DATE_TOO_SOON_MESSAGE);
    expect(preferredDateProblem("2025-10-31", now, NEW_YORK)).toBe(PREFERRED_DATE_TOO_SOON_MESSAGE);
  });

  it("refuses the day after the last allowed one", () => {
    expect(preferredDateProblem("2027-01-29", now, NEW_YORK)).toBe(PREFERRED_DATE_TOO_LATE_MESSAGE);
    expect(preferredDateProblem("2030-01-01", now, NEW_YORK)).toBe(PREFERRED_DATE_TOO_LATE_MESSAGE);
  });

  it("refuses a date that does not exist or is not written YYYY-MM-DD", () => {
    for (const value of ["", "2026-02-30", "31/10/2026", "2026-10-31T09:00:00Z"]) {
      expect(preferredDateProblem(value, now, NEW_YORK)).toBe(PREFERRED_DATE_INVALID_MESSAGE);
    }
  });

  it("judges 'today' by the business, so the same date can be allowed in one zone and not another", () => {
    const lateEvening = new Date("2026-10-31T02:30:00.000Z"); // 22:30 on 30 October in New York

    expect(preferredDateProblem("2026-10-31", lateEvening, NEW_YORK)).toBeNull();
    expect(preferredDateProblem("2026-10-31", lateEvening, "UTC")).toBe(
      PREFERRED_DATE_TOO_SOON_MESSAGE,
    );
  });

  it("states the limit in its message", () => {
    expect(PREFERRED_DATE_TOO_LATE_MESSAGE).toContain("90 days");
  });
});

describe("package entry point", () => {
  it("re-exports the date helpers", () => {
    expect(shared.preferredDateRange).toBe(preferredDateRange);
    expect(shared.preferredDateProblem).toBe(preferredDateProblem);
    expect(shared.isDateOnly).toBe(isDateOnly);
  });
});
