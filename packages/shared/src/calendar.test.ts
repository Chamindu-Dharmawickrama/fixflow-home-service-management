import { describe, expect, it } from "vitest";

import { CALENDAR_RULES } from "./calendar.js";

describe("CALENDAR_RULES", () => {
  it("pins the limits the endpoint and the screens rely on", () => {
    expect(CALENDAR_RULES).toEqual({ maxSpanDays: 42, maxItems: 500, maxNeedsScheduling: 20 });
  });

  it("allows six full weeks, which is what a month grid needs", () => {
    expect(CALENDAR_RULES.maxSpanDays).toBe(6 * 7);
  });
});
