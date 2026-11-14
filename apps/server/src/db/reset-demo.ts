import type { DemoPasswords } from "../config/env.js";
import type { PrismaClient } from "../lib/db.js";
import { seedBaseData, type SeedSummary } from "./seed.js";
import { seedShowcase, type ShowcaseProgress, type ShowcaseSummary } from "./showcase/showcase.js";
import { type DemoReport, verifyDemo } from "./verify-demo.js";

/**
 * `npm run db:reset-demo` (T24, spec §21.1): empties the demo database and loads the base seed and the
 * showcase again, so the public demo can be put back as it was (by hand, or by the scheduled
 * workflow). It destroys every row, so it is guarded:
 *
 * 1. `DEMO_MODE` must be `true`: only an environment that says it is the public demo may be reset.
 * 2. `CONFIRM_DEMO_RESET` must be the **name of the database** that `DATABASE_URL` points at. Typing
 *    the name proves the person (or the workflow) knows which database is about to be emptied.
 * 3. `NODE_ENV` must not be `test`, and the database may not be the one `TEST_DATABASE_URL` or
 *    `E2E_DATABASE_URL` names (those have their own reset, behind their own guards).
 * 4. Before it deletes anything, the live connection is asked which database it is on, and that must
 *    be the confirmed one.
 *
 * Nothing it prints or throws contains a credential: only the host and the database name.
 */

/** Thrown when a reset is refused. The message names variables, never values or URLs. */
export class DemoResetGuardError extends Error {
  constructor(reason: string) {
    super(`Refusing to reset the demo database: ${reason}.`);
    this.name = "DemoResetGuardError";
  }
}

export interface DemoResetTarget {
  /** `host` or `host:port`, without the user name or password. */
  host: string;
  database: string;
}

function parseUrl(variable: string, url: string): URL {
  try {
    return new URL(url);
  } catch {
    // The URL is not echoed: it contains credentials.
    throw new DemoResetGuardError(`${variable} is not a valid URL`);
  }
}

/** The host and database a connection URL points at. Credentials and options are left out. */
export function describeTarget(variable: string, url: string): DemoResetTarget {
  const parsed = parseUrl(variable, url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database === "") {
    throw new DemoResetGuardError(`${variable} does not name a database`);
  }
  return { host: parsed.host, database };
}

/** Which database a URL is, ignoring the user, the options and Neon's pooled host name. */
function identity(variable: string, url: string): string {
  const parsed = parseUrl(variable, url);
  const host = parsed.hostname.toLowerCase().replace(/^([^.]+)-pooler(?=\.|$)/, "$1");
  const normalized = ["localhost", "127.0.0.1", "[::1]"].includes(host) ? "localhost" : host;
  return `${normalized}:${parsed.port === "" ? "5432" : parsed.port}/${describeTarget(variable, url).database}`;
}

export interface AllowedReset {
  url: string;
  target: DemoResetTarget;
}

/**
 * Throws {@link DemoResetGuardError} unless every condition above holds. Pure: it only reads `env`.
 */
export function assertDemoResetAllowed(env: NodeJS.ProcessEnv = process.env): AllowedReset {
  if (env.NODE_ENV === "test") {
    throw new DemoResetGuardError('NODE_ENV is "test"; the test databases have their own reset');
  }
  if (env.DEMO_MODE?.trim() !== "true") {
    throw new DemoResetGuardError("DEMO_MODE is not true, so this is not the public demo");
  }

  const url = env.DATABASE_URL?.trim();
  if (url === undefined || url === "") {
    throw new DemoResetGuardError("DATABASE_URL is not set");
  }
  const target = describeTarget("DATABASE_URL", url);

  const confirmation = env.CONFIRM_DEMO_RESET?.trim();
  if (confirmation === undefined || confirmation === "") {
    throw new DemoResetGuardError(
      "CONFIRM_DEMO_RESET is not set; set it to the name of the database to empty",
    );
  }
  if (confirmation !== target.database) {
    throw new DemoResetGuardError(
      "CONFIRM_DEMO_RESET does not match the name of the database DATABASE_URL points at",
    );
  }

  for (const other of ["TEST_DATABASE_URL", "E2E_DATABASE_URL"] as const) {
    const otherUrl = env[other]?.trim();
    if (
      otherUrl !== undefined &&
      otherUrl !== "" &&
      identity(other, otherUrl) === identity("DATABASE_URL", url)
    ) {
      throw new DemoResetGuardError(`DATABASE_URL points at the same database as ${other}`);
    }
  }
  return { url, target };
}

/**
 * Empties every table except Prisma's migration history. The connection is checked first: it must be
 * on `expectedDatabase`, whatever the environment says.
 */
export async function truncateAllTables(
  prisma: PrismaClient,
  expectedDatabase: string,
): Promise<void> {
  const [connected] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (connected?.name !== expectedDatabase) {
    throw new DemoResetGuardError(
      "the connection is on a different database than the confirmed one",
    );
  }
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) {
    return;
  }
  // The names come from the catalog and are quoted, so nothing here is caller-controlled.
  const list = tables.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface ResetOptions {
  /** The database the caller confirmed; the live connection must be on it. */
  expectedDatabase: string;
  passwords: DemoPasswords;
  /** The moment dates are counted from. Defaults to now. */
  now?: Date;
  onProgress?: ShowcaseProgress;
}

export interface ResetResult {
  base: SeedSummary;
  showcase: ShowcaseSummary;
  report: DemoReport;
}

/**
 * Empties the database, loads the base seed and the showcase, and runs the invariant checker. The
 * caller is responsible for having passed {@link assertDemoResetAllowed} (the CLI does), or, in the
 * integration tests, the test-database guard. Running it twice gives the same structure, with the
 * dates counted from the new `now`.
 */
export async function resetDemoDatabase(
  prisma: PrismaClient,
  options: ResetOptions,
): Promise<ResetResult> {
  await truncateAllTables(prisma, options.expectedDatabase);
  const now = options.now ?? new Date();
  const base = await seedBaseData(prisma, { passwords: options.passwords });
  const showcase = await seedShowcase(prisma, {
    now,
    ...(options.onProgress !== undefined && { onProgress: options.onProgress }),
  });
  const report = await verifyDemo(prisma, now);
  return { base, showcase, report };
}
