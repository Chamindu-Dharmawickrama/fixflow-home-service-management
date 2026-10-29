import { describe, expect, it } from "vitest";

import { DEMO_SETTINGS } from "../../db/seed-data.js";
import type { BusinessSettings } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID } from "../../lib/db.js";
import { toAdminSettingsDto, toPublicSettingsDto } from "./settings.dto.js";

const ROW: BusinessSettings = {
  id: BUSINESS_SETTINGS_ID,
  ...DEMO_SETTINGS,
  logoKey: "breeze",
  logoUrl: null,
  defaultTaxRate: new Prisma.Decimal("8"),
  updatedAt: new Date("2026-10-29T10:00:00.000Z"),
  updatedByUserId: "6f0f3a4e-1f0e-4b0c-8f0a-0b2f8f3f9a11",
};

/** Exactly what a visitor may read; a new column on the table must not appear here by itself. */
const PUBLIC_KEYS = [
  "address",
  "businessName",
  "contactEmail",
  "currencyCode",
  "logoKey",
  "logoUrl",
  "phone",
  "serviceAreaDescription",
  "tagline",
  "timeZone",
];

describe("toPublicSettingsDto", () => {
  it("has exactly the public keys", () => {
    expect(Object.keys(toPublicSettingsDto(ROW)).sort()).toEqual(PUBLIC_KEYS);
    expect(Object.keys(toPublicSettingsDto(ROW).address).sort()).toEqual([
      "city",
      "line1",
      "line2",
      "postalCode",
      "region",
    ]);
  });

  it("never carries an internal field, whatever the row holds", () => {
    const json = JSON.stringify(toPublicSettingsDto(ROW));
    for (const hidden of [
      "updatedByUserId",
      ROW.updatedByUserId ?? "",
      BUSINESS_SETTINGS_ID,
      "defaultTaxRate",
      "quotationValidityDays",
      "invoiceDueDays",
      "defaultQuotationTerms",
      "paymentInstructions",
      "invoiceFooter",
      "updatedAt",
    ]) {
      expect(json, hidden).not.toContain(hidden);
    }
  });

  it("nests the address and keeps the business basics", () => {
    expect(toPublicSettingsDto(ROW)).toMatchObject({
      businessName: "CoolBreeze Home Services",
      address: { line1: "48 Harbor Point Road", city: "Harbor City", postalCode: "10999" },
      currencyCode: "USD",
      timeZone: "America/New_York",
    });
  });
});

describe("toAdminSettingsDto", () => {
  it("has every editable field plus updatedAt, and no id or editor", () => {
    const dto = toAdminSettingsDto(ROW);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "businessName",
        "tagline",
        "logoKey",
        "logoUrl",
        "contactEmail",
        "phone",
        "addressLine1",
        "addressLine2",
        "city",
        "region",
        "postalCode",
        "serviceAreaDescription",
        "currencyCode",
        "timeZone",
        "defaultTaxRate",
        "quotationValidityDays",
        "invoiceDueDays",
        "defaultQuotationTerms",
        "paymentInstructions",
        "invoiceFooter",
        "updatedAt",
      ].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("updatedByUserId");
    expect(JSON.stringify(dto)).not.toContain(BUSINESS_SETTINGS_ID);
  });

  it("serializes the tax rate as a two-decimal string and the time as ISO 8601 UTC", () => {
    const dto = toAdminSettingsDto(ROW);
    expect(dto.defaultTaxRate).toBe("8.00");
    expect(dto.updatedAt).toBe("2026-10-29T10:00:00.000Z");
    expect(typeof dto.quotationValidityDays).toBe("number");
  });
});
