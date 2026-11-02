import {
  ADMIN_TECHNICIAN_SORT_FIELDS,
  isValidCustomerPhone,
  LIMITS,
  normalizeCustomerPhone,
  TECHNICIAN_ACTIVE_FILTERS,
  TECHNICIAN_COLORS,
} from "@fixflow/shared";
import { z } from "zod";

import { normalizeEmail } from "../../lib/email-address.js";
import { createPaginationSchema } from "../../lib/pagination.js";
import { optionalText, requiredText } from "../../lib/zod-fields.js";
import { tidySpecialties } from "./technicians.domain.js";

const T = LIMITS.technician;

const name = requiredText("name", {
  min: LIMITS.personName.minLength,
  max: LIMITS.personName.maxLength,
});

/**
 * A phone number as people type it, tidied for storage. Blank or `null` clears it. It is the rule of
 * the customer's own number (`isValidCustomerPhone`), which the web form runs too.
 */
const phone = z
  .string({ error: "Enter the phone number, or leave it empty." })
  .transform(normalizeCustomerPhone)
  .refine(
    (value) => value === "" || isValidCustomerPhone(value),
    "Enter a phone number with 7 to 15 digits, like (212) 555-0151 or +44 20 7946 0958. Use only digits, spaces, + - and brackets.",
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

/** An email address, stored trimmed and lower-case like every other one. Blank or `null` clears it. */
const email = z
  .string({ error: "Enter the email address, or leave it empty." })
  .trim()
  .max(LIMITS.email.maxLength, "The email address is too long.")
  .transform(normalizeEmail)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address, like name@example.com.",
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

/**
 * Up to eight short tags. Spaces inside a tag are tidied and a tag that repeats another (ignoring
 * case) is dropped, keeping the first spelling and the order entered.
 */
const specialties = z
  .array(requiredText("specialty", { max: T.specialties.itemMaxLength }), {
    error: "Enter the specialties as a list.",
  })
  .max(T.specialties.maxItems, `Add no more than ${T.specialties.maxItems} specialties.`)
  .transform(tidySpecialties);

/** Internal notes: staff see them, customers never do. */
const notes = optionalText("notes", { max: T.notes.maxLength, multiline: true });

const calendarColor = z.enum(TECHNICIAN_COLORS, "Choose one of the available colours.");

/**
 * `POST /admin/technicians` (FR-060). Strict: `isActive` and the id are not the caller's to send
 * (a new technician is active; the id is made here). Without a colour the technician is given the
 * one the fewest others have.
 */
export const createTechnicianBodySchema = z.strictObject({
  name,
  phone: phone.default(null),
  email: email.default(null),
  specialties: specialties.default([]),
  notes: notes.default(null),
  calendarColor: calendarColor.optional(),
});

export type CreateTechnicianInput = z.output<typeof createTechnicianBodySchema>;

/**
 * `PATCH /admin/technicians/:id`. Any subset of the fields. Strict, so `isActive` is refused with
 * `422`: a technician is deactivated and reactivated through their own endpoints, which record who
 * did it.
 */
export const updateTechnicianBodySchema = z
  .strictObject({ name, phone, email, specialties, notes, calendarColor })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field to change.",
  });

export type UpdateTechnicianInput = z.output<typeof updateTechnicianBodySchema>;

export const technicianIdParamsSchema = z.object({
  id: z.uuid({ error: "The technician id must be a valid id." }),
});

/**
 * `GET /admin/technicians?active=true&q=jordan&page=2`. `active` is `true`, `false` or `all` (the
 * same as leaving it out). `q` finds a name, an email address, a phone number or a specialty,
 * ignoring case; blank means no search, and runs of spaces count as one.
 */
export const adminTechniciansQuerySchema = createPaginationSchema({
  sortFields: ADMIN_TECHNICIAN_SORT_FIELDS,
  defaultSort: "name",
  defaultOrder: "asc",
}).extend({
  active: z
    .enum(
      TECHNICIAN_ACTIVE_FILTERS,
      `active must be one of: ${TECHNICIAN_ACTIVE_FILTERS.join(", ")}.`,
    )
    .optional(),
  q: z
    .string({ error: "q must be a single piece of text." })
    .trim()
    .max(T.search.maxLength, `q must be ${T.search.maxLength} characters or fewer.`)
    .transform((value) => (value === "" ? undefined : value.replace(/\s+/g, " ")))
    .optional(),
});

export type AdminTechniciansQuery = z.output<typeof adminTechniciansQuerySchema>;
