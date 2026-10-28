import type { Request, RequestHandler } from "express";

import type { AppDeps } from "../deps.js";
import { rateLimited } from "../lib/errors.js";
import type { RateLimitName } from "../lib/rate-limit/index.js";

type RateLimitDeps = Pick<AppDeps, "clock" | "logger" | "rateLimiter">;
type NamedRateLimitDeps = RateLimitDeps & Pick<AppDeps, "rateLimits">;

export interface RateLimitOptions {
  /** Identifies the limit; it prefixes the counter key so limits never share a counter. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** What to count by, for example the client IP or an e-mail address from the body. */
  key: (req: Request) => string;
}

/** The client IP, as resolved by Express from the configured `trust proxy` setting. */
export function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

/**
 * Rejects the request with `429 RATE_LIMITED` and a `Retry-After` header once `key(req)` has
 * made `limit` requests within `windowSeconds`.
 *
 * If the limiter itself fails (for example Redis is unreachable) the request is allowed and the
 * failure is logged: an outage of the rate-limit store must not take the whole API down.
 */
export function rateLimit(deps: RateLimitDeps, options: RateLimitOptions): RequestHandler {
  const { name, limit, windowSeconds, key } = options;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1
  ) {
    throw new Error(`Rate limit "${name}" needs a positive integer limit and windowSeconds`);
  }

  return async (req, res, next) => {
    const counterKey = `${name}:${key(req)}`;

    let result;
    try {
      result = await deps.rateLimiter.consume(counterKey, { limit, windowSeconds });
    } catch (error) {
      deps.logger.error(
        { err: error, rateLimit: name, reqId: req.id },
        "Rate limiter unavailable; allowing request",
      );
      next();
      return;
    }

    if (result.success) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - deps.clock.now().getTime()) / 1000),
    );
    next(rateLimited(retryAfterSeconds));
  };
}

/** Like {@link rateLimit}, using the limit registered under `name` in the named-limits table. */
export function rateLimitByName(
  deps: NamedRateLimitDeps,
  name: RateLimitName,
  key: (req: Request) => string,
): RequestHandler {
  return rateLimit(deps, { name, ...deps.rateLimits[name], key });
}
