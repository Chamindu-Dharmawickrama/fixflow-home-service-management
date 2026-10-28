import { ErrorCode, type ErrorDetails, type FieldErrors } from "@fixflow/shared";

export interface AppErrorOptions {
  fieldErrors?: FieldErrors;
  /** Non-sensitive context returned to the client, for example `{ currentStatus: "SENT" }`. */
  details?: ErrorDetails;
  /** Seconds the client should wait; sent as the `Retry-After` header. */
  retryAfterSeconds?: number;
  /** The underlying error, kept for server-side logs only. */
  cause?: unknown;
}

/**
 * An error that is safe to show the caller: its status, code and message are returned verbatim
 * by the central error handler (D-33). Throw it from services and middleware; anything else
 * becomes a generic `500`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors: FieldErrors | undefined;
  readonly details: ErrorDetails | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

type Options = Omit<AppErrorOptions, "fieldErrors" | "retryAfterSeconds">;

/** 400 — the request is malformed. */
export function badRequest(message = "The request is malformed.", options: Options = {}): AppError {
  return new AppError(400, ErrorCode.BAD_REQUEST, message, options);
}

/** 401 — authentication is required or the credentials are not valid. */
export function unauthorized(
  message = "Authentication is required.",
  options: Options = {},
): AppError {
  return new AppError(401, ErrorCode.UNAUTHENTICATED, message, options);
}

/** 403 — the caller is authenticated but not allowed to do this. */
export function forbidden(
  message = "You do not have permission to perform this action.",
  options: Options = {},
): AppError {
  return new AppError(403, ErrorCode.FORBIDDEN, message, options);
}

/** 404 — the resource does not exist, or is not visible to the caller (prevents ID probing). */
export function notFound(
  message = "The requested resource was not found.",
  options: Options = {},
): AppError {
  return new AppError(404, ErrorCode.NOT_FOUND, message, options);
}

/**
 * 409 — the request conflicts with the current state. Use `STALE_STATE` or
 * `INVALID_STATE_TRANSITION` (or a domain code) as `code` when the client should react to it.
 */
export function conflict(message: string, options: Options & { code?: ErrorCode } = {}): AppError {
  const { code = ErrorCode.CONFLICT, ...rest } = options;
  return new AppError(409, code, message, rest);
}

/** 413 — the request body is larger than the server accepts. */
export function payloadTooLarge(
  message = "The request body is too large.",
  options: Options = {},
): AppError {
  return new AppError(413, ErrorCode.PAYLOAD_TOO_LARGE, message, options);
}

/** 422 — the request is well formed but its values are not valid. */
export function validation(
  fieldErrors: FieldErrors,
  message = "The request contains invalid values.",
  options: Options = {},
): AppError {
  return new AppError(422, ErrorCode.VALIDATION_ERROR, message, { ...options, fieldErrors });
}

/** 503 — a dependency the request needs (for example the database) is not available. */
export function serviceUnavailable(
  message = "The service is temporarily unavailable.",
  options: Options = {},
): AppError {
  return new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, message, options);
}

/** 429 — a rate limit was exceeded. */
export function rateLimited(
  retryAfterSeconds: number,
  message = "Too many requests. Please try again later.",
  options: Options = {},
): AppError {
  return new AppError(429, ErrorCode.RATE_LIMITED, message, { ...options, retryAfterSeconds });
}
