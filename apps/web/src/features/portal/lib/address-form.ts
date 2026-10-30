import { isValidPostalCode, LIMITS, type ServiceAddressDto } from "@fixflow/shared";
import { z } from "zod";

/**
 * The address form: its values, the checks that give feedback beside each field, and the translation
 * to the API. The checks only save a round trip; the API applies the same rules again and is the
 * authority (CLAUDE.md §7).
 */

const A = LIMITS.address;

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

export const addressFormSchema = z.object({
  label: required("label", A.label.maxLength, A.label.minLength),
  line1: required("street address", A.line.maxLength),
  line2: optional("address line 2", A.line.maxLength),
  city: required("city", A.city.maxLength),
  region: optional("state or region", A.region.maxLength),
  postalCode: required("postal code", A.postalCode.maxLength).refine(
    (value) => value === "" || isValidPostalCode(value),
    "The postal code can only contain letters, numbers, spaces and hyphens.",
  ),
  accessNotes: optional("access notes", A.accessNotes.maxLength),
});

/** Everything is text, as an input holds it; blank optional fields become `null` when sent. */
export type AddressFormValues = z.input<typeof addressFormSchema>;

export const EMPTY_ADDRESS_VALUES: AddressFormValues = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  accessNotes: "",
};

/** What the API takes for an address (`POST` and, in part, `PATCH /customers/me/addresses`). */
export interface AddressBody {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  accessNotes: string | null;
}

export function addressToFormValues(address: ServiceAddressDto): AddressFormValues {
  return {
    label: address.label,
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    region: address.region ?? "",
    postalCode: address.postalCode,
    accessNotes: address.accessNotes ?? "",
  };
}

const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function toAddressBody(values: AddressFormValues): AddressBody {
  return {
    label: values.label.trim(),
    line1: values.line1.trim(),
    line2: orNull(values.line2),
    city: values.city.trim(),
    region: orNull(values.region),
    postalCode: values.postalCode.trim(),
    accessNotes: orNull(values.accessNotes),
  };
}

/**
 * The fields of `next` that differ from `saved`. An edit sends only these, so changing a gate code
 * cannot overwrite a street name that was corrected from another tab in the meantime.
 */
export function changedAddressFields(saved: AddressBody, next: AddressBody): Partial<AddressBody> {
  const changed: Partial<AddressBody> = {};
  for (const key of Object.keys(next) as (keyof AddressBody)[]) {
    if (saved[key] !== next[key]) {
      Object.assign(changed, { [key]: next[key] });
    }
  }
  return changed;
}

/** The labels the error summary and screen readers use for each field. */
export const ADDRESS_FIELD_LABELS: Record<string, string> = {
  label: "Label",
  line1: "Street address",
  line2: "Address line 2",
  city: "City",
  region: "State or region",
  postalCode: "Postal code",
  accessNotes: "Access notes",
};
