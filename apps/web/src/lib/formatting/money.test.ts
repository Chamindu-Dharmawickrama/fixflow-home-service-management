import { describe, expect, it } from "vitest";

import { formatMoney, isDecimalString } from "./money";

describe("formatMoney", () => {
  it("formats decimal strings with grouping and two decimals", () => {
    expect(formatMoney("1284.50", "USD")).toBe("$1,284.50");
    expect(formatMoney("1284.5", "USD")).toBe("$1,284.50");
    expect(formatMoney("1284", "USD")).toBe("$1,284.00");
    expect(formatMoney("1234567.89", "USD")).toBe("$1,234,567.89");
    expect(formatMoney("0.07", "USD")).toBe("$0.07");
  });

  it("formats zero without a sign", () => {
    expect(formatMoney("0", "USD")).toBe("$0.00");
    expect(formatMoney("0.00", "USD")).toBe("$0.00");
    expect(formatMoney("-0.00", "USD")).toBe("$0.00");
  });

  it("shows the sign of a negative amount", () => {
    expect(formatMoney("-12.5", "USD")).toBe("-$12.50");
    expect(formatMoney("-1284.50", "USD")).toBe("-$1,284.50");
  });

  it("uses the explicit currency code, never the visitor's locale", () => {
    expect(formatMoney("1284.50", "EUR")).toBe("€1,284.50");
    expect(formatMoney("1284.50", "GBP")).toBe("£1,284.50");
    // A currency without minor units follows its own precision.
    expect(formatMoney("1500", "JPY")).toBe("¥1,500");
  });

  it("does not go through floating point", () => {
    // 2^53 + 1 and its fraction cannot be held by a JavaScript number.
    expect(formatMoney("9007199254740993.10", "USD")).toBe("$9,007,199,254,740,993.10");
    // 1.005 is stored as 1.00499999999999989... by a double, so Number#toFixed gives "1.00".
    expect(formatMoney("1.005", "USD")).toBe("$1.01");
    expect(formatMoney("2.675", "USD")).toBe("$2.68");
  });

  it.each(["", "abc", "12,50", "1e3", ".5", "5.", "+5", "1 000", "NaN", "Infinity", "--1"])(
    "rejects %j as an amount",
    (amount) => {
      expect(() => formatMoney(amount, "USD")).toThrow(RangeError);
    },
  );

  it.each(["", "usd", "US", "USDX", "$"])("rejects %j as a currency code", (code) => {
    expect(() => formatMoney("1.00", code)).toThrow(RangeError);
  });
});

describe("isDecimalString", () => {
  it("accepts exactly the amounts formatMoney accepts", () => {
    expect(isDecimalString("12.50")).toBe(true);
    expect(isDecimalString("-3")).toBe(true);
    expect(isDecimalString("12,50")).toBe(false);
    expect(isDecimalString("")).toBe(false);
  });
});
