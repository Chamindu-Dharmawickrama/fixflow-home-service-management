import { describe, expect, it } from "vitest";

import { ApiError, describeApiError } from "./errors";

function apiError(options: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) {
  return new ApiError({
    status: 409,
    code: "STALE_STATE",
    message: "Reload and try again.",
    ...options,
  });
}

describe("describeApiError", () => {
  it("shows the API's own message, which is written for people", () => {
    expect(describeApiError(apiError())).toBe("Reload and try again.");
  });

  it("explains a rate limit with the wait the server asked for", () => {
    expect(
      describeApiError(apiError({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 300 })),
    ).toBe("Too many requests. Please wait 5 minutes and try again.");
    expect(describeApiError(apiError({ status: 429, code: "RATE_LIMITED" }))).toBe(
      "Too many requests. Please wait a minute and try again.",
    );
  });

  it("never shows a raw exception message", () => {
    expect(describeApiError(new Error("connect ECONNREFUSED 10.0.0.5:4000"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(describeApiError("boom")).toBe("Something went wrong. Please try again.");
    expect(describeApiError(undefined, "Custom fallback.")).toBe("Custom fallback.");
  });

  it("falls back when an API error has no message", () => {
    expect(describeApiError(apiError({ message: "" }))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
