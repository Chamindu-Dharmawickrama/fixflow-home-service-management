import { describe, expect, it } from "vitest";

import { createCalendar, dayOfWeek, quarterHourOf, todaysVisit } from "./showcase-time.js";

const ZONE = "America/New_York";
/** Saturday 14 November 2026, 03:00 in New York (EST). */
const SATURDAY_EARLY = new Date("2026-11-14T08:00:00.000Z");

describe("createCalendar", () => {
  const calendar = createCalendar(SATURDAY_EARLY, ZONE);

  it("counts days on the business's calendar, not in UTC", () => {
    // 08:00 UTC is already the 14th in New York; 23:30 on the 13th in New York is the 14th in UTC.
    expect(calendar.today).toBe("2026-11-14");
    expect(createCalendar(new Date("2026-11-14T04:30:00.000Z"), ZONE).today).toBe("2026-11-13");
    expect(calendar.dateOf(0)).toBe("2026-11-14");
    expect(calendar.dateOf(-3)).toBe("2026-11-11");
    expect(calendar.dateOf(5)).toBe("2026-11-19");
  });

  it("turns a day and a time into the instant on the business's clock, across a clock change", () => {
    // 14 November is standard time (UTC-5); 31 October, two weeks earlier, is still daylight time (UTC-4).
    expect(calendar.instant([0, "08:00"]).toISOString()).toBe("2026-11-14T13:00:00.000Z");
    expect(calendar.instant([-14, "10:00"]).toISOString()).toBe("2026-10-31T14:00:00.000Z");
  });

  it("never places an event of the past later than a minute before now", () => {
    // 08:00 on the 14th is five hours after "now": the event is placed just before now instead.
    expect(calendar.past([0, "08:00"]).toISOString()).toBe("2026-11-14T07:59:00.000Z");
    expect(calendar.past([-1, "10:00"]).toISOString()).toBe("2026-11-13T15:00:00.000Z");
  });

  it("keeps the order of moments that clamp to the same instant", () => {
    const first = calendar.past([0, "07:00"]);
    const second = calendar.past([0, "09:00"]);
    expect(first.getTime()).toBeLessThanOrEqual(second.getTime());
  });

  it("books visits on the next days that are not Sundays", () => {
    // From Saturday: Monday is the first working day, Tuesday the second.
    expect(calendar.workday(1)).toBe(2);
    expect(calendar.workday(2)).toBe(3);
    // From Friday: Saturday counts, Sunday does not.
    const friday = createCalendar(new Date("2026-11-13T15:00:00.000Z"), ZONE);
    expect(friday.workday(1)).toBe(1);
    expect(friday.workday(2)).toBe(3);
  });
});

describe("dayOfWeek", () => {
  it("reads the weekday of a calendar date, whatever the machine's time zone", () => {
    expect(dayOfWeek("2026-11-15")).toBe(0);
    expect(dayOfWeek("2026-11-16")).toBe(1);
    expect(dayOfWeek("2026-11-14")).toBe(6);
  });
});

describe("quarterHourOf", () => {
  it("rounds down to a quarter of an hour on the business's clock", () => {
    expect(quarterHourOf(new Date("2026-11-14T19:27:59.000Z"), ZONE)).toBe("14:15");
    expect(quarterHourOf(new Date("2026-11-14T19:59:00.000Z"), ZONE)).toBe("14:45");
    expect(quarterHourOf(new Date("2026-11-14T05:00:00.000Z"), ZONE)).toBe("00:00");
  });
});

describe("todaysVisit", () => {
  const at = (iso: string) => todaysVisit(createCalendar(new Date(iso), ZONE));

  it("starts the visit in progress about forty minutes before now", () => {
    // 15:00 in New York: forty minutes earlier is 14:20, rounded down to 14:15.
    const visit = at("2026-11-14T20:00:00.000Z");
    expect(visit.start.toISOString()).toBe("2026-11-14T19:15:00.000Z");
  });

  it("lasts two hours", () => {
    const visit = at("2026-11-14T20:00:00.000Z");
    expect(visit.end.getTime() - visit.start.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it("keeps the first visit inside working hours when the seed runs at night or very early", () => {
    // 03:00: too early for a visit, so it opens at 08:00 (13:00 UTC).
    expect(at("2026-11-14T08:00:00.000Z").start.toISOString()).toBe("2026-11-14T13:00:00.000Z");
    // 23:30: too late, so it opens at 15:00 (20:00 UTC) and ends by five in the afternoon.
    const late = at("2026-11-15T04:30:00.000Z");
    expect(late.start.toISOString()).toBe("2026-11-14T20:00:00.000Z");
    expect(late.end.toISOString()).toBe("2026-11-14T22:00:00.000Z");
  });
});
