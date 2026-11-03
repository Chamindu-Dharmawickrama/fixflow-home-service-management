import { describe, expect, it } from "vitest";

import {
  businessDayBounds,
  instantToWallClock,
  isTimeOfDay,
  wallClockToInstant,
} from "./business-time.js";
import * as shared from "./index.js";

const NEW_YORK = "America/New_York";

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

describe("isTimeOfDay", () => {
  it.each(["00:00", "09:05", "12:00", "23:59"])("accepts %s", (value) => {
    expect(isTimeOfDay(value)).toBe(true);
  });

  it.each(["", "9:05", "24:00", "12:60", "12:5", "12:00:00", "noon", "1200"])(
    "refuses %j",
    (value) => {
      expect(isTimeOfDay(value)).toBe(false);
    },
  );
});

describe("wallClockToInstant", () => {
  it("reads the business's clocks, not the machine's: winter in New York is UTC-5", () => {
    expect(iso(wallClockToInstant("2026-03-03", "10:00", NEW_YORK))).toBe(
      "2026-03-03T15:00:00.000Z",
    );
  });

  it("reads summer time as UTC-4", () => {
    expect(iso(wallClockToInstant("2026-07-14", "10:00", NEW_YORK))).toBe(
      "2026-07-14T14:00:00.000Z",
    );
  });

  it("is right on the morning the clocks go forward (8 March 2026), after the change", () => {
    expect(iso(wallClockToInstant("2026-03-08", "03:30", NEW_YORK))).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(iso(wallClockToInstant("2026-03-08", "09:00", NEW_YORK))).toBe(
      "2026-03-08T13:00:00.000Z",
    );
  });

  it("is right before the change on that day", () => {
    expect(iso(wallClockToInstant("2026-03-08", "01:30", NEW_YORK))).toBe(
      "2026-03-08T06:30:00.000Z",
    );
  });

  it("has no instant for a time the clocks skip", () => {
    expect(wallClockToInstant("2026-03-08", "02:00", NEW_YORK)).toBeNull();
    expect(wallClockToInstant("2026-03-08", "02:30", NEW_YORK)).toBeNull();
    expect(wallClockToInstant("2026-03-08", "02:59", NEW_YORK)).toBeNull();
  });

  it("takes the first of the two times the clocks repeat (1 November 2026)", () => {
    // 01:30 happens in EDT (05:30Z) and again in EST (06:30Z): the first one.
    expect(iso(wallClockToInstant("2026-11-01", "01:30", NEW_YORK))).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("is right after the clocks go back", () => {
    expect(iso(wallClockToInstant("2026-11-01", "08:00", NEW_YORK))).toBe(
      "2026-11-01T13:00:00.000Z",
    );
  });

  it("works for zones ahead of UTC, including half-hour offsets", () => {
    expect(iso(wallClockToInstant("2026-03-03", "10:00", "Asia/Kolkata"))).toBe(
      "2026-03-03T04:30:00.000Z",
    );
    expect(iso(wallClockToInstant("2026-03-03", "10:00", "Pacific/Auckland"))).toBe(
      "2026-03-02T21:00:00.000Z",
    );
    expect(iso(wallClockToInstant("2026-03-03", "10:00", "Pacific/Kiritimati"))).toBe(
      "2026-03-02T20:00:00.000Z",
    );
  });

  it("works for UTC itself", () => {
    expect(iso(wallClockToInstant("2026-03-03", "10:00", "UTC"))).toBe("2026-03-03T10:00:00.000Z");
  });

  it("works at the ends of the day", () => {
    expect(iso(wallClockToInstant("2026-03-03", "00:00", NEW_YORK))).toBe(
      "2026-03-03T05:00:00.000Z",
    );
    expect(iso(wallClockToInstant("2026-03-03", "23:59", NEW_YORK))).toBe(
      "2026-03-04T04:59:00.000Z",
    );
  });

  it.each([
    ["2026-02-30", "10:00"],
    ["2026-3-3", "10:00"],
    ["", "10:00"],
    ["2026-03-03", "25:00"],
    ["2026-03-03", "10:7"],
    ["2026-03-03", ""],
  ])("gives null for %s %s, which is not a date and time", (date, time) => {
    expect(wallClockToInstant(date, time, NEW_YORK)).toBeNull();
  });
});

describe("instantToWallClock", () => {
  it("is the inverse of wallClockToInstant for every ordinary time", () => {
    for (const zone of [NEW_YORK, "Asia/Kolkata", "Pacific/Auckland", "UTC", "Europe/London"]) {
      for (const [date, time] of [
        ["2026-01-15", "00:00"],
        ["2026-03-03", "10:00"],
        ["2026-07-14", "17:45"],
        ["2026-12-31", "23:59"],
      ] as const) {
        const instant = wallClockToInstant(date, time, zone);
        expect(instant).not.toBeNull();
        expect(instantToWallClock(instant as Date, zone)).toEqual({ date, time });
      }
    }
  });

  it("reads a UTC instant on the business's clocks, across midnight", () => {
    expect(instantToWallClock("2026-03-04T03:30:00.000Z", NEW_YORK)).toEqual({
      date: "2026-03-03",
      time: "22:30",
    });
  });

  it("writes midnight as 00:00, never 24:00", () => {
    expect(instantToWallClock("2026-03-03T05:00:00.000Z", NEW_YORK)).toEqual({
      date: "2026-03-03",
      time: "00:00",
    });
  });

  it("follows the change of the clocks", () => {
    expect(instantToWallClock("2026-11-01T05:30:00.000Z", NEW_YORK).time).toBe("01:30");
    expect(instantToWallClock("2026-11-01T06:30:00.000Z", NEW_YORK).time).toBe("01:30");
    expect(instantToWallClock("2026-11-01T07:30:00.000Z", NEW_YORK).time).toBe("02:30");
  });

  it("refuses something that is not a time", () => {
    expect(() => instantToWallClock("tomorrow", NEW_YORK)).toThrow(RangeError);
  });
});

describe("businessDayBounds", () => {
  it("runs from midnight to the next midnight on the business's clocks", () => {
    const { start, end } = businessDayBounds("2026-03-03", NEW_YORK);
    expect(start.toISOString()).toBe("2026-03-03T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-04T05:00:00.000Z");
  });

  it("is 23 hours on the day the clocks go forward and 25 on the day they go back", () => {
    const short = businessDayBounds("2026-03-08", NEW_YORK);
    expect((short.end.getTime() - short.start.getTime()) / 3_600_000).toBe(23);
    const long = businessDayBounds("2026-11-01", NEW_YORK);
    expect((long.end.getTime() - long.start.getTime()) / 3_600_000).toBe(25);
  });

  it("crosses a month and a year end", () => {
    expect(businessDayBounds("2026-12-31", "UTC").end.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(businessDayBounds("2026-02-28", "UTC").end.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("the package entry point", () => {
  it("re-exports the time helpers", () => {
    expect(shared.wallClockToInstant).toBe(wallClockToInstant);
    expect(shared.instantToWallClock).toBe(instantToWallClock);
  });
});
