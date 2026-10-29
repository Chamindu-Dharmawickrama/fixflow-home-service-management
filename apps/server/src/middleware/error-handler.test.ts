import { type ApiErrorBody, ErrorCode } from "@fixflow/shared";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { buildTestApp, TEST_WEB_ORIGIN, type TestApp } from "../test/build-test-app.js";
import { bodyOf, expectApiError } from "../test/http.js";
import { LEAKY_ERROR_MESSAGE } from "../test/test-routes.js";

const BASE = "/api/v1/__test__";

describe("error contract (D-33)", () => {
  let testApp: TestApp;

  beforeAll(() => {
    testApp = buildTestApp({ testRoutes: true });
  });

  describe("AppError", () => {
    it.each([
      ["bad-request", 400, ErrorCode.BAD_REQUEST],
      ["unauthorized", 401, ErrorCode.UNAUTHENTICATED],
      ["forbidden", 403, ErrorCode.FORBIDDEN],
      ["not-found", 404, ErrorCode.NOT_FOUND],
      ["conflict", 409, ErrorCode.CONFLICT],
      ["stale-state", 409, ErrorCode.STALE_STATE],
      ["invalid-transition", 409, ErrorCode.INVALID_STATE_TRANSITION],
      ["validation", 422, ErrorCode.VALIDATION_ERROR],
      ["payload-too-large", 413, ErrorCode.PAYLOAD_TOO_LARGE],
      ["rate-limited", 429, ErrorCode.RATE_LIMITED],
    ])("%s is returned with its status and code", async (kind, status, code) => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/${kind}`);

      expectApiError(response, { status, code });
    });

    it("returns the message the code raised", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/invalid-transition`);

      expect(bodyOf<ApiErrorBody>(response).error.message).toBe(
        "This quotation can no longer be accepted.",
      );
    });

    it("returns safe details when the error carries them", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/stale-state`);

      expect(bodyOf<ApiErrorBody>(response).error.details).toEqual({ currentStatus: "SENT" });
    });

    it("returns fieldErrors for a validation error", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/validation`);

      expect(bodyOf<ApiErrorBody>(response).error.fieldErrors).toEqual({
        email: "Enter a valid email address.",
      });
    });

    it("omits fieldErrors and details when there are none", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/forbidden`);

      expect(response.body).toEqual({
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
          requestId: response.headers["x-request-id"],
        },
      });
    });

    it("sends Retry-After for a rate-limited error", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/app/rate-limited`);

      expect(response.headers["retry-after"]).toBe("42");
    });
  });

  describe("400 malformed JSON", () => {
    it("is rejected as BAD_REQUEST", async () => {
      const response = await request(testApp.app)
        .post(`${BASE}/log-secret`)
        .set("Origin", TEST_WEB_ORIGIN)
        .set("Content-Type", "application/json")
        .send('{"broken": ');

      const error = expectApiError(response, { status: 400, code: "BAD_REQUEST" });
      expect(error.message).toBe("The request body is not valid JSON.");
    });

    it("does not echo the offending body or a parser message", async () => {
      const response = await request(testApp.app)
        .post(`${BASE}/log-secret`)
        .set("Origin", TEST_WEB_ORIGIN)
        .set("Content-Type", "application/json")
        .send('{"password": "hunter2-body-secret", ');

      expect(JSON.stringify(response.body)).not.toContain("hunter2-body-secret");
      expect(JSON.stringify(response.body)).not.toMatch(/position|Unexpected token|JSON\.parse/);
    });

    it("rejects a top-level JSON primitive (strict mode)", async () => {
      const response = await request(testApp.app)
        .post(`${BASE}/log-secret`)
        .set("Origin", TEST_WEB_ORIGIN)
        .set("Content-Type", "application/json")
        .send('"just a string"');

      expectApiError(response, { status: 400, code: "BAD_REQUEST" });
    });
  });

  describe("404 not found", () => {
    it("is returned for an unmatched route", async () => {
      const response = await request(testApp.app).get("/api/v1/nothing-here");

      expectApiError(response, { status: 404, code: "NOT_FOUND" });
    });
  });

  describe("413 payload too large", () => {
    it("is returned when the body exceeds 100 kb", async () => {
      const response = await request(testApp.app)
        .post(`${BASE}/log-secret`)
        .set("Origin", TEST_WEB_ORIGIN)
        .send({ blob: "x".repeat(150_000) });

      const error = expectApiError(response, { status: 413, code: "PAYLOAD_TOO_LARGE" });
      expect(error.message).toBe("The request body is too large.");
    });
  });

  describe("422 validation", () => {
    it("lists fieldErrors keyed by dotted path", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/zod`);

      const error = expectApiError(response, { status: 422, code: "VALIDATION_ERROR" });
      const fieldErrors = error.fieldErrors ?? {};
      expect(Object.keys(fieldErrors).sort()).toEqual([
        "customerName",
        "lines.2.quantity",
        "surprise",
      ]);
      expect(fieldErrors.surprise).toBe("Unknown field.");
      expect(fieldErrors["lines.2.quantity"]).toMatch(/\S/);
    });
  });

  describe("429 rate limited", () => {
    it("is returned with the contract and a Retry-After header", async () => {
      const limited = buildTestApp({ rateLimits: { global: { limit: 1, windowSeconds: 60 } } });
      await request(limited.app).get("/api/v1/health");

      const response = await request(limited.app).get("/api/v1/health");

      const error = expectApiError(response, { status: 429, code: "RATE_LIMITED" });
      expect(error.message).toBe("Too many requests. Please try again later.");
      expect(response.headers["retry-after"]).toBe("60");
    });
  });

  describe("500 unexpected errors", () => {
    it.each(["unknown", "unknown-async", "non-error"])(
      "%s becomes a generic INTERNAL_ERROR",
      async (kind) => {
        const response = await request(testApp.app).get(`${BASE}/errors/${kind}`);

        const error = expectApiError(response, { status: 500, code: "INTERNAL_ERROR" });
        expect(error.message).toBe("Something went wrong on our side. Please try again.");
        expect(error.fieldErrors).toBeUndefined();
        expect(error.details).toBeUndefined();
      },
    );

    it("never includes a stack trace or the internal message in the body", async () => {
      const response = await request(testApp.app).get(`${BASE}/errors/unknown`);
      const raw = response.text;

      expect(raw).not.toContain(LEAKY_ERROR_MESSAGE);
      expect(raw).not.toContain("hunter2");
      expect(raw).not.toContain("ECONNREFUSED");
      expect(raw).not.toMatch(/\bat\s+\S+\s+\(.*:\d+:\d+\)/); // "at fn (file:line:col)"
      expect(raw).not.toMatch(/stack/i);
      expect(raw).not.toContain("error-handler");
      expect(raw).not.toContain("test-routes");
    });

    it("logs the cause with its stack on the server", async () => {
      const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

      const response = await request(app).get(`${BASE}/errors/unknown`);

      const failure = logs.entries().find((entry) => entry.level === "error");
      const { err, req, res } = failure as {
        err: { message: string; stack: string };
        req: { id: string };
        res: { statusCode: number };
      };
      expect(err.message).toBe(LEAKY_ERROR_MESSAGE);
      expect(err.stack).toContain("test-routes");
      expect(res.statusCode).toBe(500);
      expect(req.id).toBe(response.headers["x-request-id"]);
      expect(logs.entries().filter((entry) => entry.level === "error")).toHaveLength(1);
    });

    it("logs expected errors as warnings without a stack", async () => {
      const { app, logs } = buildTestApp({ testRoutes: true, logLevel: "info" });

      await request(app).get(`${BASE}/errors/app/forbidden`);

      const [entry] = logs.entries();
      expect(entry?.level).toBe("warn");
      expect(entry).not.toHaveProperty("err");
    });
  });

  it("keeps working after an error (the app is not left in a bad state)", async () => {
    await request(testApp.app).get(`${BASE}/errors/unknown`);

    const response = await request(testApp.app).get("/api/v1/health");

    expect(response.status).toBe(200);
  });
});
