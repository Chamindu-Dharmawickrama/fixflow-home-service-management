import { describe, expect, it } from "vitest";

import { EMPTY_LINE, lineTotalsOf, previewDocument } from "./line-items";

const LINES = [
  { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
  { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
];

describe("lineTotalsOf", () => {
  it("gives each line its own total, rounded half up", () => {
    expect(lineTotalsOf(LINES)).toEqual(["79.00", "45.50", "127.50"]);
    expect(
      lineTotalsOf([
        { description: "Washer", quantity: "0.50", unitPrice: "0.05", taxable: false },
      ]),
    ).toEqual(["0.03"]);
  });

  it("leaves a line without a total while its numbers are unusable, and keeps the others", () => {
    expect(
      lineTotalsOf([
        LINES[0] as (typeof LINES)[number],
        { ...EMPTY_LINE, description: "No price yet" },
        { ...LINES[1], quantity: "abc" } as (typeof LINES)[number],
        { ...LINES[2], quantity: "0" } as (typeof LINES)[number],
      ]),
    ).toEqual(["79.00", undefined, undefined, undefined]);
  });
});

describe("previewDocument: the shared calculation over what is typed", () => {
  it("gives the worked example of D-19 with no discount: 252.00, tax 3.64, total 255.64", () => {
    const { totals, lineTotals } = previewDocument({
      lines: LINES,
      discountAmount: "0",
      taxRate: "8.00",
    });
    expect(totals).toMatchObject({
      subtotal: "252.00",
      taxableBase: "45.50",
      taxAmount: "3.64",
      totalAmount: "255.64",
    });
    expect(lineTotals).toEqual(["79.00", "45.50", "127.50"]);
  });

  it("gives the worked example with a discount of 25.20: taxable base 40.95, tax 3.28, total 230.08", () => {
    const { totals } = previewDocument({ lines: LINES, discountAmount: "25.20", taxRate: "8.00" });
    expect(totals).toMatchObject({
      taxableBase: "40.95",
      taxAmount: "3.28",
      totalAmount: "230.08",
    });
  });

  it("shows no totals rather than wrong ones while anything cannot be added up", () => {
    for (const bad of [
      { discountAmount: "abc", taxRate: "8" },
      { discountAmount: "0", taxRate: "101" },
      { discountAmount: "999", taxRate: "8" },
      { discountAmount: "", taxRate: "8" },
    ]) {
      expect(previewDocument({ lines: LINES, ...bad }).totals).toBeNull();
    }
    expect(
      previewDocument({
        lines: [{ ...LINES[0], quantity: "" } as (typeof LINES)[number]],
        discountAmount: "0",
        taxRate: "8",
      }).totals,
    ).toBeNull();
  });

  it("still gives the lines that are fine their totals when the discount is wrong", () => {
    expect(
      previewDocument({ lines: LINES, discountAmount: "999", taxRate: "8" }).lineTotals,
    ).toEqual(["79.00", "45.50", "127.50"]);
  });
});
