import type { Config } from "./config/env.js";
import { type Clock, systemClock } from "./lib/clock.js";
import { createLogger, type Logger } from "./lib/logger.js";
import {
  createUpstashRateLimiter,
  MemoryRateLimiter,
  type RateLimiter,
  type RateLimitTable,
  resolveRateLimits,
} from "./lib/rate-limit/index.js";

/**
 * Everything the app needs from the outside world, passed explicitly to `createApp`. There is
 * no DI framework: tests substitute fakes by building this object themselves. Later tasks add
 * the Prisma client, the e-mail sender and the Google ID-token verifier here.
 */
export interface AppDeps {
  config: Config;
  clock: Clock;
  logger: Logger;
  rateLimiter: RateLimiter;
  /** The named limits in force (config multiplier already applied). */
  rateLimits: RateLimitTable;
}

/** Builds the real dependencies from validated configuration. Used by `server.ts` only. */
export function createProductionDeps(config: Config): AppDeps {
  const { driver, upstash, multiplier } = config.rateLimit;

  const rateLimiter =
    driver === "upstash" && upstash !== undefined
      ? createUpstashRateLimiter(upstash)
      : new MemoryRateLimiter(systemClock);

  return {
    config,
    clock: systemClock,
    logger: createLogger({ level: config.logLevel, pretty: config.logPretty }),
    rateLimiter,
    rateLimits: resolveRateLimits({ multiplier }),
  };
}
