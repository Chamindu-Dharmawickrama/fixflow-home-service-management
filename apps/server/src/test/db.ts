import { createPrismaClient, type PrismaClient } from "../lib/db.js";

/**
 * Safe access to the integration-test database (D-15, CLAUDE.md §11). Everything that can destroy
 * data goes through {@link assertTestDatabase}, so a mistake in a developer's environment can never
 * reach a development, preview or production database.
 */

/** Thrown when an operation would touch a database that is not the dedicated test database. */
export class TestDatabaseGuardError extends Error {
  constructor(reason: string) {
    super(`Refusing to use the test database: ${reason}.`);
    this.name = "TestDatabaseGuardError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(variable: string, url: string): URL {
  try {
    return new URL(url);
  } catch {
    // The URL itself is not echoed: it contains credentials.
    throw new TestDatabaseGuardError(`${variable} is not a valid URL`);
  }
}

/** The database name of a connection URL. */
export function databaseName(variable: string, url: string): string {
  return decodeURIComponent(parse(variable, url).pathname.replace(/^\//, ""));
}

/**
 * Which database a URL points at: host, port and name, ignoring credentials and query options.
 * Two spellings of one database compare equal, including `localhost` and `127.0.0.1`, and Neon's
 * pooled and direct hosts (the pooled one inserts `-pooler` into the first host label).
 */
export function databaseIdentity(variable: string, url: string): string {
  const parsed = parse(variable, url);
  const host = parsed.hostname.toLowerCase();
  const normalizedHost = LOCAL_HOSTS.has(host)
    ? "localhost"
    : host.replace(/^([^.]+)-pooler(?=\.|$)/, "$1");
  const port = parsed.port === "" ? "5432" : parsed.port;
  return `${normalizedHost}:${port}/${databaseName(variable, url)}`;
}

/**
 * The two environment variables that may name a database this code is allowed to empty:
 * `TEST_DATABASE_URL` for the API integration tests, `E2E_DATABASE_URL` for the Playwright suite.
 * Nothing else is ever a valid target.
 */
export type TestDatabaseVariable = "TEST_DATABASE_URL" | "E2E_DATABASE_URL";

const OTHER_TEST_VARIABLE = {
  TEST_DATABASE_URL: "E2E_DATABASE_URL",
  E2E_DATABASE_URL: "TEST_DATABASE_URL",
} as const satisfies Record<TestDatabaseVariable, TestDatabaseVariable>;

export interface TestDatabaseGuardOptions {
  /** The environment to inspect. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The URL the caller is about to use. Defaults to the variable's own URL. */
  activeUrl?: string;
  /** Which database is being protected. Defaults to the integration-test database. */
  variable?: TestDatabaseVariable;
}

/**
 * Throws unless it is safe to run destructive test operations:
 *  1. integration tests: `NODE_ENV` is `test`; Playwright: `NODE_ENV` is not `production`;
 *  2. the variable (`TEST_DATABASE_URL` or `E2E_DATABASE_URL`) is set;
 *  3. for `E2E_DATABASE_URL`, the database name contains `e2e`, so a development database cannot be named by mistake;
 *  4. the URL about to be used is that database;
 *  5. it is not the database `DATABASE_URL`, `DIRECT_DATABASE_URL` or the other test variable points at.
 * Returns the validated URL. Messages name variables, never URLs.
 */
export function assertTestDatabase(options: TestDatabaseGuardOptions = {}): string {
  const env = options.env ?? process.env;
  const variable = options.variable ?? "TEST_DATABASE_URL";

  if (variable === "TEST_DATABASE_URL") {
    if (env.NODE_ENV !== "test") {
      throw new TestDatabaseGuardError(`NODE_ENV is ${env.NODE_ENV ?? "not set"}, not "test"`);
    }
  } else if (env.NODE_ENV === "production") {
    throw new TestDatabaseGuardError('NODE_ENV is "production"');
  }

  const testUrl = env[variable]?.trim();
  if (testUrl === undefined || testUrl === "") {
    throw new TestDatabaseGuardError(`${variable} is not set`);
  }
  const testIdentity = databaseIdentity(variable, testUrl);
  if (variable === "E2E_DATABASE_URL" && !/e2e/i.test(databaseName(variable, testUrl))) {
    throw new TestDatabaseGuardError(
      `the database named by ${variable} must have "e2e" in its name`,
    );
  }

  if (
    options.activeUrl !== undefined &&
    databaseIdentity("the active database URL", options.activeUrl) !== testIdentity
  ) {
    throw new TestDatabaseGuardError(`the active database is not the one in ${variable}`);
  }

  for (const other of [
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    OTHER_TEST_VARIABLE[variable],
  ] as const) {
    const otherUrl = env[other]?.trim();
    if (
      otherUrl !== undefined &&
      otherUrl !== "" &&
      databaseIdentity(other, otherUrl) === testIdentity
    ) {
      throw new TestDatabaseGuardError(`${variable} points at the same database as ${other}`);
    }
  }

  return testUrl;
}

let client: PrismaClient | undefined;

/** The Prisma client for the test database, created on first use and shared within one test file. */
export function getTestPrisma(): PrismaClient {
  const url = assertTestDatabase();
  client ??= createPrismaClient(url);
  return client;
}

/** Closes the shared client. Call it in `afterAll` of every integration test file. */
export async function disconnectTestPrisma(): Promise<void> {
  const existing = client;
  client = undefined;
  await existing?.$disconnect();
}

/**
 * Empties every table (all but Prisma's migration history) so each test starts from nothing.
 * Besides the environment guard, it checks the live connection: the database the client is really
 * connected to must be the one named by `variable` (`TEST_DATABASE_URL` unless told otherwise).
 */
export async function resetDatabase(
  prisma: PrismaClient = getTestPrisma(),
  variable: TestDatabaseVariable = "TEST_DATABASE_URL",
): Promise<void> {
  const testUrl = assertTestDatabase({ variable });

  const [connected] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (connected?.name !== databaseName(variable, testUrl)) {
    throw new TestDatabaseGuardError("the client is connected to a different database");
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
