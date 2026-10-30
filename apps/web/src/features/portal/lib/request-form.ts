import {
  type CreateServiceRequestBody,
  isDateOnly,
  LIMITS,
  PREFERRED_DATE_INVALID_MESSAGE,
  PREFERRED_DATE_TOO_LATE_MESSAGE,
  PREFERRED_DATE_TOO_SOON_MESSAGE,
  type PreferredWindow,
  type PublicServiceDto,
  type ServiceAddressDto,
} from "@fixflow/shared";
import { z } from "zod";

import { addressFormSchema, toAddressBody } from "./address-form";

/**
 * The service-request form (FR-020, spec §7.1): its values, the checks that give feedback beside
 * each field, and the translation to the API's body. The checks save a round trip; the API applies
 * the same rules again with its own clock and is the authority (CLAUDE.md §7).
 */

const D = LIMITS.requestDescription;

export type AddressMode = "saved" | "new";

/** The address fields typed into the form. Everything is text, as an input holds it. */
export interface NewAddressValues {
  label: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  accessNotes: string;
}

export interface RequestFormValues {
  serviceId: string;
  description: string;
  addressMode: AddressMode;
  /** The chosen saved address; used when `addressMode` is `saved`. */
  serviceAddressId: string;
  /** The typed address; used when `addressMode` is `new`. */
  newAddress: NewAddressValues;
  saveAddressToProfile: boolean;
  /** `YYYY-MM-DD` as the date input holds it. */
  preferredDate: string;
  preferredWindow: PreferredWindow | "";
}

export const EMPTY_NEW_ADDRESS: NewAddressValues = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  accessNotes: "",
};

/** The first and last day that can be chosen, from the server (the business's calendar). */
export interface DateLimits {
  min: string;
  max: string;
}

/** Nothing chosen yet, or one of the windows of D-35. `satisfies` keeps it in step with the enum. */
const WINDOW_CHOICES = ["", "MORNING", "AFTERNOON", "EVENING"] as const satisfies readonly (
  "" | PreferredWindow
)[];

export const DESCRIPTION_TOO_SHORT = `Add a little more detail: the description needs at least ${D.minLength} characters.`;

/**
 * The form's validation. The checks that depend on the chosen address mode live in one place, so a
 * field that is not on screen (the typed address while a saved one is chosen) is never an error.
 */
export function createRequestFormSchema(limits: DateLimits) {
  const newAddressFields = addressFormSchema.omit({ label: true });

  return z
    .object({
      serviceId: z.string(),
      description: z.string(),
      addressMode: z.enum(["saved", "new"]),
      serviceAddressId: z.string(),
      newAddress: z.object({
        label: z.string(),
        line1: z.string(),
        line2: z.string(),
        city: z.string(),
        region: z.string(),
        postalCode: z.string(),
        accessNotes: z.string(),
      }),
      saveAddressToProfile: z.boolean(),
      preferredDate: z.string(),
      preferredWindow: z.enum(WINDOW_CHOICES),
    })
    .superRefine((values, ctx) => {
      const problem = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path, message });

      if (values.serviceId === "") {
        problem(["serviceId"], "Choose a service.");
      }

      const description = values.description.trim();
      if (description === "") {
        problem(["description"], "Tell us what is wrong so we can prepare a quotation.");
      } else if (description.length < D.minLength) {
        problem(["description"], DESCRIPTION_TOO_SHORT);
      } else if (description.length > D.maxLength) {
        problem(["description"], `The description must be ${D.maxLength} characters or fewer.`);
      }

      if (values.addressMode === "saved") {
        if (values.serviceAddressId === "") {
          problem(["serviceAddressId"], "Choose where the work is to be done.");
        }
      } else {
        const typed = newAddressFields.safeParse(values.newAddress);
        if (!typed.success) {
          for (const issue of typed.error.issues) {
            problem(["newAddress", ...issue.path.map(String)], issue.message);
          }
        }
        if (values.saveAddressToProfile) {
          const label = addressFormSchema.shape.label.safeParse(values.newAddress.label);
          if (!label.success) {
            problem(
              ["newAddress", "label"],
              values.newAddress.label.trim() === ""
                ? "Enter a label so you can find this address again, like Home."
                : (label.error.issues[0]?.message ?? "Enter a label."),
            );
          }
        }
      }

      if (values.preferredDate === "") {
        problem(["preferredDate"], "Choose a date.");
      } else if (!isDateOnly(values.preferredDate)) {
        problem(["preferredDate"], PREFERRED_DATE_INVALID_MESSAGE);
      } else if (values.preferredDate < limits.min) {
        problem(["preferredDate"], PREFERRED_DATE_TOO_SOON_MESSAGE);
      } else if (values.preferredDate > limits.max) {
        problem(["preferredDate"], PREFERRED_DATE_TOO_LATE_MESSAGE);
      }

      if (values.preferredWindow === "") {
        problem(["preferredWindow"], "Choose a time window.");
      }
    });
}

