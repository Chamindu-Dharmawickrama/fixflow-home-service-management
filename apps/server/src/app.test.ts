import request from "supertest";
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "./lib/db.js";
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

  it("never touches the database (D-14), so a database outage cannot fail the platform health check", async () => {
    const touched: string[] = [];
    // A client that records, then refuses, any use at all.
    const prisma = new Proxy(
      {},
      {
        get(_target, property) {
          touched.push(String(property));
          throw new Error("The liveness check must not use the database.");
        },
      },
    ) as unknown as PrismaClient;
    const { app } = buildTestApp({ prisma });

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
    expect(touched).toEqual([]);
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
