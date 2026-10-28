export interface RateLimitRule {
  /** Maximum number of requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  /** `false` when this request exceeded the limit and was not counted. */
  success: boolean;
  /** Requests still available in the current window (`0` when the limit is reached). */
  remaining: number;
  /** When capacity is next freed: the earliest time a rejected caller may retry. */
  resetAt: Date;
}

export interface RateLimiter {
  /**
   * Counts one request against `key` (sliding window) and reports whether it is allowed.
   * `key` must already include the limit's name so different limits never share a counter.
   */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}
