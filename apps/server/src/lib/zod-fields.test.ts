import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "./zod-errors.js";
import {
  DECIMAL_2DP,
  emailAddress,
  isHttpsUrl,
  optionalHttpsUrl,
  optionalKey,
  optionalText,
  requiredText,
  toTwoPlaces,
} from "./zod-fields.js";

function messageOf(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : fieldErrorsFromZod(result.error)._;
}

describe("requiredText", () => {
  const name = requiredText("business name", { min: 2, max: 10 });

  it("trims and accepts text inside the range", () => {
    expect(name.parse("  Acme  ")).toBe("Acme");
  });

  it("explains each way it can fail in words a person can act on", () => {
    expect(messageOf(name, "")).toBe("The business name must be at least 2 characters.");
    expect(messageOf(name, "   ")).toBe("The business name must be at least 2 characters.");
    expect(messageOf(name, "x".repeat(11))).toBe(
      "The business name must be 10 characters or fewer.",
    );
    expect(messageOf(name, undefined)).toBe("Enter the business name.");
    expect(messageOf(name, 42)).toBe("Enter the business name.");
    expect(messageOf(name, null)).toBe("Enter the business name.");
  });

  it("asks to 'enter' a field that may be one character", () => {
    expect(messageOf(requiredText("city", { max: 20 }), "  ")).toBe("Enter the city.");
  });

  it("refuses line breaks and control characters unless the field is multi-line", () => {
    expect(messageOf(name, "a\nb")).toBe("The business name must be on a single line.");
    expect(messageOf(name, `a${String.fromCharCode(0x2028)}b`)).toBe(
      "The business name must be on a single line.",
    );
    expect(messageOf(name, "a\u0007b")).toBe("The business name contains invalid characters.");
    const notes = requiredText("notes", { max: 50, multiline: true });
    expect(notes.parse("line one\nline two")).toBe("line one\nline two");
    expect(messageOf(notes, "a\u0000b")).toBe("The notes contains invalid characters.");
  });
});

describe("optionalText", () => {
  const tagline = optionalText("tagline", { max: 10 });

  it("keeps text, trims it, and turns blank or null into null (how a field is cleared)", () => {
    expect(tagline.parse("  Hello  ")).toBe("Hello");
    expect(tagline.parse("")).toBeNull();
    expect(tagline.parse("   ")).toBeNull();
    expect(tagline.parse(null)).toBeNull();
  });

  it("reports the text's own message, not a generic union error", () => {
    expect(messageOf(tagline, "x".repeat(11))).toBe("The tagline must be 10 characters or fewer.");
    expect(messageOf(tagline, 5)).toBe("Enter the tagline.");
    expect(messageOf(tagline, "a\nb")).toBe("The tagline must be on a single line.");
  });
});

describe("emailAddress", () => {
  const email = emailAddress("contact email address");

  it("lower-cases and trims", () => {
    expect(email.parse("  Hello@CoolBreeze.TEST ")).toBe("hello@coolbreeze.test");
  });

  it("rejects what is not an address", () => {
    expect(messageOf(email, "nope")).toBe(
      "Enter a valid contact email address, like name@example.com.",
    );
    expect(messageOf(email, "")).toBe("Enter the contact email address.");
    expect(messageOf(email, `${"a".repeat(250)}@x.test`)).toBe(
      "The contact email address is too long.",
    );
  });
});

describe("isHttpsUrl", () => {
  it.each(["https://example.test/logo.png", "https://cdn.example.test/a/b.svg?v=2"])(
    "accepts %s",
    (value) => {
      expect(isHttpsUrl(value)).toBe(true);
    },
  );

  it.each([
    ["plain http", "http://example.test/logo.png"],
    ["a script URL", "javascript:alert(1)"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a protocol-relative URL", "//example.test/logo.png"],
    ["a path", "/images/logo.png"],
    ["embedded credentials", "https://user:secret@example.test/logo.png"],
    ["a host without a dot", "https://localhost/logo.png"],
    ["whitespace inside", "https://example.test/a b.png"],
    ["surrounding whitespace", " https://example.test/a.png"],
    ["not a URL", "not a url"],
    ["an empty string", ""],
  ])("rejects %s", (_name, value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });
});

describe("optionalHttpsUrl", () => {
  const url = optionalHttpsUrl("logo address", 40);

  it("clears on blank, accepts https, and names the field when it is not one", () => {
    expect(url.parse("")).toBeNull();
    expect(url.parse(null)).toBeNull();
    expect(url.parse(" https://example.test/a.png ")).toBe("https://example.test/a.png");
    expect(messageOf(url, "http://example.test/a.png")).toBe(
      "The logo address must be a web address starting with https://",
    );
  });

  it("applies the length limit with its own message", () => {
    expect(messageOf(url, `https://example.test/${"a".repeat(40)}`)).toBe(
      "The logo address must be 40 characters or fewer.",
    );
  });
});

describe("optionalKey", () => {
  const key = optionalKey((value) => value === "breeze", "Choose one of the available logos.");

  it("accepts a listed key, and blank or null as 'none'", () => {
    expect(key.parse("breeze")).toBe("breeze");
    expect(key.parse("")).toBeNull();
    expect(key.parse(null)).toBeNull();
  });

  it("refuses anything else, including a path or a URL", () => {
    for (const value of ["spark", "../breeze", "https://example.test/breeze.png", " breeze", 3]) {
      expect(messageOf(key, value), String(value)).toBe("Choose one of the available logos.");
    }
  });
});

describe("DECIMAL_2DP and toTwoPlaces", () => {
  it.each(["0", "8", "8.5", "8.25", "129.00", "999999.99", "0.5"])("accepts %s", (value) => {
    expect(DECIMAL_2DP.test(value)).toBe(true);
  });

  it.each(["", "-1", "8.", ".5", "8.255", "1e3", "8,5", " 8", "abc", "12345678"])(
    "rejects %j",
    (value) => {
      expect(DECIMAL_2DP.test(value)).toBe(false);
    },
  );

  it("pads to exactly two places without touching the value", () => {
    expect(toTwoPlaces("8")).toBe("8.00");
    expect(toTwoPlaces("8.5")).toBe("8.50");
    expect(toTwoPlaces("8.25")).toBe("8.25");
    expect(toTwoPlaces("0")).toBe("0.00");
    expect(toTwoPlaces("0.5")).toBe("0.50");
    expect(toTwoPlaces("007.5")).toBe("7.50");
  });
});
