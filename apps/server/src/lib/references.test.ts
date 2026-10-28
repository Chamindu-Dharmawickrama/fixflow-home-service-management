import { ReferenceType } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { formatReference, REFERENCE_PREFIXES, referenceYear } from "./references.js";

describe("formatReference", () => {
  it.each([
    [ReferenceType.REQUEST, 2026, 1, "FF-2026-00001"],
    [ReferenceType.QUOTATION, 2026, 42, "QT-2026-00042"],
    [ReferenceType.WORK_ORDER, 2027, 12345, "JOB-2027-12345"],
    [ReferenceType.INVOICE, 2026, 99999, "INV-2026-99999"],
  ])("formats %s %i #%i as %s (D-17)", (type, year, sequence, expected) => {
    expect(formatReference(type, year, sequence)).toBe(expected);
  });

  it("grows a digit rather than truncating after 99999", () => {
    expect(formatReference(ReferenceType.REQUEST, 2026, 100_000)).toBe("FF-2026-100000");
  });

  it("has a prefix for every reference type", () => {
    expect(Object.keys(REFERENCE_PREFIXES).sort()).toEqual(Object.values(ReferenceType).sort());
  });
});

describe("referenceYear", () => {
  it("uses the business time zone, not UTC, around New Year", () => {
    // 2027-01-01 03:30 UTC is still 31 December 2026 (22:30) in New York.
    const instant = new Date("2027-01-01T03:30:00.000Z");

    expect(referenceYear(instant, "UTC")).toBe(2027);
    expect(referenceYear(instant, "America/New_York")).toBe(2026);
  });

  it("moves into the new year in time zones ahead of UTC", () => {
    // 2026-12-31 20:00 UTC is already 1 January 2027 (09:00) in Auckland.
    const instant = new Date("2026-12-31T20:00:00.000Z");

    expect(referenceYear(instant, "UTC")).toBe(2026);
    expect(referenceYear(instant, "Pacific/Auckland")).toBe(2027);
  });

  it("switches exactly at local midnight", () => {
    // Midnight 1 January 2027 in New York is 05:00 UTC (EST, UTC-5).
    expect(referenceYear(new Date("2027-01-01T04:59:59.999Z"), "America/New_York")).toBe(2026);
    expect(referenceYear(new Date("2027-01-01T05:00:00.000Z"), "America/New_York")).toBe(2027);
  });

  it("rejects a time zone it does not know", () => {
    expect(() => referenceYear(new Date(), "Mars/Olympus_Mons")).toThrow(/time zone/);
  });
});
