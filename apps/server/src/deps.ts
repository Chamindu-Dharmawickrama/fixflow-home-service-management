import type { Config } from "./config/env.js";
import { type BackgroundTasks, createBackgroundTasks } from "./lib/background.js";
import { type Clock, systemClock } from "./lib/clock.js";
import { createPrismaClient, createUnavailablePrisma, type PrismaClient } from "./lib/db.js";
import { createLogger, type Logger } from "./lib/logger.js";
import {
  createUpstashRateLimiter,
  MemoryRateLimiter,
  type RateLimiter,
  type RateLimitTable,
  resolveRateLimits,
} from "./lib/rate-limit/index.js";
import {
  createGoogleIdTokenVerifier,
  type GoogleIdTokenVerifier,
} from "./modules/auth/google-verifier.js";
import { createEmailDispatcher, type EmailDispatcher } from "./modules/email/email.dispatcher.js";
import type { EmailSender } from "./modules/email/email.types.js";
import { createEmailSender } from "./modules/email/email-sender.js";

/**
 * Everything the app needs from the outside world, passed explicitly to `createApp`. There is
 * no DI framework: tests substitute fakes by building this object themselves.
 */
export interface AppDeps {
  config: Config;
  clock: Clock;
  logger: Logger;
  /**
   * The one database client. When no database is configured (a UI-only development session) or a
   * unit test did not ask for one, it is a stand-in that throws on first use, so nothing can reach
   * a database by accident. Liveness never touches it.
   */
  prisma: PrismaClient;
  rateLimiter: RateLimiter;
  /** The named limits in force (config multiplier already applied). */
  rateLimits: RateLimitTable;
  /** Delivers email (SMTP or the log transport). Call it through the dispatcher, never directly. */
  emailSender: EmailSender;
  /**
   * Sends the emails a business operation queued, after its transaction committed. Records every
   * attempt in `EmailDeliveryLog` and never throws (BR-22).
   */
  emailDispatcher: EmailDispatcher;
  /** Verifies Google ID tokens. Tests substitute a fake and never call Google. */
  googleVerifier: GoogleIdTokenVerifier;
  /** Runs work after the response, such as sending an email once a transaction has committed. */
  background: BackgroundTasks;
}

/** Builds the real dependencies from validated configuration. Used by `server.ts` only. */
export function createProductionDeps(config: Config): AppDeps {
  const { driver, upstash, multiplier } = config.rateLimit;

  const rateLimiter =
    driver === "upstash" && upstash !== undefined
      ? createUpstashRateLimiter(upstash)
      : new MemoryRateLimiter(systemClock);

  const logger = createLogger({ level: config.logLevel, pretty: config.logPretty });
  const prisma =
    config.database.url === undefined
      ? createUnavailablePrisma("DATABASE_URL is not configured")
      : createPrismaClient(config.database.url, logger);

  const background = createBackgroundTasks(logger);
  const emailSender = createEmailSender(config, logger, systemClock);

  return {
    config,
    clock: systemClock,
    logger,
    prisma,
    rateLimiter,
    rateLimits: resolveRateLimits({ multiplier }),
    emailSender,
    emailDispatcher: createEmailDispatcher({
      prisma,
      emailSender,
      clock: systemClock,
      logger,
      background,
    }),
    googleVerifier: createGoogleIdTokenVerifier(config.auth.googleClientId),
    background,
  };
}
