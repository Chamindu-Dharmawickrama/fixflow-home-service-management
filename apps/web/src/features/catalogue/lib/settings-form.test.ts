import type { AdminSettingsDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  groupTimeZones,
  settingsFormSchema,
  type SettingsFormValues,
  settingsToFormValues,
  toSettingsBody,
} from "./settings-form";

const SETTINGS: AdminSettingsDto = {
  businessName: "CoolBreeze Home Services",
  tagline: "Home comfort and repairs, done properly the first time.",
  logoKey: "breeze",
  logoUrl: null,
  contactEmail: "hello@coolbreeze.test",
  phone: "(212) 555-0142",
  addressLine1: "48 Harbor Point Road",
  addressLine2: "Unit 3",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  serviceAreaDescription: "Harbor City and nearby towns.",
  currencyCode: "USD",
  timeZone: "America/New_York",
  defaultTaxRate: "8.00",
  quotationValidityDays: 14,
  invoiceDueDays: 14,
  defaultQuotationTerms: "Prices are valid until the date shown.",
  paymentInstructions: "Pay by bank transfer.",
  invoiceFooter: "Thank you for choosing us.",
  updatedAt: "2026-10-28T10:30:00.000Z",
  identityLocked: false,
};

function errorsFor(values: Partial<SettingsFormValues>): Record<string, string> {
  const result = settingsFormSchema.safeParse({ ...settingsToFormValues(SETTINGS), ...values });
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("settingsFormSchema", () => {
  it("accepts the settings as the API returns them", () => {
    expect(errorsFor({})).toEqual({});
  });

  it("accepts the optional fields empty", () => {
    expect(
      errorsFor({
        tagline: "",
        addressLine2: "",
        region: "",
        serviceAreaDescription: "",
        defaultQuotationTerms: "",
        paymentInstructions: "",
        invoiceFooter: "",
        logoSource: "none",
        logoKey: "",
      }),
    ).toEqual({});
  });

  it.each([
    ["businessName", "", "Enter the business name."],
    ["businessName", "A", "The business name must be at least 2 characters."],
    ["businessName", "x".repeat(101), "The business name must be 100 characters or fewer."],
    ["tagline", "x".repeat(161), "The tagline must be 160 characters or fewer."],
    ["contactEmail", "", "Enter the contact email address."],
    ["contactEmail", "not-an-email", "Enter a valid contact email address, like name@example.com."],
    ["phone", "", "Enter the phone number."],
    [
      "phone",
      "call us",
      "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0000.",
    ],
    ["addressLine1", "", "Enter the street address."],
    ["city", "", "Enter the city."],
    ["postalCode", "", "Enter the postal code."],
    [
      "postalCode",
      "<109>",
      "The postal code can only contain letters, numbers, spaces and hyphens.",
    ],
    ["currencyCode", "JPY", "Choose one of the supported currencies."],
    ["timeZone", "", "Choose a time zone."],
    ["defaultTaxRate", "", "Enter the tax rate as a percentage, like 8.25."],
    ["defaultTaxRate", "8.255", "Enter the tax rate with at most two decimal places, like 8.25."],
    ["defaultTaxRate", "abc", "Enter the tax rate with at most two decimal places, like 8.25."],
    ["defaultTaxRate", "100.01", "The tax rate must be between 0 and 100."],
    [
      "quotationValidityDays",
      "0",
      "The quotation validity must be a whole number of days from 1 to 90.",
    ],
    [
      "quotationValidityDays",
      "91",
      "The quotation validity must be a whole number of days from 1 to 90.",
    ],
    [
      "quotationValidityDays",
      "",
      "The quotation validity must be a whole number of days from 1 to 90.",
    ],
    [
      "invoiceDueDays",
      "-1",
      "The invoice payment term must be a whole number of days from 0 to 90.",
    ],
    [
      "invoiceDueDays",
      "1.5",
      "The invoice payment term must be a whole number of days from 0 to 90.",
    ],
    [
      "defaultQuotationTerms",
      "x".repeat(2001),
      "The quotation terms must be 2000 characters or fewer.",
    ],
    [
      "paymentInstructions",
      "x".repeat(1001),
      "The payment instructions must be 1000 characters or fewer.",
    ],
    ["invoiceFooter", "x".repeat(501), "The invoice footer must be 500 characters or fewer."],
  ] as const)("flags %s %j", (field, value, message) => {
    expect(errorsFor({ [field]: value })[field]).toBe(message);
  });

  it("accepts the boundary values", () => {
    expect(
      errorsFor({ defaultTaxRate: "100", quotationValidityDays: "90", invoiceDueDays: "0" }),
    ).toEqual({});
    expect(
      errorsFor({ defaultTaxRate: "0", quotationValidityDays: "1", invoiceDueDays: "90" }),
    ).toEqual({});
  });

  it("needs a bundled logo when 'bundled' is chosen and an https address when 'url' is", () => {
    expect(errorsFor({ logoSource: "bundled", logoKey: "" }).logoKey).toBe("Choose a logo.");
    expect(errorsFor({ logoSource: "url", logoUrl: "http://example.test/logo.png" }).logoUrl).toBe(
      "Enter a web address starting with https://",
    );
    expect(errorsFor({ logoSource: "url", logoUrl: "https://cdn.example.test/logo.svg" })).toEqual(
      {},
    );
    // Left-over text in the hidden box is not sent, so it is not checked.
    expect(errorsFor({ logoSource: "none", logoKey: "", logoUrl: "garbage" })).toEqual({});
  });
});

describe("settingsToFormValues and toSettingsBody", () => {
  it("shows missing optional values as empty boxes and picks the logo source", () => {
    const values = settingsToFormValues({
      ...SETTINGS,
      tagline: null,
      addressLine2: null,
      region: null,
      logoKey: null,
      logoUrl: "https://cdn.example.test/logo.svg",
    });
    expect(values).toMatchObject({
      tagline: "",
      addressLine2: "",
      region: "",
      logoSource: "url",
      logoKey: "",
      logoUrl: "https://cdn.example.test/logo.svg",
    });
    expect(settingsToFormValues({ ...SETTINGS, logoKey: null }).logoSource).toBe("none");
    expect(settingsToFormValues(SETTINGS).logoSource).toBe("bundled");
  });

  it("sends back exactly what it was given: no change is no difference", () => {
    // `updatedAt` and `identityLocked` describe the record and the caller: neither is ever sent back.
    const { updatedAt: _updatedAt, identityLocked: _identityLocked, ...editable } = SETTINGS;
    expect(toSettingsBody(settingsToFormValues(SETTINGS))).toEqual(editable);
  });

  it("converts day counts to numbers, keeps the tax rate as text and blanks to null", () => {
    const body = toSettingsBody({
      ...settingsToFormValues(SETTINGS),
      quotationValidityDays: " 30 ",
      invoiceDueDays: "0",
      defaultTaxRate: " 7.5 ",
      tagline: "   ",
      invoiceFooter: "",
    });
    expect(body).toMatchObject({
      quotationValidityDays: 30,
      invoiceDueDays: 0,
      defaultTaxRate: "7.5",
      tagline: null,
      invoiceFooter: null,
    });
    expect(typeof body.defaultTaxRate).toBe("string");
  });

  it("sends only the logo source that is chosen", () => {
    const base = settingsToFormValues(SETTINGS);
    expect(toSettingsBody({ ...base, logoSource: "none" })).toMatchObject({
      logoKey: null,
      logoUrl: null,
    });
    expect(
      toSettingsBody({
        ...base,
        logoSource: "url",
        logoUrl: " https://cdn.example.test/logo.svg ",
      }),
    ).toMatchObject({ logoKey: null, logoUrl: "https://cdn.example.test/logo.svg" });
  });
});

describe("groupTimeZones", () => {
  const GROUPS = groupTimeZones([
    "Africa/Cairo",
    "America/Argentina/Buenos_Aires",
    "America/New_York",
    "America/Toronto",
    "Asia/Colombo",
    "UTC",
  ]);

  it("groups by region, alphabetically, with the names that have no region last", () => {
    expect(GROUPS.map((group) => group.region)).toEqual(["Africa", "America", "Asia", "Other"]);
  });

  it("keeps the IANA name as the value and writes the label for people", () => {
    expect(GROUPS.find((group) => group.region === "America")?.zones).toEqual([
      { value: "America/Argentina/Buenos_Aires", label: "Argentina / Buenos Aires" },
      { value: "America/New_York", label: "New York" },
      { value: "America/Toronto", label: "Toronto" },
    ]);
    expect(GROUPS.at(-1)?.zones).toEqual([{ value: "UTC", label: "UTC" }]);
  });

  it("loses no zone and adds none", () => {
    const real = Intl.supportedValuesOf("timeZone");
    const grouped = groupTimeZones(real).flatMap((group) => group.zones.map((zone) => zone.value));
    expect(grouped.sort()).toEqual([...real].sort());
  });

  it("returns nothing for nothing", () => {
    expect(groupTimeZones([])).toEqual([]);
  });
});
