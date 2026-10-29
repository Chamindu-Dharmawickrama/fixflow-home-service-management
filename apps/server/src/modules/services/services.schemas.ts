import {
  isBundledServiceImageKey,
  isValidSlug,
  LIMITS,
  PricingMode,
  SERVICE_STATUS_FILTERS,
  ServiceCatalogueState,
  SLUG_MAX_LENGTH,
} from "@fixflow/shared";
import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";
import {
  DECIMAL_2DP,
  optionalHttpsUrl,
  optionalKey,
  requiredText,
  toTwoPlaces,
} from "../../lib/zod-fields.js";
import { isValidStartingPrice } from "./services.domain.js";

const S = LIMITS.service;

/** Admin list sort fields. The default keeps the website's own order (`sortOrder`, then name). */
export const SERVICE_SORT_FIELDS = ["sortOrder", "name", "category", "updatedAt"] as const;

const slug = z
  .string({ error: "Enter the web address." })
  .trim()
  .min(1, "Enter the web address.")
  .max(SLUG_MAX_LENGTH, `The web address must be ${SLUG_MAX_LENGTH} characters or fewer.`)
  .refine(
    isValidSlug,
    "Use lower-case letters, numbers and single hyphens, like ac-repair. No spaces or symbols.",
  );

/** A "from" price as text with two decimals (`"129.00"`): money is never a JSON number (D-18). */
const startingPrice = z
  .string({ error: "Enter the starting price as an amount, like 129.00." })
  .trim()
  .regex(DECIMAL_2DP, "Enter the starting price with at most two decimal places, like 129.00.")
  .transform(toTwoPlaces)
  .refine(
    isValidStartingPrice,
    `The starting price must be between ${S.startingPrice.min} and ${S.startingPrice.max}.`,
  )
  .nullable();

const inclusions = z
  .array(requiredText("inclusion", { max: S.inclusions.itemMaxLength }), {
    error: "Enter the inclusions as a list.",
  })
  .max(S.inclusions.maxItems, `Add no more than ${S.inclusions.maxItems} inclusions.`);

const DURATION_MESSAGE = `The estimated duration must be a whole number of minutes from ${S.durationMinutes.min} to ${S.durationMinutes.max}.`;
const durationMinutes = z
  .number({ error: DURATION_MESSAGE })
  .int(DURATION_MESSAGE)
  .min(S.durationMinutes.min, DURATION_MESSAGE)
  .max(S.durationMinutes.max, DURATION_MESSAGE)
  .nullable();

const sortOrder = z
  .number({ error: "The display order must be a whole number." })
  .int("The display order must be a whole number.")
  .min(S.sortOrder.min, `The display order must be ${S.sortOrder.min} or more.`)
  .max(S.sortOrder.max, `The display order must be ${S.sortOrder.max} or less.`);

const imageKey = optionalKey(isBundledServiceImageKey, "Choose one of the available pictures.");

const pricingMode = z.enum(
  Object.values(PricingMode) as [PricingMode, ...PricingMode[]],
  "Choose how the service is priced.",
);

const lifecycleStatus = z.enum(
  Object.values(ServiceCatalogueState) as [ServiceCatalogueState, ...ServiceCatalogueState[]],
  "expectedStatus must be PUBLISHED, UNPUBLISHED or ARCHIVED.",
);

const serviceFields = {
  name: requiredText("service name", { min: S.name.minLength, max: S.name.maxLength }),
  slug,
  category: requiredText("category", { min: S.category.minLength, max: S.category.maxLength }),
  shortDescription: requiredText("short description", {
    min: S.shortDescription.minLength,
    max: S.shortDescription.maxLength,
  }),
  fullDescription: requiredText("full description", {
    min: S.fullDescription.minLength,
    max: S.fullDescription.maxLength,
    multiline: true,
  }),
  inclusions,
  estimatedDurationMinutes: durationMinutes,
  pricingMode,
  startingPrice,
  imageKey,
  imageUrl: optionalHttpsUrl("picture address", S.imageUrl.maxLength),
  sortOrder,
  isPublished: z.boolean({ error: "isPublished must be true or false." }),
};

interface PricingAndImage {
  pricingMode?: PricingMode | undefined;
  startingPrice?: string | null | undefined;
  imageKey?: string | null | undefined;
  imageUrl?: string | null | undefined;
}

