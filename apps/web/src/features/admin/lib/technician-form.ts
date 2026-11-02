import {
  type AdminTechnicianDto,
  type CreateTechnicianBody,
  isValidCustomerPhone,
  LIMITS,
  normalizeCustomerPhone,
  TECHNICIAN_COLORS,
  type TechnicianColor,
} from "@fixflow/shared";
import { z } from "zod";

/**
 * The technician form: its values, the checks that give feedback beside each field, and the
 * translation to the API. The checks only save a round trip; the API applies the same rules again
 * and is the authority (CLAUDE.md §7).
 */

const T = LIMITS.technician;
const NAME = LIMITS.personName;

export const technicianFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the name.")
    .refine(
      (value) => value.length === 0 || value.length >= NAME.minLength,
      `The name must be at least ${String(NAME.minLength)} characters.`,
    )
    .max(NAME.maxLength, `The name must be ${String(NAME.maxLength)} characters or fewer.`),
  phone: z
    .string()
    .refine(
      (value) =>
        normalizeCustomerPhone(value) === "" || isValidCustomerPhone(normalizeCustomerPhone(value)),
      "Enter a phone number with 7 to 15 digits, like (212) 555-0151. Use only digits, spaces, + - and brackets.",
    ),
  email: z
    .string()
    .trim()
    .max(LIMITS.email.maxLength, "The email address is too long.")
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "Enter a valid email address, like name@example.com.",
    ),
  specialties: z
    .array(
      z
        .string()
        .max(
          T.specialties.itemMaxLength,
          `A specialty must be ${String(T.specialties.itemMaxLength)} characters or fewer.`,
        ),
    )
    .max(T.specialties.maxItems, `Add no more than ${String(T.specialties.maxItems)} specialties.`),
  /**
   * What has been typed in the "add a specialty" box and not yet added. It is part of the form so
   * that saving takes it along (a tag typed but not added is not silently lost) and so that leaving
   * the form warns about it; it is never sent as such.
   */
  specialtyDraft: z.string(),
  notes: z
    .string()
    .trim()
    .max(T.notes.maxLength, `The notes must be ${String(T.notes.maxLength)} characters or fewer.`),
  calendarColor: z.enum(TECHNICIAN_COLORS, "Choose a colour."),
});

/** Text as an input holds it, the specialties as a list, the colour as a palette key. */
export type TechnicianFormValues = z.input<typeof technicianFormSchema>;

/** A blank form for a new technician, offered the colour the fewest others have. */
export function emptyTechnicianValues(calendarColor: TechnicianColor): TechnicianFormValues {
  return {
    name: "",
    phone: "",
    email: "",
    specialties: [],
    specialtyDraft: "",
    notes: "",
    calendarColor,
  };
}

export function technicianToFormValues(technician: AdminTechnicianDto): TechnicianFormValues {
  return {
    name: technician.name,
    phone: technician.phone ?? "",
    email: technician.email ?? "",
    specialties: [...technician.specialties],
    specialtyDraft: "",
    notes: technician.notes ?? "",
    calendarColor: technician.calendarColor,
  };
}

/** What the API takes for a technician (`POST`, and in part `PATCH`): every field, blanks as `null`. */
export type TechnicianBody = Required<CreateTechnicianBody>;

const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function toTechnicianBody(values: TechnicianFormValues): TechnicianBody {
  return {
    name: values.name.trim(),
    phone: orNull(normalizeCustomerPhone(values.phone)),
    email: orNull(values.email.toLowerCase()),
    specialties: values.specialties.map((tag) => tag.trim()).filter((tag) => tag !== ""),
    notes: orNull(values.notes),
    calendarColor: values.calendarColor,
  };
}

/** The labels the error summary and screen readers use for each field. */
export const TECHNICIAN_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  phone: "Phone number",
  email: "Email address",
  specialties: "Specialties",
  notes: "Notes",
  calendarColor: "Calendar colour",
};

/**
 * The form field an API error belongs to. The specialties are one control, so an error against one
 * tag (`specialties.3`) is shown on the group.
 */
export function formFieldForApiError(field: string): string {
  return field.startsWith("specialties.") ? "specialties" : field;
}

// ---- Adding specialties ----------------------------------------------------------------------

export interface AddedSpecialties {
  /** The list with every acceptable tag added. */
  tags: string[];
  /** Why the first unacceptable tag was left out, or `null` when all were added. */
  problem: string | null;
  /** The tags that could not be added, as text for the box to keep so they can be put right. */
  rest: string;
}

/**
 * Adds what was typed to the list of specialties. A comma (or a new line, from a paste) separates
 * several tags. Spaces inside a tag become one, a tag that is already in the list (ignoring case) is
 * not added twice, and the limits on the number and the length of tags are kept. The tags that could
 * be added are added; the first one that could not says why, and `rest` holds the ones left over.
 */
export function addSpecialties(current: readonly string[], typed: string): AddedSpecialties {
  const tags = [...current];
  const left: string[] = [];
  let problem: string | null = null;

  for (const part of typed.split(/[,\n]/)) {
    const tag = part.replace(/\s+/g, " ").trim();
    if (tag === "") continue;
    if (tags.length >= T.specialties.maxItems) {
      problem ??= `You can add up to ${String(T.specialties.maxItems)} specialties.`;
      left.push(tag);
    } else if (tag.length > T.specialties.itemMaxLength) {
      problem ??= `A specialty can be up to ${String(T.specialties.itemMaxLength)} characters.`;
      left.push(tag);
    } else if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      problem ??= `“${tag}” is already in the list.`;
      left.push(tag);
    } else {
      tags.push(tag);
    }
  }
  return { tags, problem, rest: left.join(", ") };
}
