import {
  type AdminServiceDto,
  isHttpsUrl,
  isValidSlug,
  LIMITS,
  PricingMode,
  SLUG_MAX_LENGTH,
} from "@fixflow/shared";
import { z } from "zod";

import type { ServiceCardData } from "./format";

/**
 * The service form: its values, the checks that give feedback beside each field, and the
 * translation to and from the API. The checks only save a round trip; the API applies the same
 * rules again and is the authority (CLAUDE.md §7).
 */

const S = LIMITS.service;

export type ImageSource = "none" | "bundled" | "url";

/** Everything is text, as an input holds it; the numbers are converted when the form is sent. */
export interface ServiceFormValues {
  name: string;
  slug: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  /** One row per inclusion (the form library needs objects in a list). Blank rows are not sent. */
  inclusions: { text: string }[];
  estimatedDurationMinutes: string;
  pricingMode: PricingMode;
  startingPrice: string;
  imageSource: ImageSource;
  imageKey: string;
  imageUrl: string;
  sortOrder: string;
}

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .refine(
      (value) => value.length === 0 || value.length >= min,
      `The ${label} must be at least ${min} characters.`,
    )
    .max(max, `The ${label} must be ${max} characters or fewer.`);

const startingPriceShape = /^\d{1,6}(\.\d{1,2})?$/;

export const serviceFormSchema = z
  .object({
    name: text("service name", S.name.minLength, S.name.maxLength),
    slug: z
      .string()
      .trim()
      .min(1, "Enter the web address.")
      .max(SLUG_MAX_LENGTH, `The web address must be ${SLUG_MAX_LENGTH} characters or fewer.`)
      .refine(
        (value) => value === "" || isValidSlug(value),
        "Use lower-case letters, numbers and single hyphens, like ac-repair.",
      ),
    category: text("category", S.category.minLength, S.category.maxLength),
    shortDescription: text(
      "short description",
      S.shortDescription.minLength,
      S.shortDescription.maxLength,
    ),
    fullDescription: text(
      "full description",
      S.fullDescription.minLength,
      S.fullDescription.maxLength,
    ),
    inclusions: z
      .array(
        z.object({
          text: z
            .string()
            .max(
              S.inclusions.itemMaxLength,
              `An inclusion must be ${S.inclusions.itemMaxLength} characters or fewer.`,
            ),
        }),
      )
      .refine(
        (rows) => rows.filter((row) => row.text.trim() !== "").length <= S.inclusions.maxItems,
        `Add no more than ${S.inclusions.maxItems} inclusions.`,
      ),
    estimatedDurationMinutes: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === "" ||
          (/^\d+$/.test(value) &&
            Number(value) >= S.durationMinutes.min &&
            Number(value) <= S.durationMinutes.max),
        `Enter whole minutes from ${S.durationMinutes.min} to ${S.durationMinutes.max}, or leave it empty.`,
      ),
    pricingMode: z.enum(
      [PricingMode.FIXED, PricingMode.QUOTE_REQUIRED],
      "Choose how the service is priced.",
    ),
    startingPrice: z.string().trim(),
    imageSource: z.enum(["none", "bundled", "url"]),
    imageKey: z.string(),
    imageUrl: z
      .string()
      .trim()
      .max(
        S.imageUrl.maxLength,
        `The picture address must be ${S.imageUrl.maxLength} characters or fewer.`,
      ),
    sortOrder: z
      .string()
      .trim()
      .refine(
        (value) =>
          /^\d+$/.test(value) &&
          Number(value) >= S.sortOrder.min &&
          Number(value) <= S.sortOrder.max,
        `Enter a whole number from ${S.sortOrder.min} to ${S.sortOrder.max}.`,
      ),
  })
  .superRefine((values, ctx) => {
    if (values.pricingMode === PricingMode.FIXED) {
      if (values.startingPrice === "") {
        ctx.addIssue({
          code: "custom",
          path: ["startingPrice"],
          message: "Enter a starting price for a fixed-price service.",
        });
      } else if (
        !startingPriceShape.test(values.startingPrice) ||
        Number(values.startingPrice) <= 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["startingPrice"],
          message: "Enter the starting price as an amount above zero, like 129.00.",
        });
      }
    }
    if (values.imageSource === "bundled" && values.imageKey === "") {
      ctx.addIssue({ code: "custom", path: ["imageKey"], message: "Choose a picture." });
    }
    if (values.imageSource === "url" && !isHttpsUrl(values.imageUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "Enter a web address starting with https://",
      });
    }
  });

