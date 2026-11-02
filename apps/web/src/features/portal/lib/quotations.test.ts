import { describe, expect, it } from "vitest";

import {
  daysUntilValidUntil,
  isRunningOut,
  portalQuotationPath,
  remainingDaysText,
} from "./quotations";

const NEW_YORK = "America/New_York";

describe("portalQuotationPath", () => {
  it("is the customer's quotation page", () => {
    expect(portalQuotationPath("6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11")).toBe(
      "/portal/quotations/6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11",
    );
  });

  it("encodes an id so it can never change the path", () => {
    expect(portalQuotationPath("../admin")).toBe("/portal/quotations/..%2Fadmin");
  });
});

describe("daysUntilValidUntil", () => {
  it("counts calendar days on the business's calendar", () => {
    // 12 November, 10:00 in New York.
    const now = new Date("2026-11-12T15:00:00.000Z");
    expect(daysUntilValidUntil("2026-11-17", now, NEW_YORK)).toBe(5);
    expect(daysUntilValidUntil("2026-11-13", now, NEW_YORK)).toBe(1);
  });

  it("is 0 on the last day and negative after it", () => {
    const now = new Date("2026-11-12T15:00:00.000Z");
    expect(daysUntilValidUntil("2026-11-12", now, NEW_YORK)).toBe(0);
    expect(daysUntilValidUntil("2026-11-10", now, NEW_YORK)).toBe(-2);
  });

  it("uses the business's day, not UTC's, late in the evening", () => {
    // 9 pm on 12 November in New York is already the 13th in UTC.
    const now = new Date("2026-11-13T02:00:00.000Z");
    expect(daysUntilValidUntil("2026-11-12", now, NEW_YORK)).toBe(0);
    expect(daysUntilValidUntil("2026-11-13", now, NEW_YORK)).toBe(1);
  });

  it("counts a day on which the clocks change as one day", () => {
    // New York falls back on 1 November 2026.
    const now = new Date("2026-10-31T15:00:00.000Z");
    expect(daysUntilValidUntil("2026-11-02", now, NEW_YORK)).toBe(2);
    // And springs forward on 8 March 2026.
    expect(daysUntilValidUntil("2026-03-10", new Date("2026-03-07T15:00:00.000Z"), NEW_YORK)).toBe(
      3,
    );
  });

  it("follows another business's time zone", () => {
    // 3 pm UTC is already the next morning in Tokyo.
    const now = new Date("2026-11-12T15:00:00.000Z");
    expect(daysUntilValidUntil("2026-11-13", now, "Asia/Tokyo")).toBe(0);
  });
});

describe("remainingDaysText", () => {
  it("reads naturally", () => {
    expect(remainingDaysText(5)).toBe("5 days left");
    expect(remainingDaysText(2)).toBe("2 days left");
    expect(remainingDaysText(1)).toBe("1 day left");
    expect(remainingDaysText(0)).toBe("last day to answer");
  });

  it("never prints a negative count", () => {
    expect(remainingDaysText(-3)).toBe("last day to answer");
  });
});

describe("isRunningOut", () => {
  it("nudges from two days out", () => {
    expect(isRunningOut(3)).toBe(false);
    expect(isRunningOut(2)).toBe(true);
    expect(isRunningOut(0)).toBe(true);
  });
});
