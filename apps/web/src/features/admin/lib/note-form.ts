import {
  type AddCustomerNoteBody,
  type AddRequestNoteBody,
  LIMITS,
  NoteVisibility,
} from "@fixflow/shared";
import { z } from "zod";

/**
 * The "Add a note" form on a request (FR-024): its values, the checks that give feedback beside the
 * field, and the translation to the API. The API applies the same rules again and is the authority.
 */

export const noteFormSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write the note before adding it.")
    .max(LIMITS.notes.maxLength, `A note must be ${LIMITS.notes.maxLength} characters or fewer.`),
  visibility: z.enum([NoteVisibility.INTERNAL, NoteVisibility.CUSTOMER_VISIBLE], {
    error: "Choose who can see the note: your team only, or the customer too.",
  }),
});

export type NoteFormValues = z.input<typeof noteFormSchema>;

/**
 * A new note starts as internal: sharing with the customer is the choice that cannot be taken back,
 * so it is never the default, and it is reset after every note.
 */
export const EMPTY_NOTE: NoteFormValues = { body: "", visibility: NoteVisibility.INTERNAL };

export function toNoteBody(values: NoteFormValues): AddRequestNoteBody {
  return { body: values.body.trim(), visibility: values.visibility };
}

/**
 * The "Add a note" form on a customer (FR-033): the same text rules, and nothing to choose. A
 * customer note is always internal, so there is no visibility to get wrong.
 */
export const customerNoteFormSchema = noteFormSchema.pick({ body: true });

export type CustomerNoteFormValues = z.input<typeof customerNoteFormSchema>;

export const EMPTY_CUSTOMER_NOTE: CustomerNoteFormValues = { body: "" };

export function toCustomerNoteBody(values: CustomerNoteFormValues): AddCustomerNoteBody {
  return { body: values.body.trim() };
}
