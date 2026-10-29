import { describe, expect, it } from "vitest";

import { isSupportedCurrency, SUPPORTED_CURRENCIES } from "./currencies.js";
import * as shared from "./index.js";

describe("SUPPORTED_CURRENCIES", () => {
  it("lists only currencies with two decimal places, according to the runtime's own data (D-18)", () => {
    for (const { code } of SUPPORTED_CURRENCIES) {
      const options = new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions();
      expect(options.minimumFractionDigits, code).toBe(2);
      expect(options.maximumFractionDigits, code).toBe(2);
    }
  });

  it("has unique, upper-case three-letter codes and a name for each", () => {
    const codes = SUPPORTED_CURRENCIES.map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const { code, name } of SUPPORTED_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(name.length).toBeGreaterThan(2);
    }
  });

  it("leaves out currencies without a hundredth: zero- and three-decimal currencies", () => {
    for (const code of [
      "JPY",
      "KRW",
      "VND",
      "CLP",
      "ISK",
      "KWD",
      "BHD",
      "OMR",
      "JOD",
      "TND",
      "PKR",
    ]) {
      expect(isSupportedCurrency(code), code).toBe(false);
    }
  });
});

describe("isSupportedCurrency", () => {
  it("accepts a listed code and nothing else", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("LKR")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("USD ")).toBe(false);
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
    expect(isSupportedCurrency(840)).toBe(false);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.isSupportedCurrency).toBe(isSupportedCurrency);
    expect(shared.SUPPORTED_CURRENCIES).toBe(SUPPORTED_CURRENCIES);
  });
});
