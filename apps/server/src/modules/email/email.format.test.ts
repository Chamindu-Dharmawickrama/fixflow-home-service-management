import { describe, expect, it } from "vitest";

import {
  formatEmailDate,
  formatEmailDateTime,
  formatEmailMoney,
  formatEmailWindow,
} from "./email.format.js";

describe("formatEmailMoney", () => {
  it("formats decimal strings exactly, with the currency", () => {
    expect(formatEmailMoney("1284.50", "USD")).toBe("$1,284.50");
    expect(formatEmailMoney("0.00", "USD")).toBe("$0.00");
    expect(formatEmailMoney("108", "USD")).toBe("$108.00");
  });

  it("does not lose precision beyond 2^53", () => {
    expect(formatEmailMoney("9007199254740993.10", "USD")).toBe("$9,007,199,254,740,993.10");
  });

  it("supports another currency", () => {
    expect(formatEmailMoney("1000.00", "EUR")).toBe("€1,000.00");
  });

  it("rejects a value that is not a decimal string or a currency code", () => {
    expect(() => formatEmailMoney("12,50", "USD")).toThrow(RangeError);
    expect(() => formatEmailMoney("abc", "USD")).toThrow(RangeError);
    expect(() => formatEmailMoney("10.00", "usd")).toThrow(RangeError);
    expect(() => formatEmailMoney("10.00", "DOLLARS")).toThrow(RangeError);
  });
});

describe("formatEmailDate", () => {
  it("shows a date-only value as written", () => {
    expect(formatEmailDate("2026-11-10")).toBe("Nov 10, 2026");
    expect(formatEmailDate("2028-02-29")).toBe("Feb 29, 2028");
  });

  it("rejects text that is not a real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "10/11/2026", "2026-11-10T00:00:00Z", ""]) {
      expect(() => formatEmailDate(bad)).toThrow(RangeError);
    }
  });
});

describe("formatEmailDateTime and formatEmailWindow (business time zone)", () => {
  const NEW_YORK = "America/New_York";

  it("uses the business time zone, not the machine's, and names it", () => {
    // 14:00 UTC is 09:00 in New York in November (EST) and 10:00 in July (EDT).
    expect(formatEmailDateTime(new Date("2026-11-10T14:00:00.000Z"), NEW_YORK)).toBe(
      "Tue, Nov 10, 2026, 9:00 AM EST",
    );
    expect(formatEmailDateTime(new Date("2026-07-14T14:00:00.000Z"), NEW_YORK)).toBe(
      "Tue, Jul 14, 2026, 10:00 AM EDT",
    );
  });

  it("writes midnight as 12 AM and noon as 12 PM", () => {
    expect(formatEmailDateTime(new Date("2026-11-10T05:00:00.000Z"), NEW_YORK)).toContain(
      "12:00 AM",
    );
    expect(formatEmailDateTime(new Date("2026-11-10T17:00:00.000Z"), NEW_YORK)).toContain(
      "12:00 PM",
    );
  });

  it("gives a same-day window once, with the meridiem shown once when both ends share it", () => {
    expect(
      formatEmailWindow(
        new Date("2026-11-10T14:00:00.000Z"),
        new Date("2026-11-10T16:00:00.000Z"),
        NEW_YORK,
      ),
    ).toBe("Tue, Nov 10, 2026, 9:00 – 11:00 AM EST");
    expect(
      formatEmailWindow(
        new Date("2026-11-10T16:00:00.000Z"),
        new Date("2026-11-10T18:30:00.000Z"),
        NEW_YORK,
      ),
    ).toBe("Tue, Nov 10, 2026, 11:00 AM – 1:30 PM EST");
  });

  it("gives both ends in full when the window crosses midnight", () => {
    expect(
      formatEmailWindow(
        new Date("2026-11-11T03:00:00.000Z"),
        new Date("2026-11-11T06:00:00.000Z"),
        NEW_YORK,
      ),
    ).toBe("Tue, Nov 10, 2026, 10:00 PM – Wed, Nov 11, 2026, 1:00 AM EST");
  });

  it("never prints a narrow no-break space, whatever ICU version runs", () => {
    const text = formatEmailDateTime(new Date("2026-11-10T20:00:00.000Z"), NEW_YORK);

    expect(text).toBe("Tue, Nov 10, 2026, 3:00 PM EST");
    expect(text).not.toContain(String.fromCharCode(0x202f));
  });

  it("rejects an invalid date or time zone", () => {
    expect(() => formatEmailDateTime(new Date("nope"), NEW_YORK)).toThrow(RangeError);
    expect(() => formatEmailDateTime(new Date(), "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});
