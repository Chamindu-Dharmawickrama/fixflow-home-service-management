import type { Express, Router } from "express";

import { createApp } from "../app.js";
import { type Config, loadConfig, type LogLevel } from "../config/env.js";
import type { AppDeps } from "../deps.js";
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
import { createLogCapture, type LogCapture } from "./log-capture.js";
import { createTestRouter } from "./test-routes.js";

export const TEST_WEB_ORIGIN = "http://localhost:3000";
export const TEST_START_TIME = "2026-03-02T09:00:00.000Z";

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
  /** Explicit rules for named limits, for example a low `global` limit to provoke a 429. */
  rateLimits?: Partial<Record<RateLimitName, RateLimitRule>>;
  /** Mounts the throwaway routes from `test-routes.ts` (errors, validation, logging, limits). */
  testRoutes?: boolean;
  /** Extra routers mounted under `/api/v1`. */
  extraRouters?: readonly Router[];
}

export interface TestApp {
  app: Express;
  deps: AppDeps;
  clock: FakeClock;
  logs: LogCapture;
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
    ...(logLevel !== undefined && { LOG_LEVEL: logLevel }),
    ...env,
  });
}

/** Builds dependencies with a fake clock, an in-memory rate limiter and captured logs. */
export function buildTestDeps(overrides: TestAppOverrides = {}): {
  deps: AppDeps;
  clock: FakeClock;
  logs: LogCapture;
} {
  const config = buildTestConfig(overrides.env, overrides.logLevel);
  const clock = overrides.clock ?? new FakeClock(TEST_START_TIME);
  const logs = createLogCapture();

  const deps: AppDeps = {
    config,
    clock,
    logger: createLogger({ level: config.logLevel, pretty: false }, logs.stream),
    prisma: overrides.prisma ?? createUnavailablePrisma("this test did not configure a database"),
    rateLimiter: overrides.rateLimiter ?? new MemoryRateLimiter(clock),
    rateLimits: resolveRateLimits({
      multiplier: config.rateLimit.multiplier,
      ...(overrides.rateLimits !== undefined && { overrides: overrides.rateLimits }),
    }),
  };
  return { deps, clock, logs };
}

/** Builds the real app with test dependencies. */
export function buildTestApp(overrides: TestAppOverrides = {}): TestApp {
  const { deps, clock, logs } = buildTestDeps(overrides);
  const extraRouters = [
    ...(overrides.testRoutes === true ? [createTestRouter(deps)] : []),
    ...(overrides.extraRouters ?? []),
  ];
  const app = createApp(deps, { extraRouters });
  return { app, deps, clock, logs };
}
