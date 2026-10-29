import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import { isHttpsUrl, isTaxRateInRange, isValidPhone, isValidPostalCode } from "./validators.js";

describe("isHttpsUrl", () => {
  it.each(["https://example.test/logo.png", "https://cdn.example.test/a/b.svg?v=2"])(
    "accepts %s",
    (value) => {
      expect(isHttpsUrl(value)).toBe(true);
    },
  );

  it.each([
    "http://example.test/logo.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//example.test/logo.png",
    "/images/logo.png",
    "https://user:secret@example.test/logo.png",
    "https://localhost/logo.png",
    "https://example.test/a b.png",
    " https://example.test/a.png",
    "not a url",
    "",
  ])("rejects %j", (value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });
});

describe("isValidPhone", () => {
  it.each(["(212) 555-0142", "212.555.0142", "+44 20 7946 0000", "5550142", "+1 (212) 555-0142"])(
    "accepts %s",
    (value) => {
      expect(isValidPhone(value)).toBe(true);
    },
  );

  it.each([
    "555-01",
    "+1 2345 6789 0123 4567",
    "212-CALL-NOW",
    "212 555 0142 ext 5",
    "212+555 0142",
    "",
    "<b>1</b>",
  ])("rejects %j", (value) => {
    expect(isValidPhone(value)).toBe(false);
  });
});

describe("isValidPostalCode", () => {
  it("accepts letters, digits, spaces and hyphens, and nothing else", () => {
    for (const value of ["10999", "SW1A 1AA", "K1A-0B1"])
      expect(isValidPostalCode(value)).toBe(true);
    for (const value of ["", " 10999", "-1", "109<99"])
      expect(isValidPostalCode(value)).toBe(false);
  });
});

describe("isTaxRateInRange", () => {
  it("accepts 0 to 100 inclusive, compared as digits", () => {
    for (const value of ["0", "8.00", "99.99", "100", "100.00"])
      expect(isTaxRateInRange(value)).toBe(true);
    for (const value of ["100.01", "101", "999"]) expect(isTaxRateInRange(value)).toBe(false);
  });
});

describe("package entry point", () => {
  it("re-exports the validators", () => {
    expect(shared.isHttpsUrl).toBe(isHttpsUrl);
    expect(shared.isValidPhone).toBe(isValidPhone);
    expect(shared.isValidPostalCode).toBe(isValidPostalCode);
    expect(shared.isTaxRateInRange).toBe(isTaxRateInRange);
  });
});