/**
 * Rules between two fields of the same body. Rules that need the stored service as well (a body that
 * only changes `pricingMode`) are applied by the service after it merges the patch.
 */
function checkPricingAndImage(body: PricingAndImage, ctx: z.RefinementCtx): void {
  if (body.pricingMode === PricingMode.FIXED && body.startingPrice === null) {
    ctx.addIssue({
      code: "custom",
      path: ["startingPrice"],
      message: "Enter a starting price for a fixed-price service.",
    });
  }
  if (
    body.pricingMode === PricingMode.QUOTE_REQUIRED &&
    body.startingPrice !== null &&
    body.startingPrice !== undefined
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["startingPrice"],
      message:
        'A starting price is only used with fixed pricing. Leave it empty for "Request a quote".',
    });
  }
  if (
    body.imageKey !== null &&
    body.imageKey !== undefined &&
    body.imageUrl !== null &&
    body.imageUrl !== undefined
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["imageUrl"],
      message: "Choose either a bundled picture or a web address, not both.",
    });
  }
}

/**
 * `POST /admin/services` (FR-101). `slug` may be left out: it is then made from the name. A fixed-price
 * service needs `startingPrice`; a quote-only one must not have one. New services are not published
 * unless `isPublished` says so.
 */
export const createServiceBodySchema = z
  .strictObject({
    name: serviceFields.name,
    slug: serviceFields.slug.optional(),
    category: serviceFields.category,
    shortDescription: serviceFields.shortDescription,
    fullDescription: serviceFields.fullDescription,
    inclusions: serviceFields.inclusions.default([]),
    estimatedDurationMinutes: serviceFields.estimatedDurationMinutes.default(null),
    pricingMode: serviceFields.pricingMode,
    startingPrice: serviceFields.startingPrice.default(null),
    imageKey: serviceFields.imageKey.default(null),
    imageUrl: serviceFields.imageUrl.default(null),
    sortOrder: serviceFields.sortOrder.default(0),
    isPublished: serviceFields.isPublished.default(false),
  })
  .superRefine(checkPricingAndImage);

export type CreateServiceBody = z.output<typeof createServiceBodySchema>;

/**
 * `PATCH /admin/services/:id`. Any subset of the fields; `isPublished` publishes or unpublishes.
 * `expectedStatus` is the state the form was loaded in: if the service has since moved, the answer
 * is `409 STALE_STATE` and nothing changes (D-46).
 */
export const updateServiceBodySchema = z
  .strictObject({
    ...serviceFields,
    expectedStatus: lifecycleStatus,
  })
  .partial()
  .superRefine(checkPricingAndImage)
  .refine(
    (body) =>
      Object.entries(body).some(([key, value]) => key !== "expectedStatus" && value !== undefined),
    { message: "Send at least one field to change." },
  );

export type UpdateServiceBody = z.output<typeof updateServiceBodySchema>;

/** `POST /admin/services/:id/archive` and `/restore`. */
export const lifecycleBodySchema = z.strictObject({ expectedStatus: lifecycleStatus });

export const serviceIdParamsSchema = z.object({
  id: z.uuid("The service id must be a valid id."),
});

export const serviceSlugParamsSchema = z.object({
  slug: z
    .string()
    .max(SLUG_MAX_LENGTH, "The web address is too long.")
    .refine(isValidSlug, "The web address is not valid."),
});

/** `GET /services?category=Cleaning`. Matched ignoring case, so a link typed by hand still works. */
export const publicServicesQuerySchema = z.object({
  category: z
    .string()
    .trim()
    .max(S.category.maxLength, "The category is too long.")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

/** `GET /admin/services?status=archived&search=ac&page=2` (D-34). */
export const adminServicesQuerySchema = createPaginationSchema({
  sortFields: SERVICE_SORT_FIELDS,
  defaultSort: "sortOrder",
  defaultOrder: "asc",
}).extend({
  status: z
    .enum(SERVICE_STATUS_FILTERS, `status must be one of: ${SERVICE_STATUS_FILTERS.join(", ")}.`)
    .optional(),
  search: z
    .string()
    .trim()
    .max(S.search.maxLength, `The search must be ${S.search.maxLength} characters or fewer.`)
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type AdminServicesQuery = z.output<typeof adminServicesQuerySchema>;
