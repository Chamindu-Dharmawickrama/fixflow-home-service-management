import { describe, expect, it } from "vitest";

import { calendarApiRoute, calendarHref, parseCalendarQuery } from "./calendar-url";

const TODAY = "2026-03-04";
const TECHNICIAN = "11111111-1111-4111-8111-111111111111";

describe("parseCalendarQuery", () => {
  it("falls back to today and leaves the view to the window when the address says nothing", () => {
    expect(parseCalendarQuery({}, TODAY)).toEqual({
      view: null,
      date: TODAY,
      technicianId: null,
      split: false,
    });
  });

  it("reads the view, the date and the technician", () => {
    expect(
      parseCalendarQuery(
        { view: "day", date: "2026-03-10", technician: TECHNICIAN, split: "1" },
        TODAY,
      ),
    ).toEqual({ view: "day", date: "2026-03-10", technicianId: TECHNICIAN, split: true });
  });

  it.each(["month", "WEEK", "", "agenda,day"])("ignores the unknown view %j", (view) => {
    expect(parseCalendarQuery({ view }, TODAY).view).toBeNull();
  });

  it.each(["2026-02-30", "tomorrow", "2026-3-4", "2026-03-04T10:00:00Z", ""])(
    "uses today for the impossible date %j",
    (date) => {
      expect(parseCalendarQuery({ date }, TODAY).date).toBe(TODAY);
    },
  );

  it.each(["jordan", "123", "", "11111111-1111-4111-8111-11111111111"])(
    "means everyone for a technician that is not an id (%j)",
    (technician) => {
      expect(parseCalendarQuery({ technician }, TODAY).technicianId).toBeNull();
    },
  );

  it("takes the first of a repeated parameter", () => {
    expect(
      parseCalendarQuery({ view: ["week", "day"], date: ["2026-03-10", "x"] }, TODAY),
    ).toMatchObject({
      view: "week",
      date: "2026-03-10",
    });
  });
});

describe("calendarHref", () => {
  it("leaves out what is at its default", () => {
    expect(calendarHref({ view: null, date: null, technicianId: null, split: false })).toBe(
      "/app/calendar",
    );
  });

  it("writes what was chosen", () => {
    expect(
      calendarHref({ view: "agenda", date: "2026-03-10", technicianId: TECHNICIAN, split: true }),
    ).toBe(`/app/calendar?view=agenda&date=2026-03-10&technician=${TECHNICIAN}&split=1`);
  });

  it("round-trips through the parser", () => {
    const state = {
      view: "day" as const,
      date: "2026-03-10",
      technicianId: TECHNICIAN,
      split: true,
    };
    const url = new URL(calendarHref(state), "http://localhost");
    expect(parseCalendarQuery(Object.fromEntries(url.searchParams), TODAY)).toEqual(state);
  });
});

describe("calendarApiRoute", () => {
  it("asks for the whole week that holds the date, once for every view", () => {
    expect(calendarApiRoute("2026-03-04", null)).toBe(
      "/admin/calendar?from=2026-03-02&to=2026-03-08",
    );
    expect(calendarApiRoute("2026-03-08", null)).toBe(
      "/admin/calendar?from=2026-03-02&to=2026-03-08",
    );
    expect(calendarApiRoute("2026-03-09", null)).toBe(
      "/admin/calendar?from=2026-03-09&to=2026-03-15",
    );
  });

  it("adds the technician", () => {
    expect(calendarApiRoute("2026-03-04", TECHNICIAN)).toBe(
      `/admin/calendar?from=2026-03-02&to=2026-03-08&technicianId=${TECHNICIAN}`,
    );
  });
});
