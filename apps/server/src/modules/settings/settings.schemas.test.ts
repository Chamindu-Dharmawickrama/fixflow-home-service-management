import { describe, expect, it } from "vitest";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import { updateSettingsBodySchema } from "./settings.schemas.js";

function parse(input: unknown) {
  const result = updateSettingsBodySchema.safeParse(input);
  return result.success
    ? { data: result.data, errors: undefined }
    : { data: undefined, errors: fieldErrorsFromZod(result.error) };
}

describe("updateSettingsBodySchema", () => {
  it("accepts a single field and leaves the others out of the result", () => {
    expect(parse({ phone: "(212) 555-0199" }).data).toEqual({ phone: "(212) 555-0199" });
  });

  it("normalizes: trims text, lower-cases the email, upper-cases the currency, pads the tax rate", () => {
    expect(
      parse({
        businessName: "  CoolBreeze Home Services  ",
        contactEmail: " Hello@CoolBreeze.TEST ",
        currencyCode: " usd ",
        defaultTaxRate: "8.5",
        timeZone: " America/New_York ",
      }).data,
    ).toEqual({
      businessName: "CoolBreeze Home Services",
      contactEmail: "hello@coolbreeze.test",
      currencyCode: "USD",
      defaultTaxRate: "8.50",
      timeZone: "America/New_York",
    });
  });

  it("clears optional fields with null or blank text, never the required ones", () => {
    expect(
      parse({ tagline: "", addressLine2: null, region: "   ", logoKey: null, logoUrl: "" }).data,
    ).toEqual({ tagline: null, addressLine2: null, region: null, logoKey: null, logoUrl: null });

    const cleared = parse({ businessName: null, phone: "", city: "  ", contactEmail: "" });
    expect(Object.keys(cleared.errors ?? {}).sort()).toEqual([
      "businessName",
      "city",
      "contactEmail",
      "phone",
    ]);
  });

  it("rejects an empty body and unknown keys, including ones that must never be client-set", () => {
    expect(parse({}).errors).toEqual({ _: "Send at least one setting to change." });
    expect(parse({ updatedByUserId: "x", phone: "(212) 555-0199" }).errors).toEqual({
      updatedByUserId: "Unknown field.",
    });
    expect(parse({ id: "00000000-0000-4000-8000-000000000001" }).errors?.id).toBe("Unknown field.");
  });

  describe("timeZone", () => {
    it.each(["America/New_York", "Europe/London", "Asia/Colombo", "UTC"])("accepts %s", (zone) => {
      expect(parse({ timeZone: zone }).data).toEqual({ timeZone: zone });
    });

    it.each(["Mars/Olympus", "EST", "america/new_york", "+05:30", "", "Not a zone"])(
      "rejects %j",
      (zone) => {
        expect(parse({ timeZone: zone }).errors?.timeZone).toMatch(/^Choose a time zone/);
      },
    );
  });

  describe("currencyCode", () => {
    it("accepts a supported two-decimal currency", () => {
      expect(parse({ currencyCode: "EUR" }).data).toEqual({ currencyCode: "EUR" });
    });

    it.each(["JPY", "KWD", "XXX", "US", "DOLLAR", "", "$"])("rejects %j", (code) => {
      expect(parse({ currencyCode: code }).errors?.currencyCode).toMatch(
        /^Choose one of the supported currencies/,
      );
    });
  });

  describe("defaultTaxRate", () => {
    it.each([
      ["0", "0.00"],
      ["8", "8.00"],
      ["8.25", "8.25"],
      ["100", "100.00"],
      ["100.00", "100.00"],
    ])("accepts %s as %s", (input, stored) => {
      expect(parse({ defaultTaxRate: input }).data).toEqual({ defaultTaxRate: stored });
    });

    it.each(["-1", "100.01", "101", "8.255", "abc", "", "8%", "1e1", " "])(
      "rejects %j",
      (value) => {
        expect(parse({ defaultTaxRate: value }).errors?.defaultTaxRate).toBeDefined();
      },
    );

    it("is text, because a JSON number could carry a float", () => {
      expect(parse({ defaultTaxRate: 8.25 }).errors?.defaultTaxRate).toBe(
        "Enter the tax rate as a percentage, like 8.25.",
      );
    });

    it("explains an out-of-range value", () => {
      expect(parse({ defaultTaxRate: "100.01" }).errors?.defaultTaxRate).toBe(
        "The tax rate must be between 0 and 100.",
      );
      expect(parse({ defaultTaxRate: "8.255" }).errors?.defaultTaxRate).toBe(
        "Enter the tax rate with at most two decimal places, like 8.25.",
      );
    });
  });

  describe("day counts", () => {
    it("accepts quotation validity 1 to 90 and invoice terms 0 to 90", () => {
      expect(parse({ quotationValidityDays: 1, invoiceDueDays: 0 }).data).toEqual({
        quotationValidityDays: 1,
        invoiceDueDays: 0,
      });
      expect(parse({ quotationValidityDays: 90, invoiceDueDays: 90 }).data).toBeDefined();
    });

    it.each([0, -1, 91, 1.5, "14", null, Number.NaN])("rejects quotation validity %j", (value) => {
      expect(parse({ quotationValidityDays: value }).errors?.quotationValidityDays).toBe(
        "The quotation validity must be a whole number of days from 1 to 90.",
      );
    });

    it.each([-1, 91, 0.5, "14", null])("rejects invoice due days %j", (value) => {
      expect(parse({ invoiceDueDays: value }).errors?.invoiceDueDays).toBe(
        "The invoice payment term must be a whole number of days from 0 to 90.",
      );
    });
  });

  describe("logo", () => {
    it("accepts a bundled key", () => {
      expect(parse({ logoKey: "snowflake" }).data).toEqual({ logoKey: "snowflake" });
    });

    it.each(["air-conditioning", "Breeze", "/images/logo.png", "https://example.test/logo.png"])(
      "rejects the logo key %j",
      (value) => {
        expect(parse({ logoKey: value }).errors?.logoKey).toBe(
          "Choose one of the available logos.",
        );
      },
    );

    it("accepts an https address and nothing else", () => {
      expect(parse({ logoUrl: "https://cdn.example.test/logo.svg" }).data).toEqual({
        logoUrl: "https://cdn.example.test/logo.svg",
      });
      for (const url of [
        "http://example.test/logo.png",
        "javascript:alert(1)",
        "data:image/svg+xml;base64,AAAA",
        "//example.test/logo.png",
        "https://user:pw@example.test/logo.png",
      ]) {
        expect(parse({ logoUrl: url }).errors?.logoUrl, url).toBe(
          "The logo address must be a web address starting with https://",
        );
      }
    });
  });

  describe("text fields", () => {
    it("accepts a valid phone and refuses an invalid one", () => {
      expect(parse({ phone: "+44 20 7946 0000" }).data).toEqual({ phone: "+44 20 7946 0000" });
      expect(parse({ phone: "call us" }).errors?.phone).toMatch(
        /^Enter a phone number with 7 to 15 digits/,
      );
    });

    it("checks the postal code", () => {
      expect(parse({ postalCode: "SW1A 1AA" }).data).toEqual({ postalCode: "SW1A 1AA" });
      expect(parse({ postalCode: "<script>" }).errors?.postalCode).toBe(
        "The postal code can only contain letters, numbers, spaces and hyphens.",
      );
    });

    it("rejects an invalid email address", () => {
      expect(parse({ contactEmail: "not-an-email" }).errors?.contactEmail).toBe(
        "Enter a valid contact email address, like name@example.com.",
      );
    });

    it("applies the length limits", () => {
      expect(parse({ businessName: "x".repeat(101) }).errors?.businessName).toBe(
        "The business name must be 100 characters or fewer.",
      );
      expect(parse({ businessName: "x" }).errors?.businessName).toBe(
        "The business name must be at least 2 characters.",
      );
      expect(parse({ tagline: "x".repeat(161) }).errors?.tagline).toBe(
        "The tagline must be 160 characters or fewer.",
      );
      expect(parse({ defaultQuotationTerms: "x".repeat(2001) }).errors?.defaultQuotationTerms).toBe(
        "The quotation terms must be 2000 characters or fewer.",
      );
      expect(parse({ paymentInstructions: "x".repeat(1001) }).errors?.paymentInstructions).toBe(
        "The payment instructions must be 1000 characters or fewer.",
      );
      expect(parse({ invoiceFooter: "x".repeat(501) }).errors?.invoiceFooter).toBe(
        "The invoice footer must be 500 characters or fewer.",
      );
    });

    it("lets terms, instructions and the footer span several lines but not names", () => {
      expect(parse({ defaultQuotationTerms: "One.\nTwo." }).data).toEqual({
        defaultQuotationTerms: "One.\nTwo.",
      });
      expect(parse({ businessName: "Cool\nBreeze" }).errors?.businessName).toBe(
        "The business name must be on a single line.",
      );
    });
  });

  it("reports every invalid field at once, each beside its own name", () => {
    const { errors } = parse({
      timeZone: "Mars/Olympus",
      currencyCode: "JPY",
      defaultTaxRate: "101",
      logoUrl: "http://example.test/a.png",
      quotationValidityDays: 0,
    });
    expect(Object.keys(errors ?? {}).sort()).toEqual([
      "currencyCode",
      "defaultTaxRate",
      "logoUrl",
      "quotationValidityDays",
      "timeZone",
    ]);
  });
});
