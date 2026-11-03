/**
 * What may be stored in `ActivityEvent.metadata` (D-29, BR-20). Activity history is long-lived
 * and shown to staff, so it holds only facts that are safe everywhere: references, amounts,
 * statuses, dates and ids. Free text a person typed (reasons, notes, descriptions) belongs in its
 * own record, never here. The allowlist is closed: a new key needs a code change and a review.
 */

export type MetadataKind = "string" | "number" | "boolean" | "stringList";

/** Allowed keys and the kind of value each carries. */
export const ACTIVITY_METADATA_KEYS = {
  // Human-readable references (D-17)
  reference: "string",
  requestReference: "string",
  quotationReference: "string",
  replacesReference: "string",
  workOrderReference: "string",
  invoiceReference: "string",
  // What changed, by name only
  serviceName: "string",
  changedFields: "stringList",
  lineItemCount: "number",
  // Money: decimal strings plus an ISO 4217 code, never a JS float (D-18)
  currencyCode: "string",
  amount: "string",
  totalAmount: "string",
  amountPaid: "string",
  balance: "string",
  paymentMethod: "string",
  // Dates and times: ISO 8601 strings
  validUntil: "string",
  issueDate: "string",
  dueDate: "string",
  paymentDate: "string",
  preferredDate: "string",
  scheduledStart: "string",
  scheduledEnd: "string",
  // A reschedule keeps the appointment it replaces (FR-057)
  previousScheduledStart: "string",
  previousScheduledEnd: "string",
  // Choices and flags
  preferredWindow: "string",
  visibility: "string",
  isActive: "boolean",
  isPublished: "boolean",
  // Ids of related records
  technicianId: "string",
  previousTechnicianId: "string",
} as const satisfies Record<string, MetadataKind>;

interface KindValue {
  string: string;
  number: number;
  boolean: boolean;
  stringList: readonly string[];
}

/** The typed shape callers pass as `metadata`. Every key is optional. */
export type ActivityMetadata = {
  [Key in keyof typeof ACTIVITY_METADATA_KEYS]?: KindValue[(typeof ACTIVITY_METADATA_KEYS)[Key]];
};

type CleanMetadata = Record<string, string | number | boolean | string[]>;

/** Thrown when an activity event is built wrongly. A programming error, so it is never shown to a user. */
export class ActivityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityValidationError";
  }
}

const MAX_STRING_LENGTH = 200;
const MAX_LIST_ITEMS = 20;
const MAX_LIST_ITEM_LENGTH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JSON_WEB_TOKEN = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/;
const BEARER = /\bbearer\s+\S{8,}/i;
/** A long unbroken run of token characters: API keys, session tokens, hashes. */
const OPAQUE_TOKEN = /[A-Za-z0-9_\-+/=]{32,}/;
/** A house number, a few words, then a street suffix: "214 Larkspur Lane". */
const STREET_ADDRESS =
  /\b\d{1,6}\s+(?:[\p{L}\d.'-]+\s+){1,4}(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|ter|terrace|pkwy|parkway|hwy|highway|cir|circle)\b\.?/iu;

/** Why a string looks like something that must not be in activity metadata, or `undefined` if it is fine. */
export function sensitiveValueReason(value: string): string | undefined {
  if (UUID.test(value)) {
    return undefined;
  }
  if (EMAIL.test(value)) return "an email address";
  if (JSON_WEB_TOKEN.test(value) || BEARER.test(value)) return "an access token";
  if (OPAQUE_TOKEN.test(value)) return "a token or secret";
  if (STREET_ADDRESS.test(value)) return "a street address";
  return undefined;
}

function wrongKind(key: string, expected: string): ActivityValidationError {
  return new ActivityValidationError(`Activity metadata "${key}" must be ${expected}.`);
}

function checkString(key: string, value: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw new ActivityValidationError(
      `Activity metadata "${key}" is longer than ${maxLength} characters.`,
    );
  }
  const reason = sensitiveValueReason(value);
  if (reason !== undefined) {
    // The value itself is deliberately left out of the message.
    throw new ActivityValidationError(`Activity metadata "${key}" looks like ${reason}.`);
  }
}

/**
 * Checks metadata against the allowlist and returns a clean copy. Throws
 * {@link ActivityValidationError} for an unknown key, a value of the wrong kind, or a string that
 * resembles an email address, a token or a street address. The heuristics are a safety net for
 * mistakes, not a guarantee: the allowlist is the real control.
 */
export function validateActivityMetadata(metadata: unknown): CleanMetadata {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new ActivityValidationError("Activity metadata must be an object.");
  }

  const clean: CleanMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue;
    }
    if (!Object.hasOwn(ACTIVITY_METADATA_KEYS, key)) {
      throw new ActivityValidationError(`Activity metadata key "${key}" is not allowed.`);
    }
    const kind: MetadataKind = ACTIVITY_METADATA_KEYS[key as keyof typeof ACTIVITY_METADATA_KEYS];

    switch (kind) {
      case "string":
        if (typeof value !== "string") throw wrongKind(key, "a string");
        checkString(key, value, MAX_STRING_LENGTH);
        clean[key] = value;
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw wrongKind(key, "a finite number");
        }
        clean[key] = value;
        break;
      case "boolean":
        if (typeof value !== "boolean") throw wrongKind(key, "a boolean");
        clean[key] = value;
        break;
      case "stringList": {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          throw wrongKind(key, "a list of strings");
        }
        const items = value as string[];
        if (items.length > MAX_LIST_ITEMS) {
          throw new ActivityValidationError(
            `Activity metadata "${key}" has more than ${MAX_LIST_ITEMS} items.`,
          );
        }
        for (const item of items) checkString(key, item, MAX_LIST_ITEM_LENGTH);
        clean[key] = [...items];
        break;
      }
    }
  }
  return clean;
}
