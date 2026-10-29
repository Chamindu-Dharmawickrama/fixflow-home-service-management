import {
  type AdminSettingsDto,
  isHttpsUrl,
  isSupportedCurrency,
  isTaxRateInRange,
  isValidPhone,
  isValidPostalCode,
  LIMITS,
} from "@fixflow/shared";
import { z } from "zod";

/**
 * The business settings form: its values, the checks that give feedback beside each field, and the
 * translation to the API. The checks only save a round trip; the API applies the same rules again
 * and is the authority (CLAUDE.md §7).
 */

const L = LIMITS.businessSettings;

export type LogoSource = "none" | "bundled" | "url";

/** Everything is text, as an input holds it; the day counts are converted when the form is sent. */
export interface SettingsFormValues {
  businessName: string;
  tagline: string;
  logoSource: LogoSource;
  logoKey: string;
  logoUrl: string;
  contactEmail: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  serviceAreaDescription: string;
  currencyCode: string;
  timeZone: string;
  defaultTaxRate: string;
  quotationValidityDays: string;
  defaultQuotationTerms: string;
  invoiceDueDays: string;
  paymentInstructions: string;
  invoiceFooter: string;
}

const required = (label: string, max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .refine(
      (value) => value.length === 0 || value.length >= min,
      `The ${label} must be at least ${min} characters.`,
    )
    .max(max, `The ${label} must be ${max} characters or fewer.`);

const optional = (label: string, max: number) =>
  z.string().trim().max(max, `The ${label} must be ${max} characters or fewer.`);

const wholeDays = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max,
      `The ${label} must be a whole number of days from ${min} to ${max}.`,
    );

export const settingsFormSchema = z
  .object({
    businessName: required("business name", L.businessName.maxLength, L.businessName.minLength),
    tagline: optional("tagline", L.tagline.maxLength),
    logoSource: z.enum(["none", "bundled", "url"]),
    logoKey: z.string(),
    logoUrl: z
      .string()
      .trim()
      .max(
        L.logoUrl.maxLength,
        `The logo address must be ${L.logoUrl.maxLength} characters or fewer.`,
      ),
    contactEmail: z
      .string()
      .trim()
      .min(1, "Enter the contact email address.")
      .max(LIMITS.email.maxLength, "The contact email address is too long.")
      .refine(
        (value) => value === "" || z.email().safeParse(value).success,
        "Enter a valid contact email address, like name@example.com.",
      ),
    phone: z
      .string()
      .trim()
      .min(1, "Enter the phone number.")
      .refine(
        (value) => value === "" || isValidPhone(value),
        "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0000.",
      ),
    addressLine1: required("street address", L.addressLine.maxLength),
    addressLine2: optional("address line 2", L.addressLine.maxLength),
    city: required("city", L.city.maxLength),
    region: optional("state or region", L.region.maxLength),
    postalCode: required("postal code", L.postalCode.maxLength).refine(
      (value) => value === "" || isValidPostalCode(value),
      "The postal code can only contain letters, numbers, spaces and hyphens.",
    ),
    serviceAreaDescription: optional("service area", L.serviceArea.maxLength),
    currencyCode: z.string().refine(isSupportedCurrency, "Choose one of the supported currencies."),
    timeZone: z.string().min(1, "Choose a time zone."),
    defaultTaxRate: z
      .string()
      .trim()
      .min(1, "Enter the tax rate as a percentage, like 8.25.")
      .refine(
        (value) => value === "" || /^\d{1,3}(\.\d{1,2})?$/.test(value),
        "Enter the tax rate with at most two decimal places, like 8.25.",
      )
      .refine(
        (value) => !/^\d{1,3}(\.\d{1,2})?$/.test(value) || isTaxRateInRange(value),
        "The tax rate must be between 0 and 100.",
      ),
    quotationValidityDays: wholeDays(
      "quotation validity",
      L.quotationValidityDays.min,
      L.quotationValidityDays.max,
    ),
    defaultQuotationTerms: optional("quotation terms", L.quotationTerms.maxLength),
    invoiceDueDays: wholeDays("invoice payment term", L.invoiceDueDays.min, L.invoiceDueDays.max),
    paymentInstructions: optional("payment instructions", L.paymentInstructions.maxLength),
    invoiceFooter: optional("invoice footer", L.invoiceFooter.maxLength),
  })
  .superRefine((values, ctx) => {
    if (values.logoSource === "bundled" && values.logoKey === "") {
      ctx.addIssue({ code: "custom", path: ["logoKey"], message: "Choose a logo." });
    }
    if (values.logoSource === "url" && !isHttpsUrl(values.logoUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["logoUrl"],
        message: "Enter a web address starting with https://",
      });
    }
  });

