import { describe, expect, it } from "vitest";

import {
  emailDomain,
  looksLikeEmail,
  maskEmail,
  normalizeEmail,
  parseEmailList,
} from "./email-address.js";

describe("normalizeEmail", () => {
  it("trims and lower-cases, so one address has one spelling", () => {
    expect(normalizeEmail("  Alex.Morgan@Example.Test ")).toBe("alex.morgan@example.test");
    expect(normalizeEmail("alex.morgan@example.test")).toBe("alex.morgan@example.test");
  });
});

describe("looksLikeEmail", () => {
  it.each(["a@b.co", "alex.morgan+jobs@example.test", "x@sub.domain.example"])(
    "accepts %s",
    (value) => {
      expect(looksLikeEmail(value)).toBe(true);
    },
  );

  it.each(["", "plain", "a@b", "a b@c.de", "@example.test", "a@@b.co", `${"x".repeat(250)}@a.bc`])(
    "rejects %j",
    (value) => {
      expect(looksLikeEmail(value)).toBe(false);
    },
  );
});

describe("parseEmailList", () => {
  it("normalizes, de-duplicates and drops blanks", () => {
    expect(parseEmailList(" Owner@Example.Test, a@b.co ,, owner@example.test ")).toEqual({
      emails: ["owner@example.test", "a@b.co"],
      invalid: 0,
    });
  });

  it("counts invalid entries without returning them", () => {
    expect(parseEmailList("ok@example.test, nope, also nope")).toEqual({
      emails: ["ok@example.test"],
      invalid: 2,
    });
  });

  it("treats an unset or empty value as an empty list", () => {
    expect(parseEmailList(undefined)).toEqual({ emails: [], invalid: 0 });
    expect(parseEmailList("")).toEqual({ emails: [], invalid: 0 });
  });
});

describe("emailDomain", () => {
  it("returns the lower-cased domain", () => {
    expect(emailDomain("Alex@Example.TEST")).toBe("example.test");
    expect(emailDomain("no-at-sign")).toBeUndefined();
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain only", () => {
    expect(maskEmail("alex.morgan@example.test")).toBe("a***@example.test");
  });

  it("masks anything that is not an address entirely", () => {
    expect(maskEmail("nonsense")).toBe("***");
    expect(maskEmail("@example.test")).toBe("***");
  });
});
