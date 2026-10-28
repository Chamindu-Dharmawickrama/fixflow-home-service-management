import { describe, expect, it } from "vitest";

import { ErrorCode } from "./error-codes.js";
import * as shared from "./index.js";

describe("ErrorCode", () => {
  it("is re-exported from the package entry point", () => {
    expect(shared.ErrorCode).toBe(ErrorCode);
  });

  it("seeds the platform codes", () => {
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
      ].sort(),
    );
  });

  it("uses each code as both its key and its wire value, so the two cannot drift apart", () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
  });
});
