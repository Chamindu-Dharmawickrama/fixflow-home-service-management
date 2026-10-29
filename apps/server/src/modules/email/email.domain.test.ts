import { describe, expect, it } from "vitest";

import { absoluteAppUrl, escapeHtml, isReservedEmailDomain, singleLine } from "./email.domain.js";

describe("absoluteAppUrl", () => {
  it("joins the public origin and an app path", () => {
    expect(absoluteAppUrl("https://fixflow.example.com", "/portal/quotations/abc")).toBe(
      "https://fixflow.example.com/portal/quotations/abc",
    );
    expect(absoluteAppUrl("http://localhost:3000", "/app/requests?status=SUBMITTED")).toBe(
      "http://localhost:3000/app/requests?status=SUBMITTED",
    );
  });

  it.each([
    "https://evil.test/portal",
    "//evil.test/portal",
    "javascript:alert(1)",
    "/login",
    "portal/quotations/1",
    "/portal/../login",
  ])("refuses %s, so an email can only link into this app", (path) => {
    expect(() => absoluteAppUrl("https://fixflow.example.com", path)).toThrow(TypeError);
  });
});

describe("isReservedEmailDomain (D-52)", () => {
  it.each([
    "alex.morgan@example.test",
    "admin@demo.fixflow.test",
    "someone@anything.example",
    "x@host.invalid",
    "x@printer.local",
    "x@localhost",
    "x@example.com",
    "x@example.net",
    "x@example.org",
    "x@mail.example.com",
    "X@EXAMPLE.TEST",
  ])("treats %s as undeliverable", (address) => {
    expect(isReservedEmailDomain(address)).toBe(true);
  });

  it.each([
    "owner@coolbreeze.co.uk",
    "alex@gmail.com",
    "x@notexample.com",
    "x@example.com.au",
    "x@mytest.org",
    "x@test.com",
    "no-at-sign",
    "",
  ])("lets %j through to real delivery", (address) => {
    expect(isReservedEmailDomain(address)).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that can break out of text or a quoted attribute", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y' \`z\``)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39; &#96;z&#96;",
    );
  });

  it("leaves ordinary text alone and escapes ampersands only once", () => {
    expect(escapeHtml("Fix & Flow — Alex's")).toBe("Fix &amp; Flow — Alex&#39;s");
    expect(escapeHtml("plain text")).toBe("plain text");
  });
});

describe("singleLine", () => {
  it("replaces line breaks so a value cannot add a header", () => {
    expect(singleLine("Reset\r\nBcc: attacker@example.test")).toBe(
      "Reset Bcc: attacker@example.test",
    );
    expect(singleLine("  spaced  ")).toBe("spaced");
  });
});
