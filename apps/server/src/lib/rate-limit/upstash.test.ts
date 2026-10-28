import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const slidingWindow = vi.fn((limit: number, window: string) => ({
    kind: "sliding",
    limit,
    window,
  }));
  const RatelimitConstructor = vi.fn();
  return { slidingWindow, RatelimitConstructor, RedisConstructor: vi.fn() };
});

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = mocks.slidingWindow;
    constructor(options: unknown) {
      mocks.RatelimitConstructor(options);
    }
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    constructor(options: unknown) {
      mocks.RedisConstructor(options);
    }
  }
  return { Redis };
});

const { createUpstashRateLimiter, UpstashRateLimiter } = await import("./upstash.js");

const RULE = { limit: 5, windowSeconds: 900 };

describe("UpstashRateLimiter", () => {
  it("maps the client's answer onto a RateLimitResult", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ success: true, remaining: 4, reset: 1_772_442_000_000 });
    const limiter = new UpstashRateLimiter(() => ({ limit }));

    const result = await limiter.consume("login:ip:203.0.113.7", RULE);

    expect(limit).toHaveBeenCalledWith("login:ip:203.0.113.7");
    expect(result).toEqual({ success: true, remaining: 4, resetAt: new Date(1_772_442_000_000) });
  });

  it("passes a rejection through", async () => {
    const limiter = new UpstashRateLimiter(() => ({
      limit: vi.fn().mockResolvedValue({ success: false, remaining: 0, reset: 1_772_442_030_000 }),
    }));

    const result = await limiter.consume("login:ip:203.0.113.7", RULE);

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt.getTime()).toBe(1_772_442_030_000);
  });

  it("never reports a negative remaining count", async () => {
    const limiter = new UpstashRateLimiter(() => ({
      limit: vi.fn().mockResolvedValue({ success: false, remaining: -2, reset: 1 }),
    }));

    expect((await limiter.consume("k", RULE)).remaining).toBe(0);
  });

  it("creates one client per distinct rule and reuses it", async () => {
    const factory = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue({ success: true, remaining: 1, reset: 1 }),
    }));
    const limiter = new UpstashRateLimiter(factory);

    await limiter.consume("a", RULE);
    await limiter.consume("b", RULE);
    await limiter.consume("c", { limit: 10, windowSeconds: 60 });
    await limiter.consume("d", { limit: 5, windowSeconds: 60 });

    expect(factory).toHaveBeenCalledTimes(3);
    expect(factory).toHaveBeenNthCalledWith(1, RULE);
    expect(factory).toHaveBeenNthCalledWith(2, { limit: 10, windowSeconds: 60 });
  });

  it("lets a Redis failure propagate so the middleware can decide how to degrade", async () => {
    const limiter = new UpstashRateLimiter(() => ({
      limit: vi.fn().mockRejectedValue(new Error("Redis unreachable")),
    }));

    await expect(limiter.consume("k", RULE)).rejects.toThrow("Redis unreachable");
  });

  it("treats a Redis timeout as a failure rather than the library's silent success", async () => {
    const limiter = new UpstashRateLimiter(() => ({
      limit: vi
        .fn()
        .mockResolvedValue({ success: true, remaining: 0, reset: 0, reason: "timeout" }),
    }));

    await expect(limiter.consume("k", RULE)).rejects.toThrow(/did not answer/);
  });

  it("accepts the library's other response reasons as normal answers", async () => {
    const limiter = new UpstashRateLimiter(() => ({
      limit: vi.fn().mockResolvedValue({
        success: false,
        remaining: 0,
        reset: 1_772_442_000_000,
        reason: "cacheBlock",
      }),
    }));

    expect((await limiter.consume("k", RULE)).success).toBe(false);
  });
});

describe("createUpstashRateLimiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects with the configured credentials and builds a sliding window per rule", async () => {
    const limiter = createUpstashRateLimiter({
      url: "https://eu1-example-12345.upstash.io",
      token: "tok-example-not-a-real-token",
    });
    expect(limiter).toBeInstanceOf(UpstashRateLimiter);
    expect(mocks.RedisConstructor).toHaveBeenCalledWith({
      url: "https://eu1-example-12345.upstash.io",
      token: "tok-example-not-a-real-token",
    });

    // The Ratelimit mock has no `limit` method; the factory is exercised by constructing one.
    await expect(limiter.consume("k", RULE)).rejects.toThrow();

    expect(mocks.slidingWindow).toHaveBeenCalledWith(5, "900 s");
    expect(mocks.RatelimitConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: "fixflow:ratelimit",
        limiter: { kind: "sliding", limit: 5, window: "900 s" },
        analytics: false,
      }),
    );
  });
});
