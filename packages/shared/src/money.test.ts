import { describe, expect, it } from "vitest";

import { LIMITS } from "./limits.js";
import {
  calculateDocumentTotals,
  type DocumentLineInput,
  DocumentTotalsError,
  formatTaxRate,
  isAmountAbove,
  isPositiveAmount,
  parsePaymentAmount,
  sumAmounts,
  tryCalculateDocumentTotals,
} from "./money.js";

/** The three lines of the worked examples in D-19 and the T14 prompt. */
const EXAMPLE_LINES: DocumentLineInput[] = [
  { quantity: "1", unitPrice: "79.00", taxable: false },
  { quantity: "1", unitPrice: "45.50", taxable: true },
  { quantity: "1.5", unitPrice: "85.00", taxable: false },
];

function line(quantity: string, unitPrice: string, taxable = true): DocumentLineInput {
  return { quantity, unitPrice, taxable };
}

function fieldErrorsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (error) {
    if (error instanceof DocumentTotalsError) {
      return error.fieldErrors;
    }
    throw error;
  }
  throw new Error("Expected a DocumentTotalsError, but nothing was thrown.");
}

describe("calculateDocumentTotals: the worked examples (D-19)", () => {
  it("example 1: no discount, one taxable line, 8 % tax", () => {
    expect(
      calculateDocumentTotals({ lines: EXAMPLE_LINES, discountAmount: "0", taxRate: "8.00" }),
    ).toEqual({
      lines: [{ lineSubtotal: "79.00" }, { lineSubtotal: "45.50" }, { lineSubtotal: "127.50" }],
      subtotal: "252.00",
      taxableSubtotal: "45.50",
      discountAmount: "0.00",
      taxableBase: "45.50",
      taxAmount: "3.64",
      totalAmount: "255.64",
    });
  });

  it("example 2: a discount of 25.20 takes its proportional share off the taxable base", () => {
    // 45.50 - 25.20 × 45.50 / 252.00 = 40.95; tax 3.276 → 3.28; 252.00 - 25.20 + 3.28 = 230.08.
    expect(
      calculateDocumentTotals({ lines: EXAMPLE_LINES, discountAmount: "25.20", taxRate: "8.00" }),
    ).toEqual({
      lines: [{ lineSubtotal: "79.00" }, { lineSubtotal: "45.50" }, { lineSubtotal: "127.50" }],
      subtotal: "252.00",
      taxableSubtotal: "45.50",
      discountAmount: "25.20",
      taxableBase: "40.95",
      taxAmount: "3.28",
      totalAmount: "230.08",
    });
  });

  it("example 3: 0.50 × 0.05 is 0.025, which rounds half up to 0.03", () => {
    const totals = calculateDocumentTotals({
      lines: [line("0.50", "0.05", false)],
      discountAmount: "0",
      taxRate: "0",
    });
    expect(totals.lines).toEqual([{ lineSubtotal: "0.03" }]);
    expect(totals.subtotal).toBe("0.03");
    expect(totals.totalAmount).toBe("0.03");
  });

  it("example 4: a discount above the subtotal is an error, and one equal to it gives a total of 0.00", () => {
    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({ lines: EXAMPLE_LINES, discountAmount: "252.01", taxRate: "8" }),
      ),
    ).toEqual({ discountAmount: "The discount can't be more than the subtotal (252.00)." });

    expect(
      calculateDocumentTotals({ lines: EXAMPLE_LINES, discountAmount: "252.00", taxRate: "8" }),
    ).toMatchObject({
      subtotal: "252.00",
      discountAmount: "252.00",
      taxableBase: "0.00",
      taxAmount: "0.00",
      totalAmount: "0.00",
    });
  });
});

