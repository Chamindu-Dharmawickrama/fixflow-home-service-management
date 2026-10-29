import { describe, expect, it } from "vitest";

import { sanitizeReturnTo } from "./return-to";

const HOME = "/portal";

describe("sanitizeReturnTo", () => {
  it.each([
    "/app/dashboard",
    "/portal",
    "/app/requests?status=SUBMITTED&page=2",
    "/portal/requests/FF-2026-00123#timeline",
    "/",
  ])("keeps the site path %s", (path) => {
    expect(sanitizeReturnTo(path, HOME)).toBe(path);
  });

  it.each([
    ["an absolute URL", "https://evil.test"],
    ["an absolute URL with a path", "https://evil.test/app/dashboard"],
    ["a protocol-relative URL", "//evil.test"],
    ["a protocol-relative URL with a path", "//evil.test/app"],
    ["a slash then a backslash", "/\\evil.test"],
    ["two backslashes", "\\\\evil.test"],
    ["a backslash in the middle of a path", "/app\\..\\evil"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a scheme in the path position", "http:evil.test"],
    ["a path without a leading slash", "app/dashboard"],
    ["a bare host", "evil.test"],
    ["a tab that browsers strip, leaving //", "/\t/evil.test"],
    ["a newline that browsers strip, leaving //", "/\n/evil.test"],
    ["a carriage return", "/\r/evil.test"],
    ["a null byte", "/app\u0000/dashboard"],
    ["a space", "/app dashboard"],
    ["an encoded backslash", "/%5Cevil.test"],
    ["an encoded slash after the first", "/%2Fevil.test"],
    ["an empty string", ""],
    ["an over-long value", `/${"a".repeat(3000)}`],
  ])("falls back for %s", (_label, value) => {
    expect(sanitizeReturnTo(value, HOME)).toBe(HOME);
  });

  it.each([null, undefined, 42, {}, ["/app"], true])(
    "falls back for the non-string %j",
    (value) => {
      expect(sanitizeReturnTo(value, HOME)).toBe(HOME);
    },
  );

  it.each([
    "/login",
    "/login?returnTo=/app",
    "/register",
    "/forgot-password",
    "/reset-password?token=x",
  ])("never returns to the sign-in page itself (%s), which would loop", (path) => {
    expect(sanitizeReturnTo(path, HOME)).toBe(HOME);
  });

  it("normalizes dot segments but never leaves the site", () => {
    expect(sanitizeReturnTo("/app/../portal", HOME)).toBe("/portal");
    expect(sanitizeReturnTo("/../../app/dashboard", HOME)).toBe("/app/dashboard");
  });

  it("returns the given fallback, whatever it is", () => {
    expect(sanitizeReturnTo("https://evil.test", "/app/dashboard")).toBe("/app/dashboard");
  });
});
