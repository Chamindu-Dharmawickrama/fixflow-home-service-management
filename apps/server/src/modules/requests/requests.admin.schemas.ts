import {
  ADMIN_REQUEST_SORT_FIELDS,
  isDateOnly,
  LIMITS,
  NoteVisibility,
  REQUEST_STATUS_ACTIONS,
  RequestAction,
  type RequestStatusAction,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { enumListFilter, optionalText, requiredText } from "../../lib/zod-fields.js";
import { ACTIONS_REQUIRING_REASON } from "./requests.domain.js";

const statusValues = Object.values(ServiceRequestStatus) as [
  ServiceRequestStatus,
  ...ServiceRequestStatus[],
];

/** The `status` filter takes one or several statuses (see {@link enumListFilter}). */
const statusFilter = enumListFilter(statusValues, "status");

const dateOnly = (label: string) =>
  z
    .string({ error: `${label} must be a single date written YYYY-MM-DD.` })
    .refine(isDateOnly, `${label} must be a date written YYYY-MM-DD.`);

/** `GET /api/v1/admin/requests` (FR-023): search, filters, sort and page. */
export const adminRequestsQuerySchema = createPaginationSchema({
  sortFields: ADMIN_REQUEST_SORT_FIELDS,
  defaultSort: "submittedAt",
  defaultOrder: "desc",
})
  .extend({
    /** Reference, customer name or customer email; case-insensitive; blank means no search. */
    q: z
      .string({ error: "q must be a single piece of text." })
      .trim()
      .max(100, "q must be 100 characters or fewer.")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    status: statusFilter,
    serviceId: z.uuid({ error: "serviceId must be a valid id." }).optional(),
    customerId: z.uuid({ error: "customerId must be a valid id." }).optional(),
    /** Days on the business's calendar, inclusive. */
    submittedFrom: dateOnly("submittedFrom").optional(),
    submittedTo: dateOnly("submittedTo").optional(),
  })
  .refine(
    (query) =>
      query.submittedFrom === undefined ||
      query.submittedTo === undefined ||
      query.submittedFrom <= query.submittedTo,
    { path: ["submittedTo"], message: "submittedTo must not be before submittedFrom." },
  );

export type AdminRequestsQuery = z.output<typeof adminRequestsQuerySchema>;

export const adminRequestIdParamsSchema = z.object({
  id: z.uuid({ error: "The request id must be a valid id." }),
});

const actionValues = [...REQUEST_STATUS_ACTIONS] as [RequestStatusAction, ...RequestStatusAction[]];

/**
 * `PATCH /api/v1/admin/requests/:id/status` (FR-025, FR-026). Strict: only the three admin actions
 * exist, so a status such as `QUOTED` or `ACCEPTED`, which belongs to the system, cannot even be
 * named. Cancelling and reopening need a reason, which is internal (BR-16, BR-19); only a
 * cancellation can carry a message for the customer, which is the one thing the customer reads.
 */
export const changeRequestStatusBodySchema = z
  .strictObject({
    action: z.enum(actionValues, { error: `action must be one of: ${actionValues.join(", ")}.` }),
    expectedStatus: z.enum(statusValues, {
      error: "expectedStatus must be the status the request had when you loaded it.",
    }),
    reason: requiredText("reason", {
      min: LIMITS.reason.minLength,
      max: LIMITS.reason.maxLength,
      multiline: true,
    }).optional(),
    customerMessage: optionalText("message for the customer", {
      max: LIMITS.reason.maxLength,
      multiline: true,
    }).optional(),
  })
  .superRefine((body, ctx) => {
    if (ACTIONS_REQUIRING_REASON.includes(body.action) && body.reason === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Enter a reason of ${LIMITS.reason.minLength} to ${LIMITS.reason.maxLength} characters, so the history says why.`,
      });
    }
    if (body.action === RequestAction.START_REVIEW && body.reason !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Starting a review does not take a reason.",
      });
    }
    if (
      body.customerMessage !== undefined &&
      body.customerMessage !== null &&
      body.action !== RequestAction.CANCEL
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["customerMessage"],
        message: "Only cancelling a request can carry a message for the customer.",
      });
    }
  });

export type ChangeRequestStatusInput = z.output<typeof changeRequestStatusBodySchema>;

const visibilityValues = Object.values(NoteVisibility) as [NoteVisibility, ...NoteVisibility[]];

/** `POST /api/v1/admin/requests/:id/notes` (FR-024, FR-094). The visibility must be chosen on purpose. */
export const addRequestNoteBodySchema = z.strictObject({
  body: requiredText("note", { max: LIMITS.notes.maxLength, multiline: true }),
  visibility: z.enum(visibilityValues, {
    error: "Choose who can see the note: your team only, or the customer too.",
  }),
});

export type AddRequestNoteInput = z.output<typeof addRequestNoteBodySchema>;
