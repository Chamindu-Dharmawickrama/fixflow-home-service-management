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

export interface TestDatabaseGuardOptions {
  /** The environment to inspect. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The URL the caller is about to use. Defaults to `TEST_DATABASE_URL`. */
  activeUrl?: string;
}

/**
 * Throws unless it is safe to run destructive test operations:
 *  1. `NODE_ENV` is `test`;
 *  2. `TEST_DATABASE_URL` is set;
 *  3. the URL about to be used is that test database;
 *  4. the test database is not the one `DATABASE_URL` or `DIRECT_DATABASE_URL` points at.
 * Returns the validated `TEST_DATABASE_URL`. Messages name variables, never URLs.
 */
export function assertTestDatabase(options: TestDatabaseGuardOptions = {}): string {
  const env = options.env ?? process.env;

  if (env.NODE_ENV !== "test") {
    throw new TestDatabaseGuardError(`NODE_ENV is ${env.NODE_ENV ?? "not set"}, not "test"`);
  }

  const testUrl = env.TEST_DATABASE_URL?.trim();
  if (testUrl === undefined || testUrl === "") {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL is not set");
  }
  const testIdentity = databaseIdentity("TEST_DATABASE_URL", testUrl);

  if (
    options.activeUrl !== undefined &&
    databaseIdentity("the active database URL", options.activeUrl) !== testIdentity
  ) {
    throw new TestDatabaseGuardError("the active database is not the one in TEST_DATABASE_URL");
  }

  for (const variable of ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const) {
    const other = env[variable]?.trim();
    if (other !== undefined && other !== "" && databaseIdentity(variable, other) === testIdentity) {
      throw new TestDatabaseGuardError(
        `TEST_DATABASE_URL points at the same database as ${variable}`,
      );
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
 * connected to must be the one named in `TEST_DATABASE_URL`.
 */
export async function resetDatabase(prisma: PrismaClient = getTestPrisma()): Promise<void> {
  const testUrl = assertTestDatabase();

  const [connected] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (connected?.name !== databaseName("TEST_DATABASE_URL", testUrl)) {
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