describe("calculateDocumentTotals: rounding and arithmetic", () => {
  it("rounds every line half up, never half to even", () => {
    // 2.5 × 0.01 = 0.025 → 0.03 (half to even would give 0.02); 1.5 × 0.01 = 0.015 → 0.02.
    const totals = calculateDocumentTotals({
      lines: [line("2.5", "0.01"), line("1.5", "0.01")],
      discountAmount: "0",
      taxRate: "0",
    });
    expect(totals.lines).toEqual([{ lineSubtotal: "0.03" }, { lineSubtotal: "0.02" }]);
    expect(totals.subtotal).toBe("0.05");
  });

  it("rounds the tax half up", () => {
    // 0.50 × 8.5 % = 0.0425 → 0.04; 0.10 × 5 % = 0.005 → 0.01.
    expect(
      calculateDocumentTotals({
        lines: [line("1", "0.50")],
        discountAmount: "0",
        taxRate: "8.5",
      }).taxAmount,
    ).toBe("0.04");
    expect(
      calculateDocumentTotals({
        lines: [line("1", "0.10")],
        discountAmount: "0",
        taxRate: "5",
      }).taxAmount,
    ).toBe("0.01");
  });

  it("rounds each line before adding, so the subtotal is the sum of the lines as printed", () => {
    // 0.02 + 0.025 + 0.025: rounded line by line it is 0.02 + 0.03 + 0.03 = 0.08, not round(0.07) = 0.07.
    const totals = calculateDocumentTotals({
      lines: [line("1", "0.02"), line("0.5", "0.05"), line("0.5", "0.05")],
      discountAmount: "0",
      taxRate: "0",
    });
    expect(totals.lines.map((l) => l.lineSubtotal)).toEqual(["0.02", "0.03", "0.03"]);
    expect(totals.subtotal).toBe("0.08");
  });

  it("does not suffer from binary floating point", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a float.
    const totals = calculateDocumentTotals({
      lines: [line("1", "0.10", false), line("1", "0.20", false)],
      discountAmount: "0",
      taxRate: "0",
    });
    expect(totals.subtotal).toBe("0.30");
    expect(totals.totalAmount).toBe("0.30");
  });

  it("charges no tax when no line is taxable, and tax on everything when all are", () => {
    const none = calculateDocumentTotals({
      lines: [line("2", "50.00", false)],
      discountAmount: "10",
      taxRate: "8",
    });
    expect(none).toMatchObject({ taxableBase: "0.00", taxAmount: "0.00", totalAmount: "90.00" });

    const all = calculateDocumentTotals({
      lines: [line("2", "50.00", true)],
      discountAmount: "10",
      taxRate: "8",
    });
    // Taxable base 100 - 10 = 90, tax 7.20, total 97.20.
    expect(all).toMatchObject({ taxableBase: "90.00", taxAmount: "7.20", totalAmount: "97.20" });
  });

  it("spreads the discount over the taxable lines only by their share of the subtotal", () => {
    // Subtotal 200, taxable 50: a discount of 100 removes half of everything, so 25 of the taxable.
    const totals = calculateDocumentTotals({
      lines: [line("1", "150.00", false), line("1", "50.00", true)],
      discountAmount: "100",
      taxRate: "10",
    });
    expect(totals).toMatchObject({
      taxableSubtotal: "50.00",
      taxableBase: "25.00",
      taxAmount: "2.50",
      totalAmount: "102.50",
    });
  });

  it("rounds the taxable base half up when the share is not a whole cent", () => {
    // 33.33 taxable of 99.99, discount 10.00: 33.33 × 89.99 / 99.99 = 29.9966… → 30.00.
    const totals = calculateDocumentTotals({
      lines: [line("1", "66.66", false), line("1", "33.33", true)],
      discountAmount: "10.00",
      taxRate: "0",
    });
    expect(totals.taxableBase).toBe("30.00");
  });

  it("handles a zero subtotal (free items) without dividing by zero", () => {
    const totals = calculateDocumentTotals({
      lines: [line("1", "0.00", true)],
      discountAmount: "0",
      taxRate: "8",
    });
    expect(totals).toMatchObject({
      subtotal: "0.00",
      taxableBase: "0.00",
      taxAmount: "0.00",
      totalAmount: "0.00",
    });
  });

  it("returns every amount with exactly two decimal places, in the order of the input lines", () => {
    const totals = calculateDocumentTotals({
      lines: [line("3", "7"), line("1.25", "10")],
      discountAmount: "1",
      taxRate: "8.25",
    });
    expect(totals.lines.map((l) => l.lineSubtotal)).toEqual(["21.00", "12.50"]);
    for (const value of [
      totals.subtotal,
      totals.taxableSubtotal,
      totals.discountAmount,
      totals.taxableBase,
      totals.taxAmount,
      totals.totalAmount,
    ]) {
      expect(value).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("always satisfies total = subtotal - discount + tax", () => {
    const rates = ["0", "5", "8.00", "8.25", "19.99", "100"];
    const discounts = ["0", "0.01", "12.34", "100"];
    for (const taxRate of rates) {
      for (const discountAmount of discounts) {
        const totals = calculateDocumentTotals({
          lines: [line("2.5", "19.99"), line("1", "80.01", false), line("0.33", "3.33")],
          discountAmount,
          taxRate,
        });
        const cents = (value: string) => Math.round(Number(value) * 100);
        expect(cents(totals.totalAmount)).toBe(
          cents(totals.subtotal) - cents(totals.discountAmount) + cents(totals.taxAmount),
        );
      }
    }
  });

  it("accepts the largest quantity and price the limits allow", () => {
    const totals = calculateDocumentTotals({
      lines: [line(LIMITS.quantity.max, LIMITS.unitPrice.max, false)],
      discountAmount: "0",
      taxRate: "0",
    });
    // 9999.99 × 999999.99 = 9,999,989,900.0001: it fits the column and rounds to the cent.
    expect(totals.subtotal).toBe("9999989900.00");
  });
});

describe("calculateDocumentTotals: limits (D-20)", () => {
  const ok = [line("1", "10.00")];

  it("rejects a quantity of zero, below the minimum or above the maximum, naming the line", () => {
    for (const quantity of ["0", "0.00", "10000", "10000.00"]) {
      expect(
        Object.keys(
          fieldErrorsOf(() =>
            calculateDocumentTotals({
              lines: [line("1", "1.00"), line(quantity, "1.00")],
              discountAmount: "0",
              taxRate: "0",
            }),
          ),
        ),
      ).toEqual(["lines.1.quantity"]);
    }
    expect(
      calculateDocumentTotals({
        lines: [line("0.01", "1.00")],
        discountAmount: "0",
        taxRate: "0",
      }).subtotal,
    ).toBe("0.01");
  });

  it("rejects a price above the maximum, and accepts a price of zero", () => {
    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({
          lines: [line("1", "1000000.00")],
          discountAmount: "0",
          taxRate: "0",
        }),
      ),
    ).toEqual({ "lines.0.unitPrice": "Enter a price from 0.00 to 999,999.99." });
    expect(
      calculateDocumentTotals({ lines: [line("1", "0")], discountAmount: "0", taxRate: "0" })
        .subtotal,
    ).toBe("0.00");
  });

  it("rejects anything that is not a plain non-negative decimal with two places at most", () => {
    for (const bad of [
      "",
      " ",
      "abc",
      "-1",
      "+1",
      "1e3",
      "1,5",
      "1.234",
      "0x10",
      ".",
      "1.",
      "NaN",
    ]) {
      const errors = fieldErrorsOf(() =>
        calculateDocumentTotals({
          lines: [{ quantity: bad, unitPrice: bad, taxable: true }],
          discountAmount: "0",
          taxRate: "0",
        }),
      );
      expect(Object.keys(errors).sort(), `"${bad}"`).toEqual([
        "lines.0.quantity",
        "lines.0.unitPrice",
      ]);
    }
  });

  it("says why more than two decimal places are refused", () => {
    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({
          lines: [line("1", "1.005")],
          discountAmount: "0",
          taxRate: "0",
        }),
      )["lines.0.unitPrice"],
    ).toBe("Use at most 2 decimal places.");
  });

  it("allows 1 to 50 lines and no others", () => {
    const fifty = Array.from({ length: 50 }, () => line("1", "1.00"));
    expect(
      calculateDocumentTotals({ lines: fifty, discountAmount: "0", taxRate: "0" }).subtotal,
    ).toBe("50.00");

    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({
          lines: [...fifty, line("1", "1")],
          discountAmount: "0",
          taxRate: "0",
        }),
      ),
    ).toEqual({ lines: "Add between 1 and 50 lines." });
    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({ lines: [], discountAmount: "0", taxRate: "0" }),
      ),
    ).toEqual({ lines: "Add between 1 and 50 lines." });
  });

  it("rejects a tax rate outside 0 to 100, but allows both ends", () => {
    for (const taxRate of ["100.01", "101", "-1", "", "x"]) {
      expect(
        Object.keys(
          fieldErrorsOf(() => calculateDocumentTotals({ lines: ok, discountAmount: "0", taxRate })),
        ),
      ).toEqual(["taxRate"]);
    }
    expect(
      calculateDocumentTotals({ lines: ok, discountAmount: "0", taxRate: "100" }).taxAmount,
    ).toBe("10.00");
    expect(
      calculateDocumentTotals({ lines: ok, discountAmount: "0", taxRate: "0" }).taxAmount,
    ).toBe("0.00");
  });

  it("rejects a negative or malformed discount", () => {
    for (const discountAmount of ["-0.01", "x", "", "1.234"]) {
      expect(
        Object.keys(
          fieldErrorsOf(() => calculateDocumentTotals({ lines: ok, discountAmount, taxRate: "0" })),
        ),
      ).toEqual(["discountAmount"]);
    }
  });

  it("rejects a document larger than the columns that store it can hold", () => {
    const big = Array.from({ length: 2 }, () =>
      line(LIMITS.quantity.max, LIMITS.unitPrice.max, false),
    );
    expect(
      fieldErrorsOf(() =>
        calculateDocumentTotals({ lines: big, discountAmount: "0", taxRate: "0" }),
      ),
    ).toEqual({ lines: "The lines add up to more than 9,999,999,999.99." });
  });

  it("reports every problem at once, each against its own field", () => {
    const errors = fieldErrorsOf(() =>
      calculateDocumentTotals({
        lines: [line("0", "1"), line("1", "x"), line("1", "5")],
        discountAmount: "-1",
        taxRate: "101",
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "discountAmount",
      "lines.0.quantity",
      "lines.1.unitPrice",
      "taxRate",
    ]);
  });
});

