import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { DemoPasswords } from "../config/env.js";
import { seedBaseData, type SeedSummary } from "../db/seed.js";
import { createPrismaClient, type PrismaClient } from "../lib/db.js";
import { assertTestDatabase, databaseName, resetDatabase } from "./db.js";

/**
 * Database setup for the Playwright suite (T05). The suite empties and re-seeds one dedicated
 * database named by `E2E_DATABASE_URL`, never a development, preview or production one: every
 * step goes through the guard in `db.ts`, which also insists the database name contains "e2e".
 */

const SERVER_DIRECTORY = fileURLToPath(new URL("../..", import.meta.url));

/** The validated E2E database URL. Throws `TestDatabaseGuardError` if it is unset or unsafe. */
export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return assertTestDatabase({ env, variable: "E2E_DATABASE_URL" });
}

/** A Prisma client for the E2E database. Close it with `$disconnect()`. */
export function createE2ePrisma(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  return createPrismaClient(e2eDatabaseUrl(env));
}

/**
 * Creates the E2E database if it does not exist yet. `docker-compose.yml` creates it for a new
 * volume; a volume made before T05 does not have it. Connects to the server's maintenance
 * database (`postgres`) only to run `CREATE DATABASE`, and only for the validated name.
 */
export async function ensureE2eDatabase(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const url = e2eDatabaseUrl(env);
  const name = databaseName("E2E_DATABASE_URL", url);

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const maintenance = createPrismaClient(maintenanceUrl.toString());
  try {
    const existing = await maintenance.$queryRaw<{ found: number }[]>`
      SELECT 1 AS found FROM pg_database WHERE datname = ${name}`;
    if (existing.length > 0) {
      return false;
    }
    // The name passed the guard (it contains "e2e"); it is quoted here anyway.
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    return true;
  } finally {
    await maintenance.$disconnect();
  }
}

/** Applies every migration to the E2E database with `prisma migrate deploy`, as shared environments do. */
export function migrateE2eDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const url = e2eDatabaseUrl(env);
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: SERVER_DIRECTORY,
      // The CLI reads its URL from DIRECT_DATABASE_URL (prisma.config.ts): point it at the E2E database only.
      env: { ...env, DIRECT_DATABASE_URL: url },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    throw new Error(
      `prisma migrate deploy failed for the E2E database.\n${output.stdout ?? ""}\n${output.stderr ?? ""}`,
      { cause: error },
    );
  }
}

export interface PreparedE2eDatabase {
  created: boolean;
  seed: SeedSummary;
}

/**
 * Brings the E2E database to a known state: created if missing, migrated, emptied, then loaded
 * with the base seed (settings, services, the three demo accounts and technicians) using the
 * demo passwords of this run.
 */
export async function prepareE2eDatabase(
  passwords: DemoPasswords,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreparedE2eDatabase> {
  const created = await ensureE2eDatabase(env);
  migrateE2eDatabase(env);

  const prisma = createE2ePrisma(env);
  try {
    await resetDatabase(prisma, "E2E_DATABASE_URL");
    const seed = await seedBaseData(prisma, { passwords });
    return { created, seed };
  } finally {
    await prisma.$disconnect();
  }
}
