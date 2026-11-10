import {
  ADMIN_INVOICE_SORT_FIELDS,
  CUSTOMER_INVOICE_SORT_FIELDS,
  CUSTOMER_INVOICE_STATUSES,
  InvoiceStatus,
  isDateOnly,
  LIMITS,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { enumListFilter, optionalText, requiredText } from "../../lib/zod-fields.js";

const statusValues = Object.values(InvoiceStatus) as [InvoiceStatus, ...InvoiceStatus[]];

const dateOnly = (label: string) =>
  z
    .string({ error: `${label} must be a single date written YYYY-MM-DD.` })
    .refine(isDateOnly, `${label} must be a date written YYYY-MM-DD.`);

export const invoiceIdParamsSchema = z.object({
  id: z.uuid({ error: "The invoice id must be a valid id." }),
});

export const workOrderIdParamsSchema = z.object({
  id: z.uuid({ error: "The job id must be a valid id." }),
});

const expectedStatus = z.enum(statusValues, {
  error: "expectedStatus must be the status the invoice had when you loaded it.",
});

// ---- Create ----------------------------------------------------------------------------------

/** `POST /api/v1/admin/work-orders/:id/invoice`. Takes nothing: the server fills the draft in. */
export const createInvoiceBodySchema = z.strictObject({});

// ---- Update ----------------------------------------------------------------------------------

/**
 * A line as typed. The amounts stay text here: whether `"1.5"` is a quantity in range is the shared
 * calculation's call, which the service runs next and which names the field (`lines.2.quantity`)
 * the same way the editor does.
 */
const lineSchema = z.strictObject({
  description: requiredText("description", { max: LIMITS.lineDescription.maxLength }),
  quantity: z.string({ error: "Enter a quantity." }),
  unitPrice: z.string({ error: "Enter a price." }),
  taxable: z.boolean({ error: "Say whether the line is taxable." }),
});

/**
 * `PATCH /api/v1/admin/invoices/:id`. Strict: **a total cannot even be named** (`subtotal`,
 * `taxAmount`, `totalAmount`, `amountPaid`, a line's `lineTotal` are all unknown fields), so no client
 * can believe it set one. The server works every amount out from the lines (BR-05, D-19, D-44).
 */
export const updateInvoiceBodySchema = z
  .strictObject({
    lines: z
      .array(lineSchema, { error: "Add the lines of the invoice." })
      .min(
        LIMITS.lineItems.min,
        `Add between ${LIMITS.lineItems.min} and ${LIMITS.lineItems.max} lines.`,
      )
      .max(
        LIMITS.lineItems.max,
        `Add between ${LIMITS.lineItems.min} and ${LIMITS.lineItems.max} lines.`,
      ),
    discountAmount: z.string({ error: "Enter a discount, or 0." }),
    taxRate: z.string({ error: "Enter a tax rate, or 0." }),
    /** `null` means "the day it is issued". */
    issueDate: z
      .string({ error: "Choose the issue date." })
      .refine(isDateOnly, "Choose the issue date.")
      .nullable(),
    dueDate: z
      .string({ error: "Choose the due date." })
      .refine(isDateOnly, { error: "Choose the due date.", abort: true }),
    customerNote: optionalText("note for the customer", {
      max: LIMITS.notes.maxLength,
      multiline: true,
    }),
    expectedUpdatedAt: z.iso.datetime({
      error: "expectedUpdatedAt must be the updatedAt you loaded the invoice with.",
    }),
  })
  .refine((body) => body.issueDate === null || body.dueDate >= body.issueDate, {
    path: ["dueDate"],
    message: "The due date can't be before the issue date.",
  });

export type UpdateInvoiceInput = z.output<typeof updateInvoiceBodySchema>;

// ---- Issue and void --------------------------------------------------------------------------

/** `POST /api/v1/admin/invoices/:id/issue`. Only a draft can be issued. */
export const issueInvoiceBodySchema = z.strictObject({
  expectedStatus: z.literal(InvoiceStatus.DRAFT, {
    error: "expectedStatus must be DRAFT: only a draft can be issued.",
  }),
});

export type IssueInvoiceInput = z.output<typeof issueInvoiceBodySchema>;

/** `POST /api/v1/admin/invoices/:id/void`. The reason is internal (BR-16, BR-19). */
export const voidInvoiceBodySchema = z.strictObject({
  reason: requiredText("reason", {
    min: LIMITS.reason.minLength,
    max: LIMITS.reason.maxLength,
    multiline: true,
  }),
  expectedStatus,
});

export type VoidInvoiceInput = z.output<typeof voidInvoiceBodySchema>;

// ---- The list --------------------------------------------------------------------------------

/**
 * `GET /api/v1/admin/invoices` (FR-074): search, filters, sort and a page. `status` is what the
 * invoice is now, overdue included (the list saves any overdue first). The date ranges are days on
 * the business's calendar, both ends inclusive.
 */
export const adminInvoicesQuerySchema = createPaginationSchema({
  sortFields: ADMIN_INVOICE_SORT_FIELDS,
  defaultSort: "createdAt",
  defaultOrder: "desc",
})
  .extend({
    /** Invoice number, customer name or job reference; case-insensitive; blank means no search. */
    q: z
      .string({ error: "q must be a single piece of text." })
      .trim()
      .max(100, "q must be 100 characters or fewer.")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    status: enumListFilter(statusValues, "status"),
    customerId: z.uuid({ error: "customerId must be a valid id." }).optional(),
    dueFrom: dateOnly("dueFrom").optional(),
    dueTo: dateOnly("dueTo").optional(),
    issuedFrom: dateOnly("issuedFrom").optional(),
    issuedTo: dateOnly("issuedTo").optional(),
  })
  .refine(
    (query) =>
      query.dueFrom === undefined || query.dueTo === undefined || query.dueFrom <= query.dueTo,
    {
      path: ["dueTo"],
      message: "dueTo must not be before dueFrom.",
    },
  )
  .refine(
    (query) =>
      query.issuedFrom === undefined ||
      query.issuedTo === undefined ||
      query.issuedFrom <= query.issuedTo,
    { path: ["issuedTo"], message: "issuedTo must not be before issuedFrom." },
  );

export type AdminInvoicesQuery = z.output<typeof adminInvoicesQuerySchema>;

/**
 * `GET /api/v1/invoices/me` (T22): the customer's own invoices, newest first. `status` takes one or
 * several of the statuses a customer can be shown; a draft is not one of them. Whose invoices they are
 * comes from the session.
 */
export const listMyInvoicesQuerySchema = createPaginationSchema({
  sortFields: CUSTOMER_INVOICE_SORT_FIELDS,
  defaultSort: "issueDate",
  defaultOrder: "desc",
}).extend({
  status: enumListFilter(CUSTOMER_INVOICE_STATUSES, "status"),
});

export type ListMyInvoicesQuery = z.output<typeof listMyInvoicesQuerySchema>;

/** `GET /api/v1/invoices/:id/pdf`: `?inline=1` asks for the browser to show it instead of saving it. */
export const invoicePdfQuerySchema = z.object({
  inline: z
    .enum(["1", "true", "0", "false"], { error: "inline must be 1 or 0." })
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

export type InvoicePdfQuery = z.output<typeof invoicePdfQuerySchema>;
