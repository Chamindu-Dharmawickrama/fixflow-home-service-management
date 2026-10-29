import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import { isSupportedTimeZone, listSupportedTimeZones } from "./time-zones.js";

describe("listSupportedTimeZones", () => {
  it("includes the runtime's IANA zones, UTC, and the demo business zone", () => {
    const zones = listSupportedTimeZones();
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("Europe/London");
    expect(zones).toContain("Asia/Colombo");
    expect(zones).toContain("UTC");
    for (const zone of Intl.supportedValuesOf("timeZone")) {
      expect(zones).toContain(zone);
    }
  });

  it("is sorted, free of duplicates and stable between calls", () => {
    const zones = listSupportedTimeZones();
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort((a, b) => a.localeCompare(b, "en"))).toEqual([...zones]);
    expect(listSupportedTimeZones()).toBe(zones);
  });

  it("only lists zones the runtime can actually format dates in", () => {
    for (const zone of listSupportedTimeZones()) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone }), zone).not.toThrow();
    }
  });
});

describe("isSupportedTimeZone", () => {
  it("accepts a listed zone", () => {
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("Australia/Sydney")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["the wrong case", "america/new_york"],
    ["surrounding spaces", " America/New_York "],
    ["a region without a city", "America"],
    ["an invented city", "America/Atlantis"],
    ["a fixed offset", "+05:30"],
    ["an abbreviation", "EST"],
    ["a script", "<script>alert(1)</script>"],
  ])("rejects %s", (_name, value) => {
    expect(isSupportedTimeZone(value)).toBe(false);
  });

  it("rejects values that are not strings", () => {
    expect(isSupportedTimeZone(undefined)).toBe(false);
    expect(isSupportedTimeZone(null)).toBe(false);
    expect(isSupportedTimeZone(5)).toBe(false);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.isSupportedTimeZone).toBe(isSupportedTimeZone);
    expect(shared.listSupportedTimeZones).toBe(listSupportedTimeZones);
  });
});
