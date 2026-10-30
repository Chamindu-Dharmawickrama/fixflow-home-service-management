import {
  isDateOnly,
  isValidPostalCode,
  LIMITS,
  PREFERRED_DATE_INVALID_MESSAGE,
  PreferredWindow,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import { optionalText, requiredText } from "../../lib/zod-fields.js";

const A = LIMITS.address;

/**
 * An address typed into the request form. The label is a name for the saved copy ("Home"), so it
 * only matters when the address is saved to the profile; without saving it is ignored.
 */
const newAddressSchema = z.strictObject({
  label: optionalText("label", { max: A.label.maxLength }).optional(),
  line1: requiredText("street address", { max: A.line.maxLength }),
  line2: optionalText("address line 2", { max: A.line.maxLength }).optional(),
  city: requiredText("city", { max: A.city.maxLength }),
  region: optionalText("state or region", { max: A.region.maxLength }).optional(),
  postalCode: requiredText("postal code", { max: A.postalCode.maxLength }).refine(
    isValidPostalCode,
    "The postal code can only contain letters, numbers, spaces and hyphens.",
  ),
  accessNotes: optionalText("access notes", {
    max: A.accessNotes.maxLength,
    multiline: true,
  }).optional(),
});

const preferredWindowValues = Object.values(PreferredWindow) as [
  PreferredWindow,
  ...PreferredWindow[],
];

/** The date must be a real calendar date here; whether it is in range depends on the clock, so the service decides that. */
const preferredDate = z
  .string({ error: PREFERRED_DATE_INVALID_MESSAGE })
  .trim()
  .refine(isDateOnly, PREFERRED_DATE_INVALID_MESSAGE);

/**
 * `POST /api/v1/requests` (FR-020, spec §7.1). Strict: the owner comes from the session and the
 * reference, status, snapshots and UTC times are the server's, so none of them can be sent. The
 * address is either `serviceAddressId` (one of the caller's saved addresses) or `newAddress`
 * (optionally saved to the profile), never both.
 */
export const createRequestBodySchema = z
  .strictObject({
    serviceId: z.uuid({ error: "Choose a service." }),
    description: requiredText("description", {
      min: LIMITS.requestDescription.minLength,
      max: LIMITS.requestDescription.maxLength,
      multiline: true,
    }),
    serviceAddressId: z.uuid({ error: "Choose one of your saved addresses." }).optional(),
    newAddress: newAddressSchema.optional(),
    saveAddressToProfile: z
      .boolean({ error: "saveAddressToProfile must be true or false." })
      .optional(),
    preferredDate,
    preferredWindow: z.enum(preferredWindowValues, { error: "Choose a time window." }),
    submissionKey: z.uuid({ error: "The submission key must be a UUID." }),
  })
  .superRefine((body, ctx) => {
    const { serviceAddressId, newAddress, saveAddressToProfile } = body;

    if (serviceAddressId !== undefined && newAddress !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["newAddress"],
        message: "Choose a saved address or enter a new one, not both.",
      });
    } else if (serviceAddressId === undefined && newAddress === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["serviceAddressId"],
        message: "Choose where the work is to be done.",
      });
    }

    if (newAddress === undefined) {
      if (saveAddressToProfile !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["saveAddressToProfile"],
          message: "Only a new address can be saved to your profile.",
        });
      }
      return;
    }

    if (saveAddressToProfile === true) {
      const label = newAddress.label ?? "";
      if (label === "") {
        ctx.addIssue({
          code: "custom",
          path: ["newAddress", "label"],
          message: "Enter a label so you can find this address again, like Home.",
        });
      } else if (label.length < A.label.minLength) {
        ctx.addIssue({
          code: "custom",
          path: ["newAddress", "label"],
          message: `The label must be at least ${A.label.minLength} characters.`,
        });
      }
    }
  });

export type CreateRequestBody = z.output<typeof createRequestBodySchema>;

export const requestIdParamsSchema = z.object({
  id: z.uuid({ error: "The request id must be a valid id." }),
});

const statusValues = Object.values(ServiceRequestStatus) as [
  ServiceRequestStatus,
  ...ServiceRequestStatus[],
];

/** The request list can only be ordered by when it was submitted, newest first. */
export const REQUEST_SORT_FIELDS = ["submittedAt"] as const;

/** `GET /api/v1/requests/me`. */
export const listMyRequestsQuerySchema = createPaginationSchema({
  sortFields: REQUEST_SORT_FIELDS,
  defaultSort: "submittedAt",
  defaultOrder: "desc",
}).extend({
  status: z
    .enum(statusValues, { error: `status must be one of: ${statusValues.join(", ")}.` })
    .optional(),
});

export type ListMyRequestsQuery = z.output<typeof listMyRequestsQuerySchema>;
