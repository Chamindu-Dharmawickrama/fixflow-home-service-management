import { isDateOnly, LIMITS, QuotationStatus } from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { optionalText, requiredText } from "../../lib/zod-fields.js";

const statusValues = Object.values(QuotationStatus) as [QuotationStatus, ...QuotationStatus[]];

export const quotationIdParamsSchema = z.object({
  id: z.uuid({ error: "The quotation id must be a valid id." }),
});

const expectedStatus = z.enum(statusValues, {
  error: "expectedStatus must be the status the quotation had when you loaded it.",
});

// ---- Create ----------------------------------------------------------------------------------

/** `POST /api/v1/admin/requests/:id/quotations`. */
export const createQuotationBodySchema = z.strictObject({
  /** The sent quotation to replace. Left out for the first quotation of a request. */
  replacesQuotationId: z.uuid({ error: "replacesQuotationId must be a valid id." }).optional(),
});

export type CreateQuotationInput = z.output<typeof createQuotationBodySchema>;

// ---- Update ----------------------------------------------------------------------------------

/**
 * A line as typed. The amounts stay text here: whether `"1.5"` is a quantity in range is the shared
 * calculation's call (`tryCalculateDocumentTotals`), which the service runs next and which names
 * the field (`lines.2.quantity`) the same way the editor does.
 */
const lineSchema = z.strictObject({
  description: requiredText("description", { max: LIMITS.lineDescription.maxLength }),
  quantity: z.string({ error: "Enter a quantity." }),
  unitPrice: z.string({ error: "Enter a price." }),
  taxable: z.boolean({ error: "Say whether the line is taxable." }),
});

/**
 * `PATCH /api/v1/admin/quotations/:id`. Strict: **a total cannot even be named** (`subtotal`,
 * `taxAmount`, `totalAmount`, a line's `lineTotal` are all unknown fields), so no client can believe
 * it set one. The server works every amount out from the lines (BR-05, D-19, D-44).
 */
export const updateQuotationBodySchema = z.strictObject({
  lines: z
    .array(lineSchema, { error: "Add the lines of the quotation." })
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
  validUntil: z
    .string({ error: "Choose the last day the quotation is valid." })
    .refine(isDateOnly, "Choose the last day the quotation is valid."),
  terms: optionalText("terms", {
    max: LIMITS.businessSettings.quotationTerms.maxLength,
    multiline: true,
  }),
  customerNote: optionalText("note for the customer", {
    max: LIMITS.notes.maxLength,
    multiline: true,
  }),
  expectedUpdatedAt: z.iso.datetime({
    error: "expectedUpdatedAt must be the updatedAt you loaded the quotation with.",
  }),
});

export type UpdateQuotationInput = z.output<typeof updateQuotationBodySchema>;

// ---- Send and void ---------------------------------------------------------------------------

/** `POST /api/v1/admin/quotations/:id/send`. */
export const sendQuotationBodySchema = z.strictObject({ expectedStatus });

export type SendQuotationInput = z.output<typeof sendQuotationBodySchema>;

/**
 * `POST /api/v1/admin/quotations/:id/void`. The reason is internal (BR-16, BR-19); only the optional
 * message can reach the customer, and only for a quotation they had been sent.
 */
export const voidQuotationBodySchema = z.strictObject({
  reason: requiredText("reason", {
    min: LIMITS.reason.minLength,
    max: LIMITS.reason.maxLength,
    multiline: true,
  }),
  expectedStatus,
  customerMessage: optionalText("message for the customer", {
    max: LIMITS.reason.maxLength,
    multiline: true,
  }).optional(),
});

export type VoidQuotationInput = z.output<typeof voidQuotationBodySchema>;

// ---- The customer's view ---------------------------------------------------------------------

/** `GET /api/v1/quotations/:id`. `?preview=1` lets an admin see a draft as the customer will. */
export const getQuotationQuerySchema = z.object({
  preview: z
    .enum(["1"], { error: "preview must be 1 or left out." })
    .transform(() => true)
    .optional(),
});

export type GetQuotationQuery = z.output<typeof getQuotationQuerySchema>;

// ---- The customer's list and answer (T15) -------------------------------------------------------

/** The statuses a customer can see: a quotation they were sent. A draft is not among them. */
const CUSTOMER_STATUS_FILTERS = [
  QuotationStatus.SENT,
  QuotationStatus.ACCEPTED,
  QuotationStatus.DECLINED,
  QuotationStatus.EXPIRED,
  QuotationStatus.VOID,
] as const;

/**
 * `GET /api/v1/quotations/me`. The order is fixed (the ones awaiting an answer first, then the
 * newest), so there is no `sort`; `status` narrows the list to one status, which the portal home
 * uses to ask for what awaits a decision.
 */
export const listMyQuotationsQuerySchema = createPaginationSchema({
  sortFields: ["sentAt"],
  defaultSort: "sentAt",
  defaultOrder: "desc",
}).extend({
  status: z
    .enum(CUSTOMER_STATUS_FILTERS, {
      error: `status must be one of: ${CUSTOMER_STATUS_FILTERS.join(", ")}.`,
    })
    .optional(),
});

export type ListMyQuotationsQuery = z.output<typeof listMyQuotationsQuerySchema>;

/**
 * `POST /api/v1/quotations/:id/decline`. Strict, like every body. The reason is the customer's own
 * words, optional and at most 500 characters; blank means none.
 */
export const declineQuotationBodySchema = z.strictObject({
  reason: optionalText("reason", { max: LIMITS.reason.maxLength, multiline: true }).optional(),
});

export type DeclineQuotationInput = z.output<typeof declineQuotationBodySchema>;

/** `POST /api/v1/quotations/:id/accept` takes no body: acceptance is the act itself (BR-08). */
export const acceptQuotationBodySchema = z.strictObject({});
