import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("GET /api/v1/health", () => {
  it("reports that the API is up", async () => {
    const response = await request(createApp()).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ data: { status: "ok" } });
  });

  it("is only served under the /api/v1 prefix", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(404);
  });
});
