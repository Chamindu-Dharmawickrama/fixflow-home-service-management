/**
 * Machine-readable error codes returned in `error.code` by the API (D-33). The web app switches
 * on these, never on the human-readable message. Later tasks add domain codes to this object.
 */
export const ErrorCode = {
  /** 400 — the request itself is malformed (for example invalid JSON). */
  BAD_REQUEST: "BAD_REQUEST",
  /** 401 — no valid session. */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** 403 — authenticated, but the role is not allowed (or the CSRF check failed). */
  FORBIDDEN: "FORBIDDEN",
  /** 404 — the resource or route does not exist, or is not owned by the caller. */
  NOT_FOUND: "NOT_FOUND",
  /** 409 — the request conflicts with the current state of the resource. */
  CONFLICT: "CONFLICT",
  /** 409 — the record changed since the caller loaded it (`expectedStatus` mismatch, D-46). */
  STALE_STATE: "STALE_STATE",
  /** 409 — the requested status transition is not allowed from the current status. */
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  /** 422 — a schema validation failure; `fieldErrors` names the offending fields. */
  VALIDATION_ERROR: "VALIDATION_ERROR",
  /** 413 — the request body exceeds the size limit. */
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  /** 429 — a rate limit was exceeded; see the `Retry-After` header. */
  RATE_LIMITED: "RATE_LIMITED",
  /** 500 — an unexpected server failure. The message is always generic. */
  INTERNAL_ERROR: "INTERNAL_ERROR",
  /** 503 — a dependency (for example the database) is not available; see `/api/v1/health/ready`. */
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
