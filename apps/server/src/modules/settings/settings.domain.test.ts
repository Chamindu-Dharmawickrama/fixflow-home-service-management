import { describe, expect, it } from "vitest";

import { DEMO_SETTINGS } from "../../db/seed-data.js";
import {
  changedSettingsFields,
  isTaxRateInRange,
  isValidPhone,
  isValidPostalCode,
  logoConflict,
  SETTINGS_FIELDS,
  type SettingsValues,
} from "./settings.domain.js";

const CURRENT: SettingsValues = {
  businessName: DEMO_SETTINGS.businessName,
  tagline: DEMO_SETTINGS.tagline,
  logoKey: null,
  logoUrl: null,
  contactEmail: DEMO_SETTINGS.contactEmail,
  phone: DEMO_SETTINGS.phone,
  addressLine1: DEMO_SETTINGS.addressLine1,
  addressLine2: DEMO_SETTINGS.addressLine2,
  city: DEMO_SETTINGS.city,
  region: DEMO_SETTINGS.region,
  postalCode: DEMO_SETTINGS.postalCode,
  serviceAreaDescription: DEMO_SETTINGS.serviceAreaDescription,
  currencyCode: DEMO_SETTINGS.currencyCode,
  timeZone: DEMO_SETTINGS.timeZone,
  defaultTaxRate: DEMO_SETTINGS.defaultTaxRate,
  quotationValidityDays: DEMO_SETTINGS.quotationValidityDays,
  invoiceDueDays: DEMO_SETTINGS.invoiceDueDays,
  defaultQuotationTerms: DEMO_SETTINGS.defaultQuotationTerms,
  paymentInstructions: DEMO_SETTINGS.paymentInstructions,
  invoiceFooter: DEMO_SETTINGS.invoiceFooter,
};

describe("isValidPhone", () => {
  it.each([
    "(212) 555-0142",
    "212-555-0142",
    "212.555.0142",
    "+44 20 7946 0000",
    "+94 11 234 5678",
    "5550142",
    "+1 (212) 555-0142",
  ])("accepts %s", (value) => {
    expect(isValidPhone(value)).toBe(true);
  });

  it.each([
    ["too few digits", "555-01"],
    ["too many digits", "+1 2345 6789 0123 4567"],
    ["letters", "212-CALL-NOW"],
    ["an extension", "212 555 0142 ext 5"],
    ["a plus sign in the middle", "212+555 0142"],
    ["only punctuation", "() - ."],
    ["an empty string", ""],
    ["markup", "<b>212 555 0142</b>"],
    ["more than 30 characters", "212 555 0142                       "],
  ])("rejects %s", (_name, value) => {
    expect(isValidPhone(value)).toBe(false);
  });
});

describe("isValidPostalCode", () => {
  it.each(["10999", "SW1A 1AA", "K1A-0B1", "00100"])("accepts %s", (value) => {
    expect(isValidPostalCode(value)).toBe(true);
  });

  it.each(["", " 10999", "-10999", "109<99", "10999!"])("rejects %j", (value) => {
    expect(isValidPostalCode(value)).toBe(false);
  });
});

describe("isTaxRateInRange", () => {
  it.each(["0", "0.00", "8.00", "99.99", "100", "100.00", "100.0"])("accepts %s", (value) => {
    expect(isTaxRateInRange(value)).toBe(true);
  });

  it.each(["100.01", "100.10", "101", "150.00", "999"])("rejects %s", (value) => {
    expect(isTaxRateInRange(value)).toBe(false);
  });
});

describe("changedSettingsFields", () => {
  it("names only the fields whose value differs, in form order", () => {
    expect(
      changedSettingsFields(CURRENT, { phone: "(212) 555-0199", businessName: "CoolBreeze Co." }),
    ).toEqual(["businessName", "phone"]);
  });

  it("treats a field sent with its current value as no change", () => {
    expect(
      changedSettingsFields(CURRENT, {
        businessName: CURRENT.businessName,
        defaultTaxRate: CURRENT.defaultTaxRate,
        tagline: CURRENT.tagline,
      }),
    ).toEqual([]);
  });

  it("ignores fields that are not sent, and sees null as a change from text", () => {
    expect(changedSettingsFields(CURRENT, {})).toEqual([]);
    expect(changedSettingsFields(CURRENT, { tagline: undefined })).toEqual([]);
    expect(changedSettingsFields(CURRENT, { tagline: null })).toEqual(["tagline"]);
  });

  it("reports a number that changed", () => {
    expect(changedSettingsFields(CURRENT, { invoiceDueDays: 30 })).toEqual(["invoiceDueDays"]);
    expect(changedSettingsFields(CURRENT, { invoiceDueDays: CURRENT.invoiceDueDays })).toEqual([]);
  });

  it("only ever names fields from the closed list", () => {
    const everything = Object.fromEntries(
      SETTINGS_FIELDS.map((field) => [field, field === "invoiceDueDays" ? 1 : "changed"]),
    );
    expect(changedSettingsFields(CURRENT, everything)).toEqual([...SETTINGS_FIELDS]);
  });
});

describe("logoConflict", () => {
  it("allows a bundled logo, a web address, or none", () => {
    expect(logoConflict({ logoKey: "breeze", logoUrl: null })).toBeNull();
    expect(logoConflict({ logoKey: null, logoUrl: "https://example.test/a.png" })).toBeNull();
    expect(logoConflict({ logoKey: null, logoUrl: null })).toBeNull();
  });

  it("refuses both at once", () => {
    expect(logoConflict({ logoKey: "breeze", logoUrl: "https://example.test/a.png" })).toBe(
      "Choose either a bundled logo or a web address, not both.",
    );
  });
});
