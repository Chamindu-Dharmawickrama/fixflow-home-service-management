import { ErrorCode } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  isAppError,
  notFound,
  payloadTooLarge,
  rateLimited,
  unauthorized,
  validation,
} from "./errors.js";

describe("AppError", () => {
  it("carries status, code, message and optional context", () => {
    const cause = new Error("root cause");
    const error = new AppError(409, ErrorCode.CONFLICT, "Already there.", {
      fieldErrors: { email: "Taken." },
      details: { currentStatus: "SENT" },
      retryAfterSeconds: 5,
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.status).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Already there.");
    expect(error.fieldErrors).toEqual({ email: "Taken." });
    expect(error.details).toEqual({ currentStatus: "SENT" });
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.cause).toBe(cause);
  });

  it("leaves optional context undefined", () => {
    const error = new AppError(400, ErrorCode.BAD_REQUEST, "No.");

    expect(error.fieldErrors).toBeUndefined();
    expect(error.details).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("is recognised by isAppError", () => {
    expect(isAppError(badRequest())).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError({ status: 400 })).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe("error helpers", () => {
  it.each([
    ["badRequest", badRequest(), 400, "BAD_REQUEST"],
    ["unauthorized", unauthorized(), 401, "UNAUTHENTICATED"],
    ["forbidden", forbidden(), 403, "FORBIDDEN"],
    ["notFound", notFound(), 404, "NOT_FOUND"],
    ["conflict", conflict("Clash."), 409, "CONFLICT"],
    ["payloadTooLarge", payloadTooLarge(), 413, "PAYLOAD_TOO_LARGE"],
    ["validation", validation({ name: "Required." }), 422, "VALIDATION_ERROR"],
    ["rateLimited", rateLimited(30), 429, "RATE_LIMITED"],
  ])("%s maps to its HTTP status and error code", (_name, error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("lets conflict carry a more specific 409 code", () => {
    const stale = conflict("Reload.", {
      code: ErrorCode.STALE_STATE,
      details: { currentStatus: "SENT" },
    });
    const transition = conflict("Not allowed.", { code: ErrorCode.INVALID_STATE_TRANSITION });

    expect(stale.status).toBe(409);
    expect(stale.code).toBe("STALE_STATE");
    expect(stale.details).toEqual({ currentStatus: "SENT" });
    expect(transition.status).toBe(409);
    expect(transition.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("keeps the field errors on a validation error", () => {
    const error = validation({ "lines.2.quantity": "Too small." }, "Check the form.");

    expect(error.fieldErrors).toEqual({ "lines.2.quantity": "Too small." });
    expect(error.message).toBe("Check the form.");
  });

  it("records how long a rate-limited caller should wait", () => {
    expect(rateLimited(42).retryAfterSeconds).toBe(42);
  });

  it("accepts a custom message and a cause", () => {
    const cause = new Error("db");
    const error = notFound("No such quotation.", { cause });

    expect(error.message).toBe("No such quotation.");
    expect(error.cause).toBe(cause);
  });
});