/** What a new service starts as. Fixed pricing is the more common case, so it is the default. */
export const EMPTY_SERVICE_VALUES: ServiceFormValues = {
  name: "",
  slug: "",
  category: "",
  shortDescription: "",
  fullDescription: "",
  inclusions: [],
  estimatedDurationMinutes: "",
  pricingMode: PricingMode.QUOTE_REQUIRED,
  startingPrice: "",
  imageSource: "none",
  imageKey: "",
  imageUrl: "",
  sortOrder: "0",
};

export function serviceToFormValues(service: AdminServiceDto): ServiceFormValues {
  return {
    name: service.name,
    slug: service.slug,
    category: service.category,
    shortDescription: service.shortDescription,
    fullDescription: service.fullDescription,
    inclusions: service.inclusions.map((item) => ({ text: item })),
    estimatedDurationMinutes:
      service.estimatedDurationMinutes === null ? "" : String(service.estimatedDurationMinutes),
    pricingMode: service.pricingMode,
    startingPrice: service.startingPrice ?? "",
    imageSource: service.imageKey !== null ? "bundled" : service.imageUrl !== null ? "url" : "none",
    imageKey: service.imageKey ?? "",
    imageUrl: service.imageUrl ?? "",
    sortOrder: String(service.sortOrder),
  };
}

/**
 * The card the form's current values would make, for the live preview. It is forgiving, because it
 * runs on every keystroke: an empty name reads "Service name", a price that is not (yet) an amount
 * shows as "Request a quote", and a picture that is not (yet) chosen is left out.
 */
export function serviceFormToCard(
  values: {
    [Field in keyof Omit<ServiceFormValues, "inclusions">]?: ServiceFormValues[Field] | undefined;
  },
  currencyCode: string,
): ServiceCardData {
  const price = values.startingPrice?.trim() ?? "";
  const minutes = values.estimatedDurationMinutes?.trim() ?? "";
  const imageSource = values.imageSource ?? "none";
  const fixedWithPrice =
    values.pricingMode === PricingMode.FIXED && startingPriceShape.test(price) && Number(price) > 0;
  return {
    name: values.name?.trim() || "Service name",
    category: values.category?.trim() || "Category",
    shortDescription:
      values.shortDescription?.trim() || "A short description appears here, under the name.",
    pricingMode: fixedWithPrice ? PricingMode.FIXED : PricingMode.QUOTE_REQUIRED,
    startingPrice: fixedWithPrice ? toTwoPlaces(price) : null,
    currencyCode,
    estimatedDurationMinutes: /^\d+$/.test(minutes) ? Number(minutes) : null,
    imageKey: imageSource === "bundled" && values.imageKey ? values.imageKey : null,
    imageUrl:
      imageSource === "url" && values.imageUrl !== undefined && isHttpsUrl(values.imageUrl.trim())
        ? values.imageUrl.trim()
        : null,
  };
}

/** `"129"` → `"129.00"`, `"8.5"` → `"8.50"`: the amount the way the API will store it. */
function toTwoPlaces(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

/** The request body for the API. Only what the chosen pricing mode and picture source use is sent. */
export interface ServiceRequestBody {
  name: string;
  slug: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  inclusions: string[];
  estimatedDurationMinutes: number | null;
  pricingMode: PricingMode;
  startingPrice: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

export function toServiceBody(values: ServiceFormValues): ServiceRequestBody {
  const minutes = values.estimatedDurationMinutes.trim();
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    category: values.category.trim(),
    shortDescription: values.shortDescription.trim(),
    fullDescription: values.fullDescription.trim(),
    inclusions: values.inclusions.map((row) => row.text.trim()).filter((item) => item !== ""),
    estimatedDurationMinutes: minutes === "" ? null : Number(minutes),
    pricingMode: values.pricingMode,
    startingPrice: values.pricingMode === PricingMode.FIXED ? values.startingPrice.trim() : null,
    imageKey: values.imageSource === "bundled" ? values.imageKey : null,
    imageUrl: values.imageSource === "url" ? values.imageUrl.trim() : null,
    sortOrder: Number(values.sortOrder.trim()),
  };
}

/**
 * Where the API's field names live in the form. Almost every name is the same; an inclusion error
 * (`inclusions.2`) belongs to the text box in that row, and a problem with the list as a whole has no
 * single box, so it is shown with the form-level messages.
 */
export function formFieldForApiError(apiField: string): string {
  if (/^inclusions\.\d+$/.test(apiField)) return `${apiField}.text`;
  if (apiField === "inclusions") return "_";
  return apiField;
}
