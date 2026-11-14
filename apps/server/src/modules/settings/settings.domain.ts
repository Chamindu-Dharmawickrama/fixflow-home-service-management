import {
  type AdminSettingsDto,
  type AdminSettingsField,
  IDENTITY_SETTINGS_FIELDS,
} from "@fixflow/shared";

import { isDemoAccountEmail } from "../auth/auth.domain.js";

/**
 * Pure rules for the business settings (FR-100): which fields exist, what a valid phone number,
 * postal code and tax rate look like, and which fields a change touches. No database, no HTTP.
 */

/**
 * Everything the business can configure, as stored (`updatedAt` is set by the database, and
 * `identityLocked` is worked out from the caller).
 */
export type SettingsValues = Omit<AdminSettingsDto, "updatedAt" | "identityLocked">;

/** A `PATCH`: any subset of the settings. `null` clears an optional field. */
export type SettingsPatch = { [Field in keyof SettingsValues]?: SettingsValues[Field] | undefined };

/** The fields in the order the form shows them; also the allowlist of names an activity event may carry. */
export const SETTINGS_FIELDS = [
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
] as const satisfies readonly AdminSettingsField[];

// The format checks live in `@fixflow/shared`, where the settings form uses the same functions.
export { isTaxRateInRange, isValidPhone, isValidPostalCode } from "@fixflow/shared";

/**
 * The names of the settings a patch would actually change, in form order. A field that is sent with
 * the value it already has is not a change, so saving an untouched form records nothing.
 */
export function changedSettingsFields(
  current: SettingsValues,
  patch: SettingsPatch,
): AdminSettingsField[] {
  return SETTINGS_FIELDS.filter(
    (field) => patch[field] !== undefined && patch[field] !== current[field],
  );
}

/**
 * The identity fields a change would alter (T24, Q-11): what the public website shows about the
 * business. Only fields whose value really differs count, so saving a form that repeats the stored
 * name is not a change.
 */
export function changedIdentityFields(
  current: SettingsValues,
  patch: SettingsPatch,
): AdminSettingsField[] {
  const identity: readonly AdminSettingsField[] = IDENTITY_SETTINGS_FIELDS;
  return changedSettingsFields(current, patch).filter((field) => identity.includes(field));
}

/**
 * True when the identity fields are locked for this caller: the public demo is on and the caller is one
 * of the shared demo accounts (T24, Q-11). Any other admin, such as the owner's own, is not locked.
 */
export function identityLockedFor(config: { auth: { demoMode: boolean } }, email: string): boolean {
  return config.auth.demoMode && isDemoAccountEmail(email);
}

export const IDENTITY_LOCKED_MESSAGE =
  "In the public demo the business name, logo and contact details are locked, so what the website says about the business can't be rewritten. Your other settings can be changed.";

/** `null` when the logo choice is consistent; otherwise the message for the `logoUrl` field. */
export function logoConflict(values: Pick<SettingsValues, "logoKey" | "logoUrl">): string | null {
  return values.logoKey !== null && values.logoUrl !== null
    ? "Choose either a bundled logo or a web address, not both."
    : null;
}
