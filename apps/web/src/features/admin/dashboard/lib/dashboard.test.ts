import { describe, expect, it } from "vitest";

import {
  ATTENTION_TONES,
  DASHBOARD_PATH,
  firstName,
  greetingFor,
  parseDashboardRange,
  PERIOD_CONTEXT,
  RANGE_OPTIONS,
  rangeHref,
} from "./dashboard";

describe("parseDashboardRange", () => {
  it("defaults to 7 days", () => {
    expect(parseDashboardRange({})).toBe("7d");
  });

  it("reads each range", () => {
    expect(parseDashboardRange({ range: "today" })).toBe("today");
    expect(parseDashboardRange({ range: "7d" })).toBe("7d");
    expect(parseDashboardRange({ range: "30d" })).toBe("30d");
  });

  it("falls back to the default for anything else, and takes the first of a repeated parameter", () => {
    expect(parseDashboardRange({ range: "year" })).toBe("7d");
    expect(parseDashboardRange({ range: "" })).toBe("7d");
    expect(parseDashboardRange({ range: ["30d", "today"] })).toBe("30d");
  });
});

describe("rangeHref and the options", () => {
  it("gives the default range the clean address", () => {
    expect(rangeHref("7d")).toBe(DASHBOARD_PATH);
    expect(rangeHref("today")).toBe("/app/dashboard?range=today");
    expect(rangeHref("30d")).toBe("/app/dashboard?range=30d");
  });

  it("offers Today, 7 days and 30 days, in that order", () => {
    expect(RANGE_OPTIONS.map((option) => option.label)).toEqual(["Today", "7 days", "30 days"]);
    expect(PERIOD_CONTEXT).toEqual({
      today: "Today",
      "7d": "Last 7 days",
      "30d": "Last 30 days",
    });
  });
});

describe("greetingFor: the business's time of day, not the browser's", () => {
  it.each([
    ["2026-03-05T05:00:00Z", "Good morning"], // 00:00 in New York
    ["2026-03-05T16:59:00Z", "Good morning"], // 11:59
    ["2026-03-05T17:00:00Z", "Good afternoon"], // 12:00
    ["2026-03-05T21:59:00Z", "Good afternoon"], // 16:59
    ["2026-03-05T22:00:00Z", "Good evening"], // 17:00
    ["2026-03-06T04:59:00Z", "Good evening"], // 23:59
  ])("%s in New York reads %s", (instant, text) => {
    expect(greetingFor(instant, "America/New_York")).toBe(text);
  });

  it("follows the zone: the same instant is morning in Tokyo and evening in Los Angeles", () => {
    // 23:00 UTC is 08:00 the next day in Tokyo and 15:00 in Los Angeles; 03:00 UTC is 12:00 in Tokyo.
    expect(greetingFor("2026-03-05T23:00:00Z", "Asia/Tokyo")).toBe("Good morning");
    expect(greetingFor("2026-03-05T03:00:00Z", "Asia/Tokyo")).toBe("Good afternoon");
    expect(greetingFor("2026-03-06T02:00:00Z", "America/Los_Angeles")).toBe("Good evening");
  });

  it("uses the clocks that apply on the day, daylight saving included", () => {
    // 8 March 2026 is the day New York goes forward: 07:30 UTC is 03:30 EDT, still morning.
    expect(greetingFor("2026-03-08T07:30:00Z", "America/New_York")).toBe("Good morning");
    // 21:00 UTC on 9 March is 17:00 EDT: evening (it would be 16:00, afternoon, in winter time).
    expect(greetingFor("2026-03-09T21:00:00Z", "America/New_York")).toBe("Good evening");
  });
});

describe("firstName", () => {
  it("takes the first word of a name", () => {
    expect(firstName("Morgan Reyes")).toBe("Morgan");
    expect(firstName("  Morgan   Reyes  ")).toBe("Morgan");
    expect(firstName("Cher")).toBe("Cher");
  });

  it("says there for a blank or missing name", () => {
    expect(firstName("")).toBe("there");
    expect(firstName("   ")).toBe("there");
    expect(firstName(null)).toBe("there");
    expect(firstName(undefined)).toBe("there");
  });
});

describe("ATTENTION_TONES", () => {
  it("marks overdue money as danger", () => {
    expect(ATTENTION_TONES.OVERDUE_INVOICE).toBe("danger");
  });
});
