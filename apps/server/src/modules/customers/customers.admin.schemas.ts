import { ADMIN_CUSTOMER_SORT_FIELDS, CUSTOMER_HISTORY_TYPES, LIMITS } from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { requiredText } from "../../lib/zod-fields.js";

/** `GET /api/v1/admin/customers` (FR-031): search, sort and page. */
export const adminCustomersQuerySchema = createPaginationSchema({
  sortFields: ADMIN_CUSTOMER_SORT_FIELDS,
  defaultSort: "name",
  defaultOrder: "asc",
}).extend({
  /**
   * Name, email or phone; case-insensitive; blank means no search. Runs of spaces count as one, so
   * "alex   morgan" finds "Alex Morgan".
   */
  q: z
    .string({ error: "q must be a single piece of text." })
    .trim()
    .max(100, "q must be 100 characters or fewer.")
    .transform((value) => (value === "" ? undefined : value.replace(/\s+/g, " ")))
    .optional(),
});

export type AdminCustomersQuery = z.output<typeof adminCustomersQuerySchema>;

export const adminCustomerIdParamsSchema = z.object({
  id: z.uuid({ error: "The customer id must be a valid id." }),
});

/**
 * `GET /api/v1/admin/customers/:id/history`: one page of one kind of record, newest first. There
 * is no sort: a history reads as a story with the latest at the top.
 */
export const customerHistoryQuerySchema = createPaginationSchema({
  sortFields: ["createdAt"],
  defaultSort: "createdAt",
  defaultOrder: "desc",
})
  .pick({ page: true, pageSize: true })
  .extend({
    type: z.enum(
      CUSTOMER_HISTORY_TYPES,
      `type must be one of: ${CUSTOMER_HISTORY_TYPES.join(", ")}.`,
    ),
  });

export type CustomerHistoryQuery = z.output<typeof customerHistoryQuerySchema>;

/**
 * `POST /api/v1/admin/customers/:id/notes` (FR-033). Strict: the only thing a note has is its text.
 * Who wrote it and when come from the session and the clock, and a note is always internal, so
 * there is no visibility to choose.
 */
export const addCustomerNoteBodySchema = z.strictObject({
  body: requiredText("note", { max: LIMITS.notes.maxLength, multiline: true }),
});

export type AddCustomerNoteInput = z.output<typeof addCustomerNoteBodySchema>;
