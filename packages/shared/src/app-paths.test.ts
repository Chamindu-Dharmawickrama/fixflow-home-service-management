import { describe, expect, it } from "vitest";

import { isSafeAppPath } from "./app-paths.js";

describe("isSafeAppPath", () => {
  it.each([
    "/app/requests",
    "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    "/portal/quotations/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    "/portal",
    "/app",
    "/app/requests?status=SUBMITTED&page=2",
    "/portal/invoices#payments",
    "/app/customers/some%20name",
  ])("accepts %s", (path) => {
    expect(isSafeAppPath(path)).toBe(true);
  });

  it.each([
    ["an absolute URL", "https://evil.test/app/requests"],
    ["a protocol-relative URL", "//evil.test/app/requests"],
    ["a script URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["no leading slash", "app/requests"],
    ["a backslash that browsers read as a slash", "/\\evil.test"],
    ["a backslash inside the area", "/app\\..\\login"],
    ["a tab that browsers strip", "/\t/evil.test"],
    ["a newline", "/app/requests\nSet-Cookie: x=1"],
    ["a space", "/app/my requests"],
    ["an encoded slash", "/app/%2Fevil"],
    ["an encoded backslash", "/app/%5Cevil"],
    ["an encoded control character", "/app/%0d%0a"],
    ["a dot segment", "/app/../login"],
    ["a single dot segment", "/app/./requests"],
    ["a page outside the signed-in areas", "/login"],
    ["the home page", "/"],
    ["a look-alike area", "/application/requests"],
    ["a look-alike portal", "/portals"],
    ["an empty string", ""],
    ["a path that is too long", `/app/${"a".repeat(400)}`],
  ])("rejects %s", (_name, path) => {
    expect(isSafeAppPath(path)).toBe(false);
  });

  it.each([null, undefined, 42, {}, ["/app"]])("rejects the non-string %j", (value) => {
    expect(isSafeAppPath(value)).toBe(false);
  });
});
