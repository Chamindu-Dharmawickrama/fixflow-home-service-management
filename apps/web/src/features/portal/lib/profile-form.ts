import {
  type CustomerProfileDto,
  isValidCustomerPhone,
  LIMITS,
  normalizeCustomerPhone,
} from "@fixflow/shared";
import { z } from "zod";

/**
 * The "Contact details" form: its values, the checks that give feedback beside each field, and the
 * translation to the API. Only the name and the phone number can be changed; the email address is
 * shown but cannot be edited (D-39). The API applies the same rules again and is the authority.
 */

export const profileFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .refine(
      (value) => value.length === 0 || value.length >= LIMITS.personName.minLength,
      `Your name must be at least ${LIMITS.personName.minLength} characters.`,
    )
    .max(
      LIMITS.personName.maxLength,
      `Your name must be ${LIMITS.personName.maxLength} characters or fewer.`,
    ),
  phone: z.string().refine((value) => {
    const tidy = normalizeCustomerPhone(value);
    return tidy === "" || isValidCustomerPhone(tidy);
  }, "Enter a phone number with 7 to 15 digits, like (212) 555-0142 or +44 20 7946 0958. Use only digits, spaces, + - and brackets."),
});

export type ProfileFormValues = z.input<typeof profileFormSchema>;

export function profileToFormValues(
  profile: Pick<CustomerProfileDto, "name" | "phone">,
): ProfileFormValues {
  return { name: profile.name, phone: profile.phone ?? "" };
}

/** What `PATCH /customers/me` takes: only the fields that differ from what is saved. */
export interface ProfileBody {
  name?: string;
  phone?: string | null;
}

/** The fields of `values` that differ from the saved ones, as the API takes them. */
export function toProfileBody(saved: ProfileFormValues, values: ProfileFormValues): ProfileBody {
  const body: ProfileBody = {};
  const name = values.name.trim();
  if (name !== saved.name.trim()) {
    body.name = name;
  }
  const phone = normalizeCustomerPhone(values.phone);
  if (phone !== normalizeCustomerPhone(saved.phone)) {
    body.phone = phone === "" ? null : phone;
  }
  return body;
}
