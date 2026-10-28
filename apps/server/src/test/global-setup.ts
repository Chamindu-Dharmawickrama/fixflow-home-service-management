import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { loadLocalEnvFile } from "../config/dotenv.js";
import { assertTestDatabase, TestDatabaseGuardError } from "./db.js";

const SERVER_DIRECTORY = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Vitest global setup for the integration tests: applies every migration to `TEST_DATABASE_URL`
 * with `prisma migrate deploy` (the same command shared environments use), so the schema under
 * test is always the one the migrations produce. It only ever targets the guarded test database.
 */
export default function setup(): void {
  // Local convenience: a developer's apps/server/.env may define TEST_DATABASE_URL. CI sets it directly.
  loadLocalEnvFile();

  let testUrl: string;
  try {
    testUrl = assertTestDatabase();
  } catch (error) {
    if (error instanceof TestDatabaseGuardError) {
      throw new Error(
        `${error.message}\nStart the test database with "npm run db:test:up" and set TEST_DATABASE_URL (see apps/server/.env.example).`,
        { cause: error },
      );
    }
    throw error;
  }

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: SERVER_DIRECTORY,
      // Prisma's CLI reads its URL from DIRECT_DATABASE_URL (prisma.config.ts); point it at the test database only.
      env: { ...process.env, DIRECT_DATABASE_URL: testUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    throw new Error(
      `prisma migrate deploy failed for the test database.\n${output.stdout ?? ""}\n${output.stderr ?? ""}`,
      { cause: error },
    );
  }
}