export function settingsToFormValues(settings: AdminSettingsDto): SettingsFormValues {
  return {
    businessName: settings.businessName,
    tagline: settings.tagline ?? "",
    logoSource: settings.logoKey !== null ? "bundled" : settings.logoUrl !== null ? "url" : "none",
    logoKey: settings.logoKey ?? "",
    logoUrl: settings.logoUrl ?? "",
    contactEmail: settings.contactEmail,
    phone: settings.phone,
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2 ?? "",
    city: settings.city,
    region: settings.region ?? "",
    postalCode: settings.postalCode,
    serviceAreaDescription: settings.serviceAreaDescription ?? "",
    currencyCode: settings.currencyCode,
    timeZone: settings.timeZone,
    defaultTaxRate: settings.defaultTaxRate,
    quotationValidityDays: String(settings.quotationValidityDays),
    defaultQuotationTerms: settings.defaultQuotationTerms ?? "",
    invoiceDueDays: String(settings.invoiceDueDays),
    paymentInstructions: settings.paymentInstructions ?? "",
    invoiceFooter: settings.invoiceFooter ?? "",
  };
}

/** The request body for `PATCH /admin/settings`: the API's own field names and types. */
export type SettingsRequestBody = Omit<AdminSettingsDto, "updatedAt">;

const blankToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function toSettingsBody(values: SettingsFormValues): SettingsRequestBody {
  return {
    businessName: values.businessName.trim(),
    tagline: blankToNull(values.tagline),
    logoKey: values.logoSource === "bundled" ? values.logoKey : null,
    logoUrl: values.logoSource === "url" ? values.logoUrl.trim() : null,
    contactEmail: values.contactEmail.trim(),
    phone: values.phone.trim(),
    addressLine1: values.addressLine1.trim(),
    addressLine2: blankToNull(values.addressLine2),
    city: values.city.trim(),
    region: blankToNull(values.region),
    postalCode: values.postalCode.trim(),
    serviceAreaDescription: blankToNull(values.serviceAreaDescription),
    currencyCode: values.currencyCode,
    timeZone: values.timeZone,
    defaultTaxRate: values.defaultTaxRate.trim(),
    quotationValidityDays: Number(values.quotationValidityDays.trim()),
    invoiceDueDays: Number(values.invoiceDueDays.trim()),
    defaultQuotationTerms: blankToNull(values.defaultQuotationTerms),
    paymentInstructions: blankToNull(values.paymentInstructions),
    invoiceFooter: blankToNull(values.invoiceFooter),
  };
}

export interface TimeZoneGroup {
  /** The part before the first slash: `America`, `Europe`; `Other` for names without one (`UTC`). */
  region: string;
  zones: { value: string; label: string }[];
}

/**
 * Groups IANA names by region for a long `<select>`: `America/Argentina/Buenos_Aires` becomes
 * "Argentina / Buenos Aires" under "America". Input order is kept within a group, and groups are
 * ordered by name with `Other` last.
 */
export function groupTimeZones(zones: readonly string[]): TimeZoneGroup[] {
  const groups = new Map<string, TimeZoneGroup>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const region = slash === -1 ? "Other" : zone.slice(0, slash);
    const rest = slash === -1 ? zone : zone.slice(slash + 1);
    const group = groups.get(region) ?? { region, zones: [] };
    group.zones.push({ value: zone, label: rest.replaceAll("_", " ").replaceAll("/", " / ") });
    groups.set(region, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.region === "Other" ? 1 : b.region === "Other" ? -1 : a.region.localeCompare(b.region, "en"),
  );
}
