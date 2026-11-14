/**
 * Business settings as the API serves them (FR-100, D-01). There is exactly one business, so there
 * is no id: the record is "the settings". Two shapes exist on purpose, like every other record:
 * the public one holds only what a visitor to the website may read, the admin one holds everything
 * the business can configure.
 */

/** `GET /settings/public` (no sign-in). Nothing internal: no tax rate, terms or who edited it. */
export interface PublicSettingsDto {
  businessName: string;
  tagline: string | null;
  /** A bundled logo (see `BUNDLED_LOGOS`) or `null`. At most one of `logoKey` and `logoUrl` is set. */
  logoKey: string | null;
  /** An `https://` address shown on web pages only, or `null`. */
  logoUrl: string | null;
  contactEmail: string;
  phone: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    region: string | null;
    postalCode: string;
  };
  serviceAreaDescription: string | null;
  /** ISO 4217, two-decimal currencies only (D-18). */
  currencyCode: string;
  /** IANA time zone; every business date is shown and computed in it (BR-17). */
  timeZone: string;
}

/** `GET` and `PATCH /admin/settings`: every editable field, flat. */
export interface AdminSettingsDto {
  businessName: string;
  tagline: string | null;
  logoKey: string | null;
  logoUrl: string | null;
  contactEmail: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  serviceAreaDescription: string | null;
  currencyCode: string;
  timeZone: string;
  /** Percentage as a decimal string with two places: `"8.00"` means 8 %. */
  defaultTaxRate: string;
  quotationValidityDays: number;
  invoiceDueDays: number;
  defaultQuotationTerms: string | null;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
  /** ISO 8601 instant of the last change. */
  updatedAt: string;
  /**
   * True when the signed-in admin is the shared demo admin of the public demo (T24, Q-11): the fields
   * in {@link IDENTITY_SETTINGS_FIELDS} cannot be changed by this account, so what the public website
   * says about the business cannot be rewritten by whoever holds the published credentials. Not a
   * setting: the server works it out from the caller and the demo mode.
   */
  identityLocked: boolean;
}

/** The fields a `PATCH /admin/settings` may change, as named in activity events. */
export type AdminSettingsField = Exclude<keyof AdminSettingsDto, "updatedAt" | "identityLocked">;

/**
 * What the public website shows about the business: its name, tagline, logo, contact details, address
 * and service area. In the public demo these are locked for the shared demo admin (Q-11, D-112); every
 * other setting stays editable and is put back by the demo reset.
 */
export const IDENTITY_SETTINGS_FIELDS = [
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
] as const satisfies readonly AdminSettingsField[];
