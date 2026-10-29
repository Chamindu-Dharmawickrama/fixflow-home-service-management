import { beforeEach, describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { MemoryRateLimiter } from "./memory.js";

const RULE = { limit: 3, windowSeconds: 60 };

describe("MemoryRateLimiter", () => {
  let clock: FakeClock;
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    clock = new FakeClock("2026-03-02T09:00:00.000Z");
    limiter = new MemoryRateLimiter(clock);
  });

  it("allows requests up to the limit and reports what is left", async () => {
    const remaining: number[] = [];
    for (let i = 0; i < RULE.limit; i += 1) {
      const result = await limiter.consume("ip:1", RULE);
      expect(result.success).toBe(true);
      remaining.push(result.remaining);
    }

    expect(remaining).toEqual([2, 1, 0]);
  });

  it("rejects the request after the limit, without counting it", async () => {
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume("ip:1", RULE);

    const rejected = await limiter.consume("ip:1", RULE);
    const rejectedAgain = await limiter.consume("ip:1", RULE);

    expect(rejected.success).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejectedAgain.success).toBe(false);
  });

  it("reports when the oldest request leaves the window", async () => {
    await limiter.consume("ip:1", RULE);
    clock.advanceSeconds(10);
    await limiter.consume("ip:1", RULE);
    await limiter.consume("ip:1", RULE);

    const rejected = await limiter.consume("ip:1", RULE);

    expect(rejected.resetAt.toISOString()).toBe("2026-03-02T09:01:00.000Z");
  });

  it("allows requests again once the window has passed", async () => {
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume("ip:1", RULE);
    expect((await limiter.consume("ip:1", RULE)).success).toBe(false);

    clock.advanceSeconds(RULE.windowSeconds - 1);
    expect((await limiter.consume("ip:1", RULE)).success).toBe(false);

    clock.advanceSeconds(1);
    expect((await limiter.consume("ip:1", RULE)).success).toBe(true);
  });

  it("slides: capacity returns one request at a time as old requests expire", async () => {
    await limiter.consume("ip:1", RULE); // t = 0
    clock.advanceSeconds(20);
    await limiter.consume("ip:1", RULE); // t = 20
    clock.advanceSeconds(20);
    await limiter.consume("ip:1", RULE); // t = 40
    expect((await limiter.consume("ip:1", RULE)).success).toBe(false);

    clock.advanceSeconds(20); // t = 60: only the t = 0 request has expired
    expect((await limiter.consume("ip:1", RULE)).success).toBe(true);
    expect((await limiter.consume("ip:1", RULE)).success).toBe(false);
  });

  it("counts each key separately", async () => {
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume("ip:1", RULE);

    expect((await limiter.consume("ip:1", RULE)).success).toBe(false);
    expect((await limiter.consume("ip:2", RULE)).success).toBe(true);
  });

  it("applies the rule given with each call", async () => {
    const strict = { limit: 1, windowSeconds: 5 };

    expect((await limiter.consume("login", strict)).success).toBe(true);
    expect((await limiter.consume("login", strict)).success).toBe(false);
    clock.advanceSeconds(5);
    expect((await limiter.consume("login", strict)).success).toBe(true);
  });

  it("drops idle keys so memory does not grow without bound", async () => {
    for (let i = 0; i < 50; i += 1) await limiter.consume(`ip:${i}`, RULE);
    expect(limiter.size).toBe(50);

    clock.advanceSeconds(RULE.windowSeconds + 61);
    await limiter.consume("ip:new", RULE);

    expect(limiter.size).toBe(1);
  });

  it("keeps active keys when sweeping", async () => {
    await limiter.consume("busy", RULE);
    clock.advanceSeconds(59);
    await limiter.consume("busy", RULE);
    clock.advanceSeconds(2); // past the sweep interval, but "busy" has a hit inside its window

    await limiter.consume("other", RULE);

    expect(limiter.size).toBe(2);
  });
});

describe("MemoryRateLimiter.peek", () => {
  let clock: FakeClock;
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    clock = new FakeClock("2026-03-02T09:00:00.000Z");
    limiter = new MemoryRateLimiter(clock);
  });

  it("reports the allowance without using any of it", async () => {
    for (let i = 0; i < 10; i += 1) {
      const result = await limiter.peek("failures", RULE);
      expect(result).toMatchObject({ success: true, remaining: RULE.limit });
    }
    expect(limiter.size).toBe(0);
  });

  it("sees requests that were counted and turns to a rejection at the limit", async () => {
    await limiter.consume("failures", RULE);
    await limiter.consume("failures", RULE);
    expect(await limiter.peek("failures", RULE)).toMatchObject({ success: true, remaining: 1 });

    await limiter.consume("failures", RULE);
    const blocked = await limiter.peek("failures", RULE);

    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt.toISOString()).toBe("2026-03-02T09:01:00.000Z");
  });

  it("does not change what a later consume decides", async () => {
    for (let i = 0; i < RULE.limit; i += 1) await limiter.consume("failures", RULE);
    await limiter.peek("failures", RULE);
    await limiter.peek("failures", RULE);

    clock.advanceSeconds(RULE.windowSeconds);

    expect((await limiter.consume("failures", RULE)).success).toBe(true);
  });
});
