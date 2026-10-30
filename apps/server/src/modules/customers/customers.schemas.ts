import {
  isValidCustomerPhone,
  isValidPostalCode,
  LIMITS,
  normalizeCustomerPhone,
} from "@fixflow/shared";
import { z } from "zod";

import { optionalText, requiredText } from "../../lib/zod-fields.js";

const A = LIMITS.address;

/**
 * A phone number as people type it, tidied for storage (`normalizeCustomerPhone`). Blank or `null`
 * clears it. The web form runs the same functions, so what it accepts and what the API accepts
 * cannot drift apart.
 */
const phone = z
  .string({ error: "Enter your phone number, or leave it empty." })
  .transform(normalizeCustomerPhone)
  .refine(
    (value) => value === "" || isValidCustomerPhone(value),
    "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0958. Use only digits, spaces, + - and brackets.",
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

/**
 * `PATCH /customers/me` (FR-013, FR-014). Only these two fields can be changed; the object is
 * strict, so `role`, `email`, `userId`, `isActive` and every other key are rejected with `422`
 * rather than silently ignored. The email address is shown but cannot be changed (D-39).
 */
export const updateProfileBodySchema = z
  .strictObject({
    name: requiredText("name", {
      min: LIMITS.personName.minLength,
      max: LIMITS.personName.maxLength,
    }),
    phone,
  })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one detail to change.",
  });

export type UpdateProfileBody = z.output<typeof updateProfileBodySchema>;

const addressFields = {
  label: requiredText("label", { min: A.label.minLength, max: A.label.maxLength }),
  line1: requiredText("street address", { max: A.line.maxLength }),
  line2: optionalText("address line 2", { max: A.line.maxLength }),
  city: requiredText("city", { max: A.city.maxLength }),
  region: optionalText("state or region", { max: A.region.maxLength }),
  postalCode: requiredText("postal code", { max: A.postalCode.maxLength }).refine(
    isValidPostalCode,
    "The postal code can only contain letters, numbers, spaces and hyphens.",
  ),
  accessNotes: optionalText("access notes", { max: A.accessNotes.maxLength, multiline: true }),
};

/**
 * `POST /customers/me/addresses`. Strict: the owner (`customerId`) comes from the session and
 * whether the address is the default is decided by the server (the first one is; `.../default`
 * changes it), so neither can be sent.
 */
export const createAddressBodySchema = z.strictObject({
  label: addressFields.label,
  line1: addressFields.line1,
  line2: addressFields.line2.optional(),
  city: addressFields.city,
  region: addressFields.region.optional(),
  postalCode: addressFields.postalCode,
  accessNotes: addressFields.accessNotes.optional(),
});

export type CreateAddressBody = z.output<typeof createAddressBodySchema>;

/**
 * `PATCH /customers/me/addresses/:id`. Every field is optional; the ones that are sent replace the
 * stored value, and `null` (or blank text) clears an optional one. The required fields can never be
 * cleared.
 */
export const updateAddressBodySchema = z
  .strictObject(addressFields)
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one detail to change.",
  });

export type UpdateAddressBody = z.output<typeof updateAddressBodySchema>;

export const addressIdParamsSchema = z.object({
  id: z.uuid("The address id must be a valid id."),
});
