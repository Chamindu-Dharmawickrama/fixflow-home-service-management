import type { ApiErrorBody } from "@fixflow/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "../test/build-test-app.js";
import { bodyOf } from "../test/http.js";
import { isValidRequestId } from "./request-id.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("x-request-id", () => {
  it("is generated as a UUID when the caller sends none", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });

  it("is different for every request", async () => {
    const { app } = buildTestApp();

    const first = await request(app).get("/api/v1/health");
    const second = await request(app).get("/api/v1/health");

    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
  });

  it("propagates a valid incoming ID", async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .get("/api/v1/health")
      .set("x-request-id", "web-4f1c2a9e-0001");

    expect(response.headers["x-request-id"]).toBe("web-4f1c2a9e-0001");
  });

  it("is present on error responses and echoed in the error body", async () => {
    const { app } = buildTestApp({ testRoutes: true });

    const notFound = await request(app)
      .get("/api/v1/nope")
      .set("x-request-id", "caller-supplied-id");
    const failure = await request(app)
      .get("/api/v1/__test__/errors/unknown")
      .set("x-request-id", "another-supplied-id");

    expect(notFound.headers["x-request-id"]).toBe("caller-supplied-id");
    expect(bodyOf<ApiErrorBody>(notFound).error.requestId).toBe("caller-supplied-id");
    expect(failure.headers["x-request-id"]).toBe("another-supplied-id");
    expect(bodyOf<ApiErrorBody>(failure).error.requestId).toBe("another-supplied-id");
  });

  it("is present on preflight and rate-limited responses", async () => {
    const { app } = buildTestApp({ rateLimits: { global: { limit: 1, windowSeconds: 60 } } });

    const preflight = await request(app)
      .options("/api/v1/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    await request(app).get("/api/v1/health");
    const limited = await request(app).get("/api/v1/health");

    expect(preflight.headers["x-request-id"]).toMatch(UUID);
    expect(limited.status).toBe(429);
    expect(limited.headers["x-request-id"]).toMatch(UUID);
  });

  it.each([
    ["too short", "abc"],
    ["too long", "a".repeat(129)],
    ["has spaces", "not a valid id at all"],
    ["has markup", "<script>alert(1)</script>"],
    ["has a path", "../../etc/passwd-x"],
  ])("is replaced when the incoming ID is invalid (%s)", async (_label, incoming) => {
    const { app } = buildTestApp();

    const response = await request(app).get("/api/v1/health").set("x-request-id", incoming);

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });

  it("is logged with the request", async () => {
    const { app, logs } = buildTestApp({ logLevel: "info" });

    await request(app).get("/api/v1/health").set("x-request-id", "trace-me-0001");

    const [entry] = logs.entries();
    expect(entry?.req).toMatchObject({ id: "trace-me-0001" });
  });
});

describe("isValidRequestId", () => {
  it("accepts URL-safe IDs of 8 to 128 characters", () => {
    expect(isValidRequestId("abcd1234")).toBe(true);
    expect(isValidRequestId("a".repeat(128))).toBe(true);
    expect(isValidRequestId("4f1c2a9e-0001_x.y")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidRequestId("abcd123")).toBe(false);
    expect(isValidRequestId("a".repeat(129))).toBe(false);
    expect(isValidRequestId("has space")).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(["a", "b"])).toBe(false);
  });
});