describe("tryCalculateDocumentTotals", () => {
  it("returns the totals without throwing, and the field errors for an incomplete form", () => {
    const ok = tryCalculateDocumentTotals({
      lines: EXAMPLE_LINES,
      discountAmount: "0",
      taxRate: "8",
    });
    expect(ok.ok).toBe(true);

    const bad = tryCalculateDocumentTotals({
      lines: [line("", "5")],
      discountAmount: "0",
      taxRate: "8",
    });
    expect(bad).toEqual({
      ok: false,
      fieldErrors: { "lines.0.quantity": "Enter a quantity as a number, for example 2 or 2.50." },
    });
  });

  it("trims the text it is given", () => {
    const result = tryCalculateDocumentTotals({
      lines: [line(" 2 ", " 5.00 ")],
      discountAmount: " 0 ",
      taxRate: " 0 ",
    });
    expect(result.ok && result.totals.subtotal).toBe("10.00");
  });
});

describe("helpers", () => {
  it("formatTaxRate drops trailing zeros for a label", () => {
    expect(formatTaxRate("8.00")).toBe("8");
    expect(formatTaxRate("8.25")).toBe("8.25");
    expect(formatTaxRate("8.50")).toBe("8.5");
    expect(formatTaxRate("0.00")).toBe("0");
    expect(formatTaxRate("abc")).toBe("abc");
  });

  it("isPositiveAmount is true only for a number above zero", () => {
    expect(isPositiveAmount("0.01")).toBe(true);
    expect(isPositiveAmount("0.00")).toBe(false);
    expect(isPositiveAmount("")).toBe(false);
    expect(isPositiveAmount("-5")).toBe(false);
  });
});

