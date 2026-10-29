import {
  ErrorCode,
  type FieldErrors,
  LIMITS,
  PricingMode,
  ServiceAction,
  ServiceCatalogueState,
  serviceCatalogueState,
  SLUG_MAX_LENGTH,
} from "@fixflow/shared";

import { conflict } from "../../lib/errors.js";

/**
 * Pure rules for the service catalogue (FR-101, D-50): where a service can go from where it is, what
 * the admin may do (D-43), and how a free slug is found. Every change of `isPublished` or
 * `archivedAt` goes through {@link applyTransition}; no other code writes those columns.
 */

/** The two columns that make up a service's place in the catalogue. */
export interface Lifecycle {
  isPublished: boolean;
  archivedAt: Date | null;
}

export type LifecycleAction = "PUBLISH" | "UNPUBLISH" | "ARCHIVE" | "RESTORE";

/** What the admin can do from each state (D-43). Editing is always allowed; the rest follow the lifecycle. */
const ACTIONS_BY_STATE: Record<ServiceCatalogueState, readonly ServiceAction[]> = {
  PUBLISHED: [ServiceAction.EDIT, ServiceAction.UNPUBLISH, ServiceAction.ARCHIVE],
  UNPUBLISHED: [ServiceAction.EDIT, ServiceAction.PUBLISH, ServiceAction.ARCHIVE],
  ARCHIVED: [ServiceAction.EDIT, ServiceAction.RESTORE],
};

export function availableActions(state: ServiceCatalogueState): ServiceAction[] {
  return [...ACTIONS_BY_STATE[state]];
}

/** The state an action starts from, and the state it ends in. */
const TRANSITIONS: Record<
  LifecycleAction,
  { from: readonly ServiceCatalogueState[]; to: ServiceCatalogueState }
> = {
  PUBLISH: { from: ["UNPUBLISHED"], to: "PUBLISHED" },
  UNPUBLISH: { from: ["PUBLISHED"], to: "UNPUBLISHED" },
  ARCHIVE: { from: ["PUBLISHED", "UNPUBLISHED"], to: "ARCHIVED" },
  // A restored service comes back unpublished: bringing it back to the website is a decision of its own.
  RESTORE: { from: ["ARCHIVED"], to: "UNPUBLISHED" },
};

const ACTION_LABELS: Record<LifecycleAction, string> = {
  PUBLISH: "publish",
  UNPUBLISH: "unpublish",
  ARCHIVE: "archive",
  RESTORE: "restore",
};

/** The state a lifecycle action leads to; `undefined` if the action cannot be taken from `state`. */
export function stateAfter(
  state: ServiceCatalogueState,
  action: LifecycleAction,
): ServiceCatalogueState | undefined {
  const transition = TRANSITIONS[action];
  return transition.from.includes(state) ? transition.to : undefined;
}

/**
 * The columns after a lifecycle action. Throws `409 INVALID_STATE_TRANSITION` when the action does
 * not apply to the current state (publishing an archived service, archiving it twice).
 */
export function applyTransition(current: Lifecycle, action: LifecycleAction, now: Date): Lifecycle {
  const state = serviceCatalogueState(current);
  const next = stateAfter(state, action);
  if (next === undefined) {
    throw conflict(`You can't ${ACTION_LABELS[action]} a service that is ${stateWords(state)}.`, {
      code: ErrorCode.INVALID_STATE_TRANSITION,
      details: { currentStatus: state, action },
    });
  }
  return {
    isPublished: next === ServiceCatalogueState.PUBLISHED,
    archivedAt: next === ServiceCatalogueState.ARCHIVED ? now : null,
  };
}

function stateWords(state: ServiceCatalogueState): string {
  return state === "ARCHIVED" ? "archived" : state === "PUBLISHED" ? "published" : "unpublished";
}

/**
 * The lifecycle action that makes `isPublished` what the caller asked for, or `undefined` when the
 * service already is (publishing a published service is not an error, it is nothing to do).
 * Unpublishing an archived service is also nothing to do: it is not published.
 */
export function actionForPublishFlag(
  state: ServiceCatalogueState,
  wantsPublished: boolean,
): LifecycleAction | undefined {
  if (wantsPublished) {
    return state === ServiceCatalogueState.PUBLISHED ? undefined : "PUBLISH";
  }
  return state === ServiceCatalogueState.PUBLISHED ? "UNPUBLISH" : undefined;
}

