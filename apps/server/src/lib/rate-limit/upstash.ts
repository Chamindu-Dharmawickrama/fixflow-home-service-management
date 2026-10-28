import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import type { UpstashCredentials } from "../../config/env.js";
import type { RateLimiter, RateLimitResult, RateLimitRule } from "./types.js";

const KEY_PREFIX = "fixflow:ratelimit";
/** How long a request waits for Redis before the limiter gives up, so a slow Redis cannot stall the API. */
const REDIS_TIMEOUT_MS = 1000;

/** The part of `@upstash/ratelimit`'s `Ratelimit` this adapter uses. */
export interface SlidingWindowLimiter {
  limit(identifier: string): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
    /** Set to `"timeout"` when Redis did not answer in time (the library then reports success). */
    reason?: string;
  }>;
}

export type SlidingWindowLimiterFactory = (rule: RateLimitRule) => SlidingWindowLimiter;

/**
 * Distributed sliding-window limiter backed by Upstash Redis (D-12). `@upstash/ratelimit` fixes
 * the limit and window when a limiter is created, so one is created lazily per distinct rule
 * and reused. Redis errors propagate: the `rateLimit` middleware decides how to degrade. A
 * timeout, which the library would otherwise report as a silent "success", is raised as an error
 * for the same reason: the outage must show up in the logs.
 */
export class UpstashRateLimiter implements RateLimiter {
  private readonly limiters = new Map<string, SlidingWindowLimiter>();

  constructor(private readonly createLimiter: SlidingWindowLimiterFactory) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const { success, remaining, reset, reason } = await this.limiterFor(rule).limit(key);
    if (reason === "timeout") {
      throw new Error("Upstash Redis did not answer within the rate limiter timeout");
    }
    return { success, remaining: Math.max(0, remaining), resetAt: new Date(reset) };
  }

  private limiterFor(rule: RateLimitRule): SlidingWindowLimiter {
    const id = `${rule.limit}/${rule.windowSeconds}`;
    let limiter = this.limiters.get(id);
    if (limiter === undefined) {
      limiter = this.createLimiter(rule);
      this.limiters.set(id, limiter);
    }
    return limiter;
  }
}

/** Connects to Upstash over its REST API and returns a ready limiter. */
export function createUpstashRateLimiter(credentials: UpstashCredentials): UpstashRateLimiter {
  const redis = new Redis({ url: credentials.url, token: credentials.token });

  return new UpstashRateLimiter(
    (rule) =>
      new Ratelimit({
        redis,
        prefix: KEY_PREFIX,
        limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
        timeout: REDIS_TIMEOUT_MS,
        analytics: false,
      }),
  );
}
