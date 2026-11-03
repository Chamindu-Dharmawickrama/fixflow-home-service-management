import { describe, expect, it } from "vitest";

import { ErrorCode } from "./error-codes.js";
import * as shared from "./index.js";

describe("ErrorCode", () => {
  it("is re-exported from the package entry point", () => {
    expect(shared.ErrorCode).toBe(ErrorCode);
  });

  it("seeds the platform codes and the authentication codes", () => {
    expect(Object.keys(ErrorCode).sort()).toEqual(
      [
        "BAD_REQUEST",
        "CONFLICT",
        "FORBIDDEN",
        "INTERNAL_ERROR",
        "INVALID_STATE_TRANSITION",
        "NOT_FOUND",
        "PAYLOAD_TOO_LARGE",
        "RATE_LIMITED",
        "SERVICE_UNAVAILABLE",
        "STALE_STATE",
        "UNAUTHENTICATED",
        "VALIDATION_ERROR",
        // T05 — authentication and access
        "ACCOUNT_DISABLED",
        "CSRF_ORIGIN_MISMATCH",
        "DEMO_ACCOUNT_LOCKED",
        "EMAIL_TAKEN",
        "GOOGLE_EMAIL_NOT_VERIFIED",
        "GOOGLE_SIGN_IN_UNAVAILABLE",
        "INVALID_CREDENTIALS",
        "INVALID_CURRENT_PASSWORD",
        "INVALID_GOOGLE_CREDENTIAL",
        "INVALID_RESET_TOKEN",
        "PASSWORD_NOT_SET",
        "PASSWORD_RESET_UNAVAILABLE",
        "SIGNUP_DISABLED",
        // T07 — service catalogue
        "SLUG_TAKEN",
        // T10 — customer profile and addresses
        "ADDRESS_LIMIT_REACHED",
        // T11 — service requests
        "SERVICE_INACTIVE",
        // T14 — quotations
        "DRAFT_EXISTS",
        "QUOTATION_NOT_EDITABLE",
        // T15 — customer decisions
        "QUOTATION_NOT_AVAILABLE",
        // T17 — scheduling
        "SCHEDULING_CONFLICT",
        "TECHNICIAN_INACTIVE",
      ].sort(),
    );
  });

  it("uses each code as both its key and its wire value, so the two cannot drift apart", () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
  });
});