describe("parsePaymentAmount (D-27, FR-073)", () => {
  it("reads a positive amount with at most two places and gives it two", () => {
    expect(parsePaymentAmount("120")).toEqual({ ok: true, amount: "120.00" });
    expect(parsePaymentAmount("120.5")).toEqual({ ok: true, amount: "120.50" });
    expect(parsePaymentAmount(" 0.01 ")).toEqual({ ok: true, amount: "0.01" });
    expect(parsePaymentAmount("9999999999.99")).toEqual({ ok: true, amount: "9999999999.99" });
  });

  it.each(["", " ", "abc", "-5", "+5", "1e3", "1,000", "1 000", ".5", "5.", "NaN", "Infinity"])(
    "refuses %j as not a number",
    (raw) => {
      const result = parsePaymentAmount(raw);
      expect(result.ok).toBe(false);
    },
  );

  it("refuses anything that is not text", () => {
    for (const raw of [5, null, undefined, {}, [], true]) {
      expect(parsePaymentAmount(raw).ok).toBe(false);
    }
  });

  it("says zero is not an amount, and more than two places is too precise", () => {
    expect(parsePaymentAmount("0")).toEqual({
      ok: false,
      message: "The amount must be more than zero.",
    });
    expect(parsePaymentAmount("0.00")).toMatchObject({ ok: false });
    expect(parsePaymentAmount("10.001")).toEqual({
      ok: false,
      message: "Use at most 2 decimal places.",
    });
  });

  it("refuses an amount too large to store", () => {
    expect(parsePaymentAmount("10000000000.00")).toMatchObject({ ok: false });
  });
});

describe("sumAmounts and isAmountAbove", () => {
  it("adds decimal strings exactly, with no float error", () => {
    expect(sumAmounts([])).toBe("0.00");
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(sumAmounts(["100.10", "200.20", "0.01"])).toBe("300.31");
  });

  it("compares decimal strings exactly", () => {
    expect(isAmountAbove("200.00", "100.00")).toBe(true);
    expect(isAmountAbove("100.00", "100.00")).toBe(false);
    expect(isAmountAbove("0.30", "0.30")).toBe(false);
    expect(isAmountAbove("0.31", "0.30")).toBe(true);
  });
});