/** The labels the error summary and screen readers use for each field. */
export const REQUEST_FIELD_LABELS: Record<string, string> = {
  serviceId: "Service",
  description: "Problem description",
  serviceAddressId: "Service address",
  "newAddress.label": "Address label",
  "newAddress.line1": "Street address",
  "newAddress.line2": "Address line 2",
  "newAddress.city": "City",
  "newAddress.region": "State or region",
  "newAddress.postalCode": "Postal code",
  "newAddress.accessNotes": "Access notes",
  preferredDate: "Preferred date",
  preferredWindow: "Preferred time window",
};

// ---- Preselecting a service ---------------------------------------------------------------------

export interface ServicePreselection {
  /** The service to start with, or `null` when none was asked for or it cannot be chosen. */
  serviceId: string | null;
  /** True when a service was asked for (`?service=<slug>`) but is not an active one. */
  unavailable: boolean;
}

/**
 * The service named by the page's `?service=<slug>`. The slug is only looked up among the active
 * services: an unknown or inactive one (unpublished, archived, a typo) preselects nothing and says
 * so, and the customer chooses (the server refuses an inactive service in any case, FR-006).
 */
export function resolveServicePreselection(
  slug: string | undefined,
  services: readonly Pick<PublicServiceDto, "id" | "slug">[],
): ServicePreselection {
  if (slug === undefined || slug === "") {
    return { serviceId: null, unavailable: false };
  }
  const match = services.find((service) => service.slug === slug);
  return match === undefined
    ? { serviceId: null, unavailable: true }
    : { serviceId: match.id, unavailable: false };
}

/** The `service` search parameter as a bounded string, or `undefined`. */
export function serviceSlugParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const slug = first?.trim().slice(0, 100);
  return slug === undefined || slug === "" ? undefined : slug;
}

// ---- Starting values ----------------------------------------------------------------------------

/** The default saved address, else the first, else none. */
export function defaultAddressId(addresses: readonly ServiceAddressDto[]): string {
  return (addresses.find((address) => address.isDefault) ?? addresses[0])?.id ?? "";
}

export function initialRequestValues(input: {
  preselectedServiceId: string | null;
  addresses: readonly ServiceAddressDto[];
}): RequestFormValues {
  const { preselectedServiceId, addresses } = input;
  return {
    serviceId: preselectedServiceId ?? "",
    description: "",
    // With no saved address the form starts with the fields to type one in.
    addressMode: addresses.length > 0 ? "saved" : "new",
    serviceAddressId: defaultAddressId(addresses),
    newAddress: { ...EMPTY_NEW_ADDRESS },
    saveAddressToProfile: false,
    preferredDate: "",
    preferredWindow: "",
  };
}

// ---- To the API ---------------------------------------------------------------------------------

/**
 * The body for `POST /requests`. The address goes as either the saved address's id or the typed
 * fields: never both, and the label only when the address is being saved. Values are trimmed here
 * as well; the API trims again.
 */
export function toRequestBody(
  values: RequestFormValues,
  submissionKey: string,
): CreateServiceRequestBody {
  if (values.preferredWindow === "") {
    // The form's validation stops this first; the check narrows the type.
    throw new Error("A time window must be chosen before the request is sent.");
  }
  const common = {
    serviceId: values.serviceId,
    description: values.description.trim(),
    preferredDate: values.preferredDate,
    preferredWindow: values.preferredWindow,
    submissionKey,
  };

  if (values.addressMode === "saved") {
    return { ...common, serviceAddressId: values.serviceAddressId };
  }

  const { label, ...address } = toAddressBody(values.newAddress);
  return {
    ...common,
    newAddress: values.saveAddressToProfile ? { label, ...address } : address,
    saveAddressToProfile: values.saveAddressToProfile,
  };
}
