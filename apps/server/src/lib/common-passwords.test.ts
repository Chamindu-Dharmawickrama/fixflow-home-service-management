import { describe, expect, it } from "vitest";

import { isCommonPassword, normalizeForCommonCheck } from "./common-passwords.js";

describe("normalizeForCommonCheck", () => {
  it("lower-cases and keeps only letters and digits", () => {
    expect(normalizeForCommonCheck("Pass-Word 123!")).toBe("password123");
    expect(normalizeForCommonCheck("Pässwörd")).toBe("pässwörd");
  });
});

describe("isCommonPassword", () => {
  it("matches the list regardless of case, spacing and punctuation", () => {
    expect(isCommonPassword("Password123")).toBe(true);
    expect(isCommonPassword("PASS WORD 123")).toBe(true);
    expect(isCommonPassword("q-w-e-r-t-y-u-i-o-p")).toBe(true);
  });

  it("does not flag an ordinary passphrase", () => {
    expect(isCommonPassword("violet teapot sails home")).toBe(false);
  });

  it("does not contain the documented demo passwords", () => {
    expect(isCommonPassword("demoadmin2026")).toBe(false);
    expect(isCommonPassword("democustomer2026")).toBe(false);
  });
});
