import { describe, expect, it } from "vitest";

import { formatDuration, formatServicePrice } from "./format";

describe("formatServicePrice", () => {
  it("shows a fixed price as a starting price in the business currency", () => {
    expect(
      formatServicePrice({ pricingMode: "FIXED", startingPrice: "129.00", currencyCode: "USD" }),
    ).toBe("From $129.00");
    expect(
      formatServicePrice({ pricingMode: "FIXED", startingPrice: "1284.5", currencyCode: "EUR" }),
    ).toBe("From €1,284.50");
  });

  it("asks for a quote when pricing is by quotation", () => {
    expect(
      formatServicePrice({
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: null,
        currencyCode: "USD",
      }),
    ).toBe("Request a quote");
  });

  it("never invents a price: a fixed service without a valid amount reads as a quote", () => {
    expect(
      formatServicePrice({ pricingMode: "FIXED", startingPrice: null, currencyCode: "USD" }),
    ).toBe("Request a quote");
    expect(
      formatServicePrice({ pricingMode: "FIXED", startingPrice: "abc", currencyCode: "USD" }),
    ).toBe("Request a quote");
    expect(
      formatServicePrice({
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: "50.00",
        currencyCode: "USD",
      }),
    ).toBe("Request a quote");
  });
});

describe("formatDuration", () => {
  it.each([
    [5, "5 min"],
    [45, "45 min"],
    [60, "1 hr"],
    [90, "1 hr 30 min"],
    [240, "4 hr"],
    [720, "12 hr"],
  ])("writes %i minutes as %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });

  it("is null when there is no usable estimate", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-30)).toBeNull();
    expect(formatDuration(1.5)).toBeNull();
  });
});
