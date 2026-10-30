import { describe, expect, it } from "vitest";

import { toDateOnly } from "./date-only.js";

describe("toDateOnly", () => {
  it("writes the stored day as YYYY-MM-DD", () => {
    expect(toDateOnly(new Date("2026-11-10"))).toBe("2026-11-10");
    expect(toDateOnly(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05");
  });

  it("does not move the day with the machine's time zone", () => {
    // A `date` column is midnight UTC; the late-evening instant is still the same stored day.
    expect(toDateOnly(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-12-31");
  });
});
