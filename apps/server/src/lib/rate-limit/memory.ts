import type { Clock } from "../clock.js";
import type { RateLimiter, RateLimitResult, RateLimitRule } from "./types.js";

interface Entry {
  /** Millisecond timestamps of the requests still inside the window, oldest first. */
  hits: number[];
  windowMs: number;
}

/** How often (in clock time) idle keys are dropped so the map cannot grow without bound. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * In-process sliding-window limiter for local development and tests. Counters live in this
 * process only, so it must not be used in production behind more than one instance.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private lastSweepMs: number;

  constructor(private readonly clock: Clock) {
    this.lastSweepMs = clock.now().getTime();
  }

  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const nowMs = this.clock.now().getTime();
    const windowMs = rule.windowSeconds * 1000;
    this.sweep(nowMs);

    const entry = this.entries.get(key) ?? { hits: [], windowMs };
    entry.windowMs = windowMs;
    entry.hits = entry.hits.filter((hit) => hit > nowMs - windowMs);

    const allowed = entry.hits.length < rule.limit;
    if (allowed) {
      entry.hits.push(nowMs);
    }
    this.entries.set(key, entry);

    const oldest = entry.hits[0] ?? nowMs;
    return Promise.resolve({
      success: allowed,
      remaining: Math.max(0, rule.limit - entry.hits.length),
      resetAt: new Date(oldest + windowMs),
    });
  }

  /** Number of keys currently tracked; exposed for tests. */
  get size(): number {
    return this.entries.size;
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastSweepMs = nowMs;
    for (const [key, entry] of this.entries) {
      const newest = entry.hits[entry.hits.length - 1];
      if (newest === undefined || newest <= nowMs - entry.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}
