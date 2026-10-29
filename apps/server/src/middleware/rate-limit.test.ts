import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "../lib/rate-limit/index.js";
import { buildTestApp, buildTestDeps } from "../test/build-test-app.js";
import { expectApiError } from "../test/http.js";
import { LIMITED_ROUTE_RULE } from "../test/test-routes.js";
import { rateLimit } from "./rate-limit.js";

const BASE = "/api/v1/__test__";
const GLOBAL_3_PER_MINUTE = { global: { limit: 3, windowSeconds: 60 } };

describe("global rate limit", () => {
  it("rejects requests over the limit with 429 and Retry-After", async () => {
    const { app } = buildTestApp({ rateLimits: GLOBAL_3_PER_MINUTE });

    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).get("/api/v1/health")).status).toBe(200);
    }
    const response = await request(app).get("/api/v1/health");

    expectApiError(response, { status: 429, code: "RATE_LIMITED" });
    expect(response.headers["retry-after"]).toBe("60");
  });

  it("counts every route, including unmatched ones", async () => {
    const { app } = buildTestApp({ rateLimits: GLOBAL_3_PER_MINUTE });

    await request(app).get("/api/v1/one");
    await request(app).get("/api/v1/two");
    await request(app).get("/api/v1/health");
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(429);
  });

  it("lets requests through again after the window, using the fake clock", async () => {
    const { app, clock } = buildTestApp({ rateLimits: GLOBAL_3_PER_MINUTE });
    for (let i = 0; i < 3; i += 1) await request(app).get("/api/v1/health");
    expect((await request(app).get("/api/v1/health")).status).toBe(429);

    clock.advanceSeconds(59);
    expect((await request(app).get("/api/v1/health")).status).toBe(429);

    clock.advanceSeconds(1);
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
  });

  it("counts down Retry-After as time passes", async () => {
    const { app, clock } = buildTestApp({ rateLimits: GLOBAL_3_PER_MINUTE });
    for (let i = 0; i < 3; i += 1) await request(app).get("/api/v1/health");

    clock.advanceSeconds(25);
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("35");
  });

  it("counts each client IP separately when proxy headers are trusted", async () => {
    const { app } = buildTestApp({ rateLimits: GLOBAL_3_PER_MINUTE, env: { TRUST_PROXY: "1" } });
    const from = (ip: string) => request(app).get("/api/v1/health").set("X-Forwarded-For", ip);
    for (let i = 0; i < 3; i += 1) await from("203.0.113.1");

    expect((await from("203.0.113.1")).status).toBe(429);
    expect((await from("203.0.113.2")).status).toBe(200);
  });

  it("is not tripped by ordinary test traffic, because tests scale the limits up", async () => {
    const { app, deps } = buildTestApp();

    expect(deps.rateLimits.global.limit).toBeGreaterThan(10_000);
    for (let i = 0; i < 20; i += 1) {
      expect((await request(app).get("/api/v1/health")).status).toBe(200);
    }
  });
});

describe("named route limit", () => {
  it("limits one route without affecting others", async () => {
    const { app } = buildTestApp({ testRoutes: true });

    for (let i = 0; i < LIMITED_ROUTE_RULE.limit; i += 1) {
      expect((await request(app).get(`${BASE}/limited`)).status).toBe(200);
    }
    const limited = await request(app).get(`${BASE}/limited`);
    const other = await request(app).get("/api/v1/health");

    expectApiError(limited, { status: 429, code: "RATE_LIMITED" });
    expect(limited.headers["retry-after"]).toBe("60");
    expect(other.status).toBe(200);
  });

  it("keys the counter by limit name so different limits never share a counter", async () => {
    const consume = vi.fn().mockResolvedValue({ success: true, remaining: 1, resetAt: new Date() });
    const { app } = buildTestApp({ testRoutes: true, rateLimiter: { consume, peek: vi.fn() } });

    await request(app).get(`${BASE}/limited`);

    const keys = consume.mock.calls.map(([key]) => key as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^global:/);
    expect(keys[1]).toMatch(/^test-limited:/);
    expect(consume).toHaveBeenCalledWith(expect.any(String), { limit: 2, windowSeconds: 60 });
  });
});

describe("limiter failure", () => {
  const failingLimiter: RateLimiter = {
    consume: () => Promise.reject(new Error("Redis unreachable")),
    peek: () => Promise.reject(new Error("Redis unreachable")),
  };

  it("lets the request through instead of taking the API down", async () => {
    const { app } = buildTestApp({ rateLimiter: failingLimiter });

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
  });

  it("logs the failure", async () => {
    const { app, logs } = buildTestApp({ rateLimiter: failingLimiter, logLevel: "error" });

    await request(app).get("/api/v1/health");

    const entries = logs.entries();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as { err: { message: string } } & Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      msg: "Rate limiter unavailable; allowing request",
      rateLimit: "global",
    });
    expect(entry.err.message).toBe("Redis unreachable");
  });
});

describe("rateLimit()", () => {
  it.each([
    ["a zero limit", { limit: 0, windowSeconds: 60 }],
    ["a fractional limit", { limit: 1.5, windowSeconds: 60 }],
    ["a zero window", { limit: 5, windowSeconds: 0 }],
  ])("refuses %s", (_label, rule) => {
    const { deps } = buildTestDeps();

    expect(() => rateLimit(deps, { name: "bad", ...rule, key: () => "k" })).toThrow(
      /positive integer/,
    );
  });
});
