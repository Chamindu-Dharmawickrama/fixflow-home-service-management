import type { Express, Router } from "express";

import { createApp } from "../app.js";
import { type Config, loadConfig, type LogLevel } from "../config/env.js";
import type { AppDeps } from "../deps.js";
import { createBackgroundTasks } from "../lib/background.js";
import { FakeClock } from "../lib/clock.js";
import { createUnavailablePrisma, type PrismaClient } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import {
  MemoryRateLimiter,
  type RateLimiter,
  type RateLimitName,
  type RateLimitRule,
  resolveRateLimits,
} from "../lib/rate-limit/index.js";
import type { GoogleIdTokenVerifier } from "../modules/auth/google-verifier.js";
import { createEmailDispatcher } from "../modules/email/email.dispatcher.js";
import type { EmailSender } from "../modules/email/email.types.js";
import { FakeGoogleVerifier, RecordingEmailSender } from "./fakes.js";
import { TEST_WEB_ORIGIN } from "./http.js";
import { createLogCapture, type LogCapture } from "./log-capture.js";
import { createAuthProbeRouter, createTestRouter } from "./test-routes.js";

export { TEST_WEB_ORIGIN };
export const TEST_START_TIME = "2026-03-02T09:00:00.000Z";
/** Long enough to be a valid `SESSION_SECRET`; a fixed value keeps test sessions reproducible. */
export const TEST_SESSION_SECRET = "test-session-secret-0123456789-abcdef";
/** The one allowlisted admin email in test apps unless a test sets `ADMIN_EMAILS` itself. */
export const TEST_ADMIN_EMAIL = "admin@demo.fixflow.test";

export interface TestAppOverrides {
  /** Environment variables for `loadConfig`, merged over the test defaults. No files are read. */
  env?: Record<string, string>;
  /** Log level for the captured logger. Defaults to `silent`; use `info` to assert on logs. */
  logLevel?: LogLevel;
  clock?: FakeClock;
  /**
   * The database client. Unit tests leave it out and get a stand-in that throws on first use, so
   * they can never reach a database; integration tests pass the client from `getTestPrisma()`.
   */
  prisma?: PrismaClient;
  rateLimiter?: RateLimiter;
  /** Defaults to a recorder that keeps every email in memory (nothing is written or sent). */
  emailSender?: EmailSender;
  /** Defaults to a fake that accepts only the credentials a test registers. */
  googleVerifier?: GoogleIdTokenVerifier;
  /** Explicit rules for named limits, for example a low `global` limit to provoke a 429. */
  rateLimits?: Partial<Record<RateLimitName, RateLimitRule>>;
  /** Mounts the throwaway routes from `test-routes.ts` (errors, validation, logging, limits). */
  testRoutes?: boolean;
  /** Mounts the guard probe routes (`/api/v1/__probe__/*`) for testing sessions and role guards. */
  authProbeRoutes?: boolean;
  /** Extra routers mounted under `/api/v1`. */
  extraRouters?: readonly Router[];
}

export interface TestApp {
  app: Express;
  deps: AppDeps;
  clock: FakeClock;
  logs: LogCapture;
  /** The default email sender, when the test did not supply its own. */
  emails: RecordingEmailSender;
  /** The default Google verifier, when the test did not supply its own. */
  google: FakeGoogleVerifier;
}

/**
 * Test configuration built through the real `loadConfig`, so tests exercise the same parsing as
 * production. Rate limits are scaled up by default so tests are never throttled by accident.
 */
export function buildTestConfig(env: Record<string, string> = {}, logLevel?: LogLevel): Config {
  return loadConfig({
    NODE_ENV: "test",
    WEB_ORIGIN: TEST_WEB_ORIGIN,
    RATE_LIMIT_MULTIPLIER: "1000",
    SESSION_SECRET: TEST_SESSION_SECRET,
    ADMIN_EMAILS: TEST_ADMIN_EMAIL,
    ...(logLevel !== undefined && { LOG_LEVEL: logLevel }),
    ...env,
  });
}

/** Builds dependencies with a fake clock, an in-memory rate limiter and captured logs. */
export function buildTestDeps(overrides: TestAppOverrides = {}): {
  deps: AppDeps;
  clock: FakeClock;
  logs: LogCapture;
  emails: RecordingEmailSender;
  google: FakeGoogleVerifier;
} {
  const config = buildTestConfig(overrides.env, overrides.logLevel);
  const clock = overrides.clock ?? new FakeClock(TEST_START_TIME);
  const logs = createLogCapture();
  const logger = createLogger({ level: config.logLevel, pretty: false }, logs.stream);
  const emails = new RecordingEmailSender();
  const google = new FakeGoogleVerifier();
  const prisma =
    overrides.prisma ?? createUnavailablePrisma("this test did not configure a database");
  const emailSender = overrides.emailSender ?? emails;
  const background = createBackgroundTasks(logger);

  const deps: AppDeps = {
    config,
    clock,
    logger,
    prisma,
    rateLimiter: overrides.rateLimiter ?? new MemoryRateLimiter(clock),
    rateLimits: resolveRateLimits({
      multiplier: config.rateLimit.multiplier,
      ...(overrides.rateLimits !== undefined && { overrides: overrides.rateLimits }),
    }),
    emailSender,
    emailDispatcher: createEmailDispatcher({ prisma, emailSender, clock, logger, background }),
    googleVerifier: overrides.googleVerifier ?? google,
    background,
  };
  return { deps, clock, logs, emails, google };
}

/** Builds the real app with test dependencies. */
export function buildTestApp(overrides: TestAppOverrides = {}): TestApp {
  const { deps, clock, logs, emails, google } = buildTestDeps(overrides);
  const extraRouters = [
    ...(overrides.testRoutes === true ? [createTestRouter(deps)] : []),
    ...(overrides.authProbeRoutes === true ? [createAuthProbeRouter(deps)] : []),
    ...(overrides.extraRouters ?? []),
  ];
  const app = createApp(deps, { extraRouters });
  return { app, deps, clock, logs, emails, google };
}
