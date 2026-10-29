import {
  isBundledLogoKey,
  isSupportedCurrency,
  isSupportedTimeZone,
  LIMITS,
} from "@fixflow/shared";
import { z } from "zod";

import {
  emailAddress,
  optionalHttpsUrl,
  optionalKey,
  optionalText,
  requiredText,
  toTwoPlaces,
} from "../../lib/zod-fields.js";
import { isTaxRateInRange, isValidPhone, isValidPostalCode } from "./settings.domain.js";

const L = LIMITS.businessSettings;

function dayCount(label: string, { min, max }: { min: number; max: number }) {
  const message = `The ${label} must be a whole number of days from ${min} to ${max}.`;
  return z.number({ error: message }).int(message).min(min, message).max(max, message);
}

/** A percentage with at most two decimals, as text (`"8.25"`): money-like values are never JSON numbers. */
const taxRate = z
  .string({ error: "Enter the tax rate as a percentage, like 8.25." })
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter the tax rate with at most two decimal places, like 8.25.")
  .refine(isTaxRateInRange, "The tax rate must be between 0 and 100.")
  .transform(toTwoPlaces);

const logoKey = optionalKey(isBundledLogoKey, "Choose one of the available logos.");

/**
 * `PATCH /admin/settings` (FR-100). Every field is optional and the object is strict, so an unknown
 * key (`id`, `updatedByUserId`, ...) is rejected rather than ignored. A field that is sent replaces
 * the stored value; `null` (or a blank text) clears an optional one. Business-critical fields can
 * never be cleared: they are required whenever they are sent.
 */
export const updateSettingsBodySchema = z
  .strictObject({
    businessName: requiredText("business name", {
      min: L.businessName.minLength,
      max: L.businessName.maxLength,
    }),
    tagline: optionalText("tagline", { max: L.tagline.maxLength }),
    logoKey,
    logoUrl: optionalHttpsUrl("logo address", L.logoUrl.maxLength),
    contactEmail: emailAddress("contact email address"),
    phone: requiredText("phone number", { max: L.phone.maxLength }).refine(
      isValidPhone,
      "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0000.",
    ),
    addressLine1: requiredText("street address", { max: L.addressLine.maxLength }),
    addressLine2: optionalText("address line 2", { max: L.addressLine.maxLength }),
    city: requiredText("city", { max: L.city.maxLength }),
    region: optionalText("state or region", { max: L.region.maxLength }),
    postalCode: requiredText("postal code", { max: L.postalCode.maxLength }).refine(
      isValidPostalCode,
      "The postal code can only contain letters, numbers, spaces and hyphens.",
    ),
    serviceAreaDescription: optionalText("service area", {
      max: L.serviceArea.maxLength,
      multiline: true,
    }),
    currencyCode: z
      .string({ error: "Choose a currency." })
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(
        isSupportedCurrency,
        "Choose one of the supported currencies. Currencies without cents, like the yen, are not supported.",
      ),
    timeZone: z
      .string({ error: "Choose a time zone." })
      .trim()
      .refine(isSupportedTimeZone, "Choose a time zone from the list, like America/New_York."),
    defaultTaxRate: taxRate,
    quotationValidityDays: dayCount("quotation validity", L.quotationValidityDays),
    invoiceDueDays: dayCount("invoice payment term", L.invoiceDueDays),
    defaultQuotationTerms: optionalText("quotation terms", {
      max: L.quotationTerms.maxLength,
      multiline: true,
    }),
    paymentInstructions: optionalText("payment instructions", {
      max: L.paymentInstructions.maxLength,
      multiline: true,
    }),
    invoiceFooter: optionalText("invoice footer", {
      max: L.invoiceFooter.maxLength,
      multiline: true,
    }),
  })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one setting to change.",
  });

export type UpdateSettingsBody = z.output<typeof updateSettingsBodySchema>;
