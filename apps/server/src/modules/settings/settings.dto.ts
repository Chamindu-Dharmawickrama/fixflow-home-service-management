import type { AdminSettingsDto, PublicSettingsDto } from "@fixflow/shared";

import type { BusinessSettings } from "../../generated/prisma/client.js";
import type { SettingsValues } from "./settings.domain.js";

/**
 * Serializers for the business settings (CLAUDE.md §7: one function per audience, built field by
 * field so a column added to the table later is never exposed by accident). Neither shape carries
 * the row id or `updatedByUserId`.
 */

/** The editable values of a row, in the shape the admin API and the change check use. */
export function toSettingsValues(row: BusinessSettings): SettingsValues {
  return {
    businessName: row.businessName,
    tagline: row.tagline,
    logoKey: row.logoKey,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    serviceAreaDescription: row.serviceAreaDescription,
    currencyCode: row.currencyCode,
    timeZone: row.timeZone,
    defaultTaxRate: row.defaultTaxRate.toFixed(2),
    quotationValidityDays: row.quotationValidityDays,
    invoiceDueDays: row.invoiceDueDays,
    defaultQuotationTerms: row.defaultQuotationTerms,
    paymentInstructions: row.paymentInstructions,
    invoiceFooter: row.invoiceFooter,
  };
}

export function toAdminSettingsDto(row: BusinessSettings): AdminSettingsDto {
  return { ...toSettingsValues(row), updatedAt: row.updatedAt.toISOString() };
}

export function toPublicSettingsDto(row: BusinessSettings): PublicSettingsDto {
  return {
    businessName: row.businessName,
    tagline: row.tagline,
    logoKey: row.logoKey,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail,
    phone: row.phone,
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
    },
    serviceAreaDescription: row.serviceAreaDescription,
    currencyCode: row.currencyCode,
    timeZone: row.timeZone,
  };
}
