import type { ApiErrorBody, ErrorCode, ErrorDetails, FieldErrors } from "@fixflow/shared";

/**
 * `NETWORK_ERROR` = the request never got an answer (offline, the API is down). `UNKNOWN_ERROR` =
 * an error response that did not follow the API's error contract (for example a proxy's HTML page).
 */
export type ApiErrorCode = ErrorCode | "NETWORK_ERROR" | "UNKNOWN_ERROR";

/**
 * An unsuccessful API call, as the web app sees it. Screens switch on `code` (never on the message
 * text), show `fieldErrors` beside their fields, and quote `requestId` so a problem can be traced
 * in the server logs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldErrors | undefined;
  /** Non-sensitive context the API attaches to a conflict, such as the id of the draft that exists. */
  readonly details: ErrorDetails | undefined;
  readonly requestId: string | undefined;
  /** From the `Retry-After` header of a `429`. */
  readonly retryAfterSeconds: number | undefined;

  constructor(options: {
    status: number;
    code: ApiErrorCode;
    message: string;
    fieldErrors?: FieldErrors | undefined;
    details?: ErrorDetails | undefined;
    requestId?: string | undefined;
    retryAfterSeconds?: number | undefined;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/** Turns a non-2xx response into an {@link ApiError}, reading the API's error body when there is one. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (isErrorBody(body)) {
    return new ApiError({
      status: response.status,
      code: body.error.code,
      message: body.error.message,
      fieldErrors: body.error.fieldErrors,
      details: body.error.details,
      requestId: body.error.requestId,
      retryAfterSeconds: retryAfter(response),
    });
  }
  return new ApiError({
    status: response.status,
    code: "UNKNOWN_ERROR",
    message: GENERIC_MESSAGE,
    requestId: response.headers.get("x-request-id") ?? undefined,
    retryAfterSeconds: retryAfter(response),
  });
}

export function networkError(): ApiError {
  return new ApiError({ status: 0, code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE });
}

/**
 * The sentence to show when a request fails and nothing more specific applies. The API's own
 * messages are written for people, so they are shown as they are; a rate limit says how long to
 * wait; anything that is not an API error gets a generic line (never a raw exception message).
 */
export function describeApiError(error: unknown, fallback = GENERIC_MESSAGE): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }
  if (error.code === "RATE_LIMITED") {
    return `Too many requests. Please wait ${describeWait(error.retryAfterSeconds ?? 60)} and try again.`;
  }
  return error.message || fallback;
}

/** "a minute", "5 minutes", "2 hours": a wait in words, for a rate-limit message. */
export function describeWait(seconds: number): string {
  if (seconds <= 60) return "a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}
