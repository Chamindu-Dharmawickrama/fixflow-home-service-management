import { isDateOnly, LIMITS, parsePaymentAmount, PaymentMethod } from "@fixflow/shared";
import { z } from "zod";

import { optionalText, requiredText } from "../../lib/zod-fields.js";

const methodValues = Object.values(PaymentMethod) as [PaymentMethod, ...PaymentMethod[]];

export const paymentParamsSchema = z.object({
  id: z.uuid({ error: "The invoice id must be a valid id." }),
  paymentId: z.uuid({ error: "The payment id must be a valid id." }),
});

/**
 * `POST /api/v1/admin/invoices/:id/payments` (D-27, FR-073). Strict: the invoice's `amountPaid`,
 * balance and status cannot even be named, because the server works them out from the payments that
 * stand. The amount is read into a decimal string with two places; whether it fits the balance, and
 * whether the date is in the future in the business's time zone, are judged by the service under the
 * invoice's lock. The reference and notes are internal and never card or bank credentials.
 */
export const recordPaymentBodySchema = z.strictObject({
  amount: z.string({ error: "Enter the amount received." }).transform((value, context) => {
    const parsed = parsePaymentAmount(value);
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.amount;
  }),
  paymentDate: z
    .string({ error: "Choose the date the payment was received." })
    .refine(isDateOnly, "Choose the date the payment was received, written YYYY-MM-DD."),
  method: z.enum(methodValues, { error: "Choose how the payment was received." }),
  reference: optionalText("reference", { max: LIMITS.payment.reference.maxLength }).optional(),
  notes: optionalText("notes", { max: LIMITS.payment.notes.maxLength, multiline: true }).optional(),
});

export type RecordPaymentInput = z.output<typeof recordPaymentBodySchema>;

/** `POST /api/v1/admin/invoices/:id/payments/:paymentId/void`. The reason is internal (BR-16, BR-19). */
export const voidPaymentBodySchema = z.strictObject({
  reason: requiredText("reason", {
    min: LIMITS.reason.minLength,
    max: LIMITS.reason.maxLength,
    multiline: true,
  }),
});

export type VoidPaymentInput = z.output<typeof voidPaymentBodySchema>;
