import { describe, expect, it } from "vitest";

import {
  agendaDayLabel,
  dayOfMonth,
  dayOfWeek,
  longDateLabel,
  rangeHeading,
  shortWeekdayName,
  spanPhrase,
  stepDate,
  weekdayName,
  weekDays,
  weekRange,
  weekStart,
} from "./dates";

describe("dayOfWeek", () => {
  it("reads the weekday of a calendar date", () => {
    expect(dayOfWeek("2026-03-01")).toBe(0); // Sunday
    expect(dayOfWeek("2026-03-02")).toBe(1); // Monday
    expect(dayOfWeek("2026-03-07")).toBe(6); // Saturday
    expect(weekdayName("2026-03-03")).toBe("Tuesday");
    expect(shortWeekdayName("2026-03-03")).toBe("Tue");
  });

  it("refuses a date that does not exist", () => {
    expect(() => dayOfWeek("2026-02-30")).toThrow(RangeError);
    expect(() => dayOfWeek("nope")).toThrow(RangeError);
  });
});

describe("the week (D-107: Monday to Sunday)", () => {
  it("starts on the Monday on or before the date", () => {
    expect(weekStart("2026-03-02")).toBe("2026-03-02"); // a Monday
    expect(weekStart("2026-03-04")).toBe("2026-03-02"); // a Wednesday
    expect(weekStart("2026-03-08")).toBe("2026-03-02"); // the Sunday ends the week, it does not start one
    expect(weekStart("2026-03-09")).toBe("2026-03-09");
  });

  it("holds seven days, Monday first", () => {
    expect(weekDays("2026-03-05")).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(weekRange("2026-03-05")).toEqual({ from: "2026-03-02", to: "2026-03-08" });
  });

  it("is seven days in the week the clocks go forward (8 March 2026) and back (1 November 2026)", () => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      const days = weekDays(date);
      expect(days).toHaveLength(7);
      expect(new Set(days).size).toBe(7);
    }
    expect(weekDays("2026-03-08")[6]).toBe("2026-03-08");
    expect(weekDays("2026-11-01")[6]).toBe("2026-11-01");
  });

  it("crosses a month and a year", () => {
    expect(weekRange("2026-03-31")).toEqual({ from: "2026-03-30", to: "2026-04-05" });
    expect(weekRange("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(weekRange("2028-02-29")).toEqual({ from: "2028-02-28", to: "2028-03-05" });
  });
});

describe("stepDate", () => {
  it("moves a week in the week and agenda views and a day in the day view", () => {
    expect(stepDate("2026-03-04", "week", 1)).toBe("2026-03-11");
    expect(stepDate("2026-03-04", "week", -1)).toBe("2026-02-25");
    expect(stepDate("2026-03-04", "agenda", 1)).toBe("2026-03-11");
    expect(stepDate("2026-03-04", "day", 1)).toBe("2026-03-05");
    expect(stepDate("2026-03-01", "day", -1)).toBe("2026-02-28");
  });

  it("counts a day on which the clocks change as one day", () => {
    expect(stepDate("2026-03-08", "day", 1)).toBe("2026-03-09");
    expect(stepDate("2026-11-01", "day", 1)).toBe("2026-11-02");
    expect(stepDate("2026-03-04", "week", 1)).toBe("2026-03-11");
  });
});

describe("labels", () => {
  it("writes days", () => {
    expect(dayOfMonth("2026-03-03")).toBe("3");
    expect(longDateLabel("2026-03-03")).toBe("Tuesday, March 3, 2026");
    expect(agendaDayLabel("2026-03-03")).toBe("Tuesday, Mar 3");
  });

  it("writes the visible range as a heading", () => {
    expect(rangeHeading("week", "2026-03-04")).toBe("Mar 2 – 8, 2026");
    expect(rangeHeading("agenda", "2026-03-04")).toBe("Mar 2 – 8, 2026");
    expect(rangeHeading("week", "2026-03-31")).toBe("Mar 30 – Apr 5, 2026");
    expect(rangeHeading("week", "2026-12-31")).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(rangeHeading("day", "2026-03-03")).toBe("Tuesday, March 3, 2026");
  });

  it("names the span an empty calendar is empty for", () => {
    expect(spanPhrase("week", "2026-03-04", "2026-03-06")).toBe("this week");
    expect(spanPhrase("week", "2026-03-11", "2026-03-06")).toBe("the week of Mar 9");
    expect(spanPhrase("day", "2026-03-06", "2026-03-06")).toBe("today");
    expect(spanPhrase("day", "2026-03-07", "2026-03-06")).toBe("on Saturday, March 7, 2026");
  });
});
