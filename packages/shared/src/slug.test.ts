import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import { isValidSlug, SLUG_MAX_LENGTH, slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["AC Diagnostic Visit", "ac-diagnostic-visit"],
    ["  Washing   Machine Repair  ", "washing-machine-repair"],
    ["Café & Kitchen Deep-Clean", "cafe-and-kitchen-deep-clean"],
    ["Électricité — inspection", "electricite-inspection"],
    ["24/7 Emergency Call-Out!", "24-7-emergency-call-out"],
    ["---Heat Pump---", "heat-pump"],
    ["Home_Deep_Cleaning", "home-deep-cleaning"],
    ["Ünïcödé", "unicode"],
  ])("turns %j into %j", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it("gives a usable fallback when the name has no Latin letters or digits", () => {
    expect(slugify("!!!")).toBe("service");
    expect(slugify("")).toBe("service");
    expect(slugify("   ")).toBe("service");
    expect(slugify("空調修理")).toBe("service");
  });

  it("never exceeds the maximum length or ends with a hyphen", () => {
    const slug = slugify("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  it("always produces a valid slug", () => {
    for (const name of [
      "A",
      "a b c",
      "AC 2 Ton",
      "R-410A Refill",
      "Fix & Go",
      "100% Satisfaction",
    ]) {
      expect(isValidSlug(slugify(name)), name).toBe(true);
    }
  });

  it("is idempotent: a slug slugifies to itself", () => {
    const once = slugify("Electrical Safety Inspection");
    expect(slugify(once)).toBe(once);
  });
});

describe("isValidSlug", () => {
  it.each(["ac-repair", "a", "heat-pump-2", "24-7", "x1-y2"])("accepts %j", (value) => {
    expect(isValidSlug(value)).toBe(true);
  });

  it.each([
    "",
    "AC-Repair",
    "ac repair",
    "ac_repair",
    "-ac-repair",
    "ac-repair-",
    "ac--repair",
    "ac/repair",
    "../etc",
    "café",
    "a".repeat(SLUG_MAX_LENGTH + 1),
  ])("rejects %j", (value) => {
    expect(isValidSlug(value)).toBe(false);
  });

  it("rejects values that are not strings", () => {
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(12)).toBe(false);
  });

  it("is re-exported from the package entry point", () => {
    expect(shared.slugify).toBe(slugify);
    expect(shared.isValidSlug).toBe(isValidSlug);
  });
});
