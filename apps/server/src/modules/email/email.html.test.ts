import { describe, expect, it } from "vitest";

import { httpUrl, markup, raw, SafeHtml } from "./email.html.js";

describe("markup (escapes by default)", () => {
  it("escapes a script tag in element content", () => {
    const name = "<script>alert(1)</script>";

    expect(markup`<p>${name}</p>`.value).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("keeps an attribute-injection payload inside its quoted attribute", () => {
    const title = '" onmouseover="alert(1)';
    const rendered = markup`<a title="${title}">link</a>`.value;

    expect(rendered).toBe('<a title="&quot; onmouseover=&quot;alert(1)">link</a>');
    expect(rendered).not.toContain('" onmouseover="');
  });

  it("escapes single quotes, backticks and ampersands", () => {
    expect(markup`${"Fix & 'Flow' `x`"}`.value).toBe("Fix &amp; &#39;Flow&#39; &#96;x&#96;");
  });

  it("does not escape a nested template twice", () => {
    const inner = markup`<b>${"a & b"}</b>`;

    expect(markup`<p>${inner}</p>`.value).toBe("<p><b>a &amp; b</b></p>");
  });

  it("joins arrays of fragments and escapes arrays of strings", () => {
    const items = ["<one>", "two"].map((item) => markup`<li>${item}</li>`);

    expect(markup`<ul>${items}</ul>`.value).toBe("<ul><li>&lt;one&gt;</li><li>two</li></ul>");
    expect(markup`${["<a>", "<b>"]}`.value).toBe("&lt;a&gt;&lt;b&gt;");
  });

  it("renders undefined, null and false as nothing, so a condition can switch a part off", () => {
    const show = false;

    expect(markup`<p>a${undefined}${null}${show && markup`<i>x</i>`}b</p>`.value).toBe("<p>ab</p>");
  });

  it("prints numbers and refuses values it cannot print safely", () => {
    expect(markup`${60} minutes`.value).toBe("60 minutes");
    expect(() => markup`${{ toString: () => "<x>" }}`).toThrow(TypeError);
    expect(() => markup`${() => "x"}`).toThrow(TypeError);
  });

  it("trusts only raw() and SafeHtml, never a plain string", () => {
    expect(markup`${raw("<br>")}`.value).toBe("<br>");
    expect(markup`${new SafeHtml("<hr>")}`.value).toBe("<hr>");
    expect(markup`${"<br>"}`.value).toBe("&lt;br&gt;");
  });
});

describe("httpUrl", () => {
  it.each([
    "https://app.example.com/portal/quotations/1",
    "http://localhost:3000/reset-password?token=abc_DEF-123",
    'https://app.example.com/?a="b"&c=<d>',
  ])("returns %s unchanged", (url) => {
    expect(httpUrl(url)).toBe(url);
  });

  it.each([
    ["a script URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a mail link", "mailto:attacker@example.test"],
    ["a relative path", "/portal/quotations/1"],
    ["a protocol-relative URL", "//evil.test/x"],
    ["a URL with a space", "https://app.example.com/a b"],
    ["a URL with a newline", "https://app.example.com/a\nb"],
    ["an empty string", ""],
    ["a malformed URL", "https://"],
  ])("refuses %s", (_name, url) => {
    expect(() => httpUrl(url)).toThrow(TypeError);
  });
});
