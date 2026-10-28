import { describe, expect, it } from "vitest";

import {
  ACTIVITY_METADATA_KEYS,
  ActivityValidationError,
  sensitiveValueReason,
  validateActivityMetadata,
} from "./activity.metadata.js";

describe("validateActivityMetadata", () => {
  it("accepts allowlisted keys with values of the right kind and returns a copy", () => {
    const input = {
      quotationReference: "QT-2026-00004",
      totalAmount: "1234.50",
      currencyCode: "USD",
      lineItemCount: 3,
      isActive: true,
      changedFields: ["name", "startingPrice"],
      technicianId: "5b2d6d57-97b7-4d0a-9b9b-3e0d1e1b8c11",
      scheduledStart: "2026-11-02T14:00:00.000Z",
    };

    const clean = validateActivityMetadata(input);

    expect(clean).toEqual(input);
    expect(clean).not.toBe(input);
    expect(clean["changedFields"]).not.toBe(input.changedFields);
  });

  it("accepts an empty object and skips undefined values", () => {
    expect(validateActivityMetadata({})).toEqual({});
    expect(validateActivityMetadata({ amount: undefined, balance: "10.00" })).toEqual({
      balance: "10.00",
    });
  });

  it.each([
    "email",
    "address",
    "password",
    "token",
    "reason",
    "notes",
    "description",
    "phone",
    "name",
    "accessNotes",
    "__proto__x",
    "constructor",
  ])("rejects the key %j because it is not on the allowlist", (key) => {
    expect(() => validateActivityMetadata({ [key]: "x" })).toThrow(ActivityValidationError);
    expect(() => validateActivityMetadata({ [key]: "x" })).toThrow(/not allowed/);
  });

  it("rejects values that are not plain objects", () => {
    for (const bad of [null, "text", 42, ["amount"], undefined]) {
      expect(() => validateActivityMetadata(bad)).toThrow(/must be an object/);
    }
  });

  it.each([
    ["lineItemCount", "3"],
    ["lineItemCount", Number.NaN],
    ["lineItemCount", Number.POSITIVE_INFINITY],
    ["amount", 12.5],
    ["isActive", "yes"],
    ["changedFields", "name"],
    ["changedFields", ["name", 4]],
    ["reference", { nested: "object" }],
  ])("rejects %s = %j because it has the wrong kind of value", (key, value) => {
    expect(() => validateActivityMetadata({ [key]: value })).toThrow(ActivityValidationError);
  });

  it.each([
    ["an email address", "customer alex.morgan@example.test"],
    ["an email address", "a@b.co"],
    ["an access token", "Bearer abcdefgh12345678"],
    [
      "an access token",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    ],
    ["a token or secret", "7f3c9e0a4b1d48e6a2c5f8b9d0e1a3c4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"],
    ["a token or secret", "c2VjcmV0LXRva2VuLXZhbHVlLXRoYXQtaXMtbG9uZw=="],
    ["a street address", "214 Larkspur Lane"],
    ["a street address", "Job at 48 Harbor Point Road"],
    ["a street address", "9 Oak St."],
  ])("rejects a value that looks like %s: %j", (_what, value) => {
    expect(() => validateActivityMetadata({ serviceName: value })).toThrow(ActivityValidationError);
  });

  it("names the key and the kind of problem but never echoes the value", () => {
    const secret = "alex.morgan@example.test";

    let message = "";
    try {
      validateActivityMetadata({ serviceName: secret });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("serviceName");
    expect(message).toContain("email address");
    expect(message).not.toContain(secret);
  });

  it("checks every item of a list", () => {
    expect(() => validateActivityMetadata({ changedFields: ["name", "a@b.co"] })).toThrow(
      /email address/,
    );
  });

  it("limits the size of strings and lists", () => {
    expect(() => validateActivityMetadata({ serviceName: "x ".repeat(101) })).toThrow(
      /longer than/,
    );
    expect(() =>
      validateActivityMetadata({ changedFields: Array.from({ length: 21 }, (_, i) => `f${i}`) }),
    ).toThrow(/more than/);
  });

  it("allows ids, references, dates, money and ordinary names that merely look like data", () => {
    const fine = [
      "5b2d6d57-97b7-4d0a-9b9b-3e0d1e1b8c11",
      "FF-2026-00001",
      "INV-2026-00012",
      "2026-11-02",
      "2026-11-02T14:00:00.000Z",
      "1234567.89",
      "AC Routine Maintenance",
      "Washing Machine Repair",
      "Home Deep Cleaning",
      "BANK_TRANSFER",
    ];
    for (const value of fine) {
      expect(sensitiveValueReason(value), value).toBeUndefined();
    }
  });

  it("covers every allowlisted key with a known kind", () => {
    for (const kind of Object.values(ACTIVITY_METADATA_KEYS)) {
      expect(["string", "number", "boolean", "stringList"]).toContain(kind);
    }
  });
});
