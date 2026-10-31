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

  // Authentication and access (T05)
  /** 403 — an unsafe request whose `Origin` is not the web app's origin (CSRF defence, D-11). */
  CSRF_ORIGIN_MISMATCH: "CSRF_ORIGIN_MISMATCH",
  /** 401 — sign-in failed. Deliberately the same for an unknown email, a wrong password and a Google-only account. */
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  /** 403 — the account was deactivated. Only revealed after a correct password or a verified Google sign-in. */
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  /** 409 — registration with an email that already has an account. */
  EMAIL_TAKEN: "EMAIL_TAKEN",
  /** 403 — public sign-up is switched off (`PUBLIC_SIGNUP_ENABLED=false`). */
  SIGNUP_DISABLED: "SIGNUP_DISABLED",
  /** 401 — the Google ID token could not be verified. */
  INVALID_GOOGLE_CREDENTIAL: "INVALID_GOOGLE_CREDENTIAL",
  /** 403 — Google reports the email address as unverified. */
  GOOGLE_EMAIL_NOT_VERIFIED: "GOOGLE_EMAIL_NOT_VERIFIED",
  /** 503 — Google sign-in is not configured on this server (`GOOGLE_CLIENT_ID`). */
  GOOGLE_SIGN_IN_UNAVAILABLE: "GOOGLE_SIGN_IN_UNAVAILABLE",
  /** 400 — the password-reset token is invalid, expired or already used. */
  INVALID_RESET_TOKEN: "INVALID_RESET_TOKEN",
  /** 503 — the server cannot send e-mail, so password reset is unavailable. */
  PASSWORD_RESET_UNAVAILABLE: "PASSWORD_RESET_UNAVAILABLE",
  /** 422 — the current password given when changing a password is wrong. */
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  /** 409 — the account signs in with Google only and has no password to change. */
  PASSWORD_NOT_SET: "PASSWORD_NOT_SET",
  /** 403 — a demo account's password cannot be changed or reset while demo mode is on (D-09). */
  DEMO_ACCOUNT_LOCKED: "DEMO_ACCOUNT_LOCKED",

  // Service catalogue (T07)
  /** 409 — another service already uses this slug (its web address). */
  SLUG_TAKEN: "SLUG_TAKEN",

  // Customer profile and addresses (T10)
  /** 409 — the customer already has the maximum number of saved addresses. */
  ADDRESS_LIMIT_REACHED: "ADDRESS_LIMIT_REACHED",

  // Service requests (T11)
  /**
   * 422 — the service chosen for a request is not open to requests: unpublished, archived or
   * unknown (FR-006). Not `SERVICE_UNAVAILABLE`, which already means "503, a dependency is down".
   */
  SERVICE_INACTIVE: "SERVICE_INACTIVE",

  // Quotations (T14)
  /** 409 — the request already has a draft quotation; `details.quotationId` is the existing draft. */
  DRAFT_EXISTS: "DRAFT_EXISTS",
  /** 409 — only a draft quotation can be edited; a sent, voided or answered one is fixed (BR-07). */
  QUOTATION_NOT_EDITABLE: "QUOTATION_NOT_EDITABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
