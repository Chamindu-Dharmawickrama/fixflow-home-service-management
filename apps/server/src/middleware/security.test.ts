import type { ApiErrorBody, ApiResponse } from "@fixflow/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp, TEST_WEB_ORIGIN } from "../test/build-test-app.js";
import { bodyOf } from "../test/http.js";

const BASE = "/api/v1/__test__";

describe("helmet and basic hardening", () => {
  it("sets the helmet security headers", async () => {
    const { app } = buildTestApp();

    const { headers } = await request(app).get("/api/v1/health");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("does not advertise Express", async () => {
    const { app } = buildTestApp();

    const { headers } = await request(app).get("/api/v1/health");

    expect(headers["x-powered-by"]).toBeUndefined();
  });

  it("sets the security headers on error responses too", async () => {
    const { app } = buildTestApp();

    const { headers, status } = await request(app).get("/api/v1/missing");

    expect(status).toBe(404);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

describe("CORS", () => {
  it("allows WEB_ORIGIN with credentials", async () => {
    const { app } = buildTestApp();

    const { headers } = await request(app).get("/api/v1/health").set("Origin", TEST_WEB_ORIGIN);

    expect(headers["access-control-allow-origin"]).toBe(TEST_WEB_ORIGIN);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(headers.vary).toMatch(/Origin/);
  });

  it("follows WEB_ORIGIN from the configuration", async () => {
    const { app } = buildTestApp({ env: { WEB_ORIGIN: "https://fixflow.example.com" } });

    const allowed = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://fixflow.example.com");
    const previous = await request(app).get("/api/v1/health").set("Origin", TEST_WEB_ORIGIN);

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://fixflow.example.com");
    expect(previous.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([
    ["another site", "https://evil.example.com"],
    ["a look-alike host", "http://localhost:3000.evil.com"],
    ["a different port", "http://localhost:3001"],
    ["a different scheme", "https://localhost:3000"],
    ["a trailing slash", "http://localhost:3000/"],
    ["the null origin", "null"],
  ])("sends no CORS headers to %s", async (_label, origin) => {
    const { app } = buildTestApp();

    const { headers, status } = await request(app).get("/api/v1/health").set("Origin", origin);

    expect(status).toBe(200);
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("sends no CORS headers when there is no Origin header", async () => {
    const { app } = buildTestApp();

    const { headers } = await request(app).get("/api/v1/health");

    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a preflight from WEB_ORIGIN", async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .options("/api/v1/health")
      .set("Origin", TEST_WEB_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(TEST_WEB_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(response.headers["access-control-allow-headers"]).toBe("content-type");
  });

  it("does not approve a preflight from another origin", async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .options("/api/v1/health")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("also covers error responses", async () => {
    const { app } = buildTestApp();

    const { headers, status } = await request(app)
      .get("/api/v1/missing")
      .set("Origin", TEST_WEB_ORIGIN);

    expect(status).toBe(404);
    expect(headers["access-control-allow-origin"]).toBe(TEST_WEB_ORIGIN);
  });
});

describe("request body limits", () => {
  it("accepts a JSON body just under 100 kb", async () => {
    const { app } = buildTestApp({ testRoutes: true });

    const response = await request(app)
      .post(`${BASE}/log-secret`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send({ blob: "x".repeat(90_000) });

    expect(response.status).toBe(200);
  });

  it("rejects a JSON body over 100 kb with 413", async () => {
    const { app } = buildTestApp({ testRoutes: true });

    const response = await request(app)
      .post(`${BASE}/log-secret`)
      .set("Origin", TEST_WEB_ORIGIN)
      .send({ blob: "x".repeat(110_000) });

    expect(response.status).toBe(413);
    expect(bodyOf<ApiErrorBody>(response).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("trust proxy", () => {
  const forwarded = { "X-Forwarded-For": "203.0.113.50" };

  it("ignores forwarding headers by default, so clients cannot spoof their IP", async () => {
    const { app } = buildTestApp({ testRoutes: true });

    const response = await request(app).get(`${BASE}/ip`).set(forwarded);

    expect(bodyOf<ApiResponse<{ ip: string }>>(response).data.ip).not.toBe("203.0.113.50");
  });

  it("uses the forwarded client IP when TRUST_PROXY is set", async () => {
    const { app } = buildTestApp({ testRoutes: true, env: { TRUST_PROXY: "1" } });

    const response = await request(app).get(`${BASE}/ip`).set(forwarded);

    expect(bodyOf<ApiResponse<{ ip: string }>>(response).data.ip).toBe("203.0.113.50");
  });
});
