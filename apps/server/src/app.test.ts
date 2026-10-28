import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "./test/build-test-app.js";
import { expectApiError } from "./test/http.js";

describe("GET /api/v1/health", () => {
  it("reports that the API is up", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ data: { status: "ok" } });
  });

  it("needs nothing but the platform dependencies (no database)", async () => {
    const { app, deps } = buildTestApp();

    // `AppDeps` holds config, clock, logger, rate limiter and limits; there is no database client.
    expect(Object.keys(deps).sort()).toEqual([
      "clock",
      "config",
      "logger",
      "rateLimiter",
      "rateLimits",
    ]);
    expect((await request(app).get("/api/v1/health")).body).toEqual({ data: { status: "ok" } });
  });

  it("is only served under the /api/v1 prefix", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/health");

    expectApiError(response, { status: 404, code: "NOT_FOUND" });
  });
});

describe("unmatched routes", () => {
  it("return the JSON error contract with a 404", async () => {
    const { app } = buildTestApp();

    const response = await request(app).get("/api/v1/does-not-exist");

    const error = expectApiError(response, { status: 404, code: "NOT_FOUND" });
    expect(error.message).toBe("The requested resource was not found.");
    expect(error.fieldErrors).toBeUndefined();
  });

  it.each(["post", "put", "patch", "delete"] as const)("also cover %s requests", async (method) => {
    const { app } = buildTestApp();

    const response = await request(app)[method]("/api/v1/does-not-exist");

    expectApiError(response, { status: 404, code: "NOT_FOUND" });
  });
});