/** `409 STALE_STATE` when the caller acted on a state the service is no longer in (D-46). */
export function assertExpectedStatus(
  actual: ServiceCatalogueState,
  expected: ServiceCatalogueState | undefined,
): void {
  if (expected !== undefined && expected !== actual) {
    throw conflict("This service was changed by someone else. Reload it and try again.", {
      code: ErrorCode.STALE_STATE,
      details: { currentStatus: actual },
    });
  }
}

/** The editable content of a service as stored. Lifecycle (`isPublished`, `archivedAt`) is separate. */
export interface ServiceValues {
  name: string;
  slug: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  inclusions: string[];
  estimatedDurationMinutes: number | null;
  pricingMode: PricingMode;
  /** Two-decimal text (`"129.00"`) or `null`. */
  startingPrice: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

export type ServiceField = keyof ServiceValues;

/** A `PATCH`: any subset of the content. `null` clears an optional field. */
export type ServicePatch = { [Field in ServiceField]?: ServiceValues[Field] | undefined };

/** The fields in form order; the allowlist of names an activity event may carry. */
export const SERVICE_FIELDS = [
  "name",
  "slug",
  "category",
  "shortDescription",
  "fullDescription",
  "inclusions",
  "estimatedDurationMinutes",
  "pricingMode",
  "startingPrice",
  "imageKey",
  "imageUrl",
  "sortOrder",
] as const satisfies readonly ServiceField[];

/**
 * What the service would look like after a patch. Sent fields replace stored ones. Switching a
 * service to "request a quote" without saying anything about the price clears the price: a price
 * only means something with fixed pricing, and the old one must not linger unseen.
 */
export function mergeServiceValues(current: ServiceValues, patch: ServicePatch): ServiceValues {
  const sent = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<ServiceValues>;
  const merged: ServiceValues = { ...current, ...sent };
  if (sent.pricingMode === PricingMode.QUOTE_REQUIRED && sent.startingPrice === undefined) {
    merged.startingPrice = null;
  }
  return merged;
}

/** Rules between fields, checked on the values that would be stored. Empty when all is well. */
export function validateServiceValues(values: ServiceValues): FieldErrors {
  const errors: FieldErrors = {};
  if (values.pricingMode === PricingMode.FIXED && values.startingPrice === null) {
    errors.startingPrice = "Enter a starting price for a fixed-price service.";
  }
  if (values.pricingMode === PricingMode.QUOTE_REQUIRED && values.startingPrice !== null) {
    errors.startingPrice =
      'A starting price is only used with fixed pricing. Leave it empty for "Request a quote".';
  }
  if (values.imageKey !== null && values.imageUrl !== null) {
    errors.imageUrl = "Choose either a bundled picture or a web address, not both.";
  }
  return errors;
}

/** The names of the fields whose value differs, in form order. Inclusions compare item by item. */
export function changedServiceFields(current: ServiceValues, next: ServiceValues): ServiceField[] {
  return SERVICE_FIELDS.filter((field) => {
    const before = current[field];
    const after = next[field];
    return Array.isArray(before) && Array.isArray(after)
      ? before.length !== after.length || before.some((item, index) => item !== after[index])
      : before !== after;
  });
}

/**
 * True for a two-decimal price from 0.01 to 999,999.99. Compared in whole cents, not as a float
 * (D-18). Call it with text that already has exactly two decimals.
 */
export function isValidStartingPrice(value: string): boolean {
  const cents = BigInt(value.replace(".", ""));
  return (
    cents >= BigInt(LIMITS.service.startingPrice.min.replace(".", "")) &&
    cents <= BigInt(LIMITS.service.startingPrice.max.replace(".", ""))
  );
}

/**
 * The first slug that is not taken: `ac-repair`, then `ac-repair-2`, `ac-repair-3`, ... The base is
 * shortened when a suffix would push the slug past the maximum length.
 */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * What the activity history says about a lifecycle action: the event name (`service.archived`) and
 * the verb phrase staff read ("archived"). Both are fixed text, never the service's own words.
 */
export const LIFECYCLE_EVENTS: Record<LifecycleAction, { action: string; verb: string }> = {
  PUBLISH: { action: "service.published", verb: "published" },
  UNPUBLISH: { action: "service.unpublished", verb: "unpublished" },
  ARCHIVE: { action: "service.archived", verb: "archived" },
  RESTORE: { action: "service.restored", verb: "restored" },
};
