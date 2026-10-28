import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Logger } from "./logger.js";

export { Prisma, PrismaClient };

/**
 * Anything that can run queries: the client itself, or the handle passed to the callback of
 * `prisma.$transaction(async (tx) => …)`. Take this in functions that must work in both places.
 */
export type DbClient = Prisma.TransactionClient;

/** The fixed id of the one `BusinessSettings` row (also enforced by a CHECK constraint). */
export const BUSINESS_SETTINGS_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Connection pool limits. Neon scales its compute to zero when idle, so the first connection can
 * take a few seconds; the generous connect timeout covers that. Pooled URLs (PgBouncer) multiplex
 * these connections on Neon's side, so a modest pool is plenty.
 */
const POOL_OPTIONS = {
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
} as const;

/**
 * Creates the one Prisma client for the process. `connectionString` is the **pooled** runtime URL
 * (`DATABASE_URL`); migrations use the direct URL through `prisma.config.ts`. Neon requires TLS,
 * so its URLs carry `sslmode=require`. The client connects lazily, on the first query.
 *
 * Errors on idle pooled connections (Neon closes them) are logged instead of crashing the process.
 */
export function createPrismaClient(
  connectionString: string,
  logger?: Pick<Logger, "error">,
): PrismaClient {
  const adapter = new PrismaPg(
    { connectionString, ...POOL_OPTIONS },
    {
      onPoolError: (err) => {
        logger?.error({ err }, "Database pool error");
      },
      onConnectionError: (err) => {
        logger?.error({ err }, "Database connection error");
      },
    },
  );
  return new PrismaClient({ adapter });
}

/** Thrown by the stand-in client returned from {@link createUnavailablePrisma}. */
export class DatabaseUnavailableError extends Error {
  constructor(reason: string) {
    super(`The database is not available: ${reason}`);
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * A stand-in for the client that fails loudly on first use. It is what the app gets when no
 * database is configured (a UI-only development session) and what unit tests get by default, so
 * a test can never reach a real database by accident. `$disconnect` is a harmless no-op.
 */
export function createUnavailablePrisma(reason: string): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      if (property === "$disconnect") {
        return () => Promise.resolve();
      }
      // Not a thenable, so `await`ing or returning the stand-in does not trip over `.then`.
      if (property === "then" || typeof property === "symbol") {
        return undefined;
      }
      throw new DatabaseUnavailableError(reason);
    },
  });
}
