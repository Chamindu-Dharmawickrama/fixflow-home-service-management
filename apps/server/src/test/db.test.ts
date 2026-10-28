import { describe, expect, it } from "vitest";

import {
  assertTestDatabase,
  databaseIdentity,
  databaseName,
  TestDatabaseGuardError,
} from "./db.js";

const TEST_URL = "postgresql://fixflow_test:test-pw-secret@localhost:5433/fixflow_test";
const DEV_URL = "postgresql://fixflow_test:test-pw-secret@localhost:5433/fixflow_dev";

const SAFE_ENV = { NODE_ENV: "test", TEST_DATABASE_URL: TEST_URL, DATABASE_URL: DEV_URL };

function refusal(options: Parameters<typeof assertTestDatabase>[0]): TestDatabaseGuardError {
  try {
    assertTestDatabase(options);
  } catch (error) {
    if (error instanceof TestDatabaseGuardError) return error;
    throw error;
  }
  throw new Error("Expected assertTestDatabase to throw a TestDatabaseGuardError");
}

describe("assertTestDatabase", () => {
  it("returns the test URL when everything is safe", () => {
    expect(assertTestDatabase({ env: SAFE_ENV })).toBe(TEST_URL);
  });

  it("is fine without a DATABASE_URL at all (CI)", () => {
    expect(assertTestDatabase({ env: { NODE_ENV: "test", TEST_DATABASE_URL: TEST_URL } })).toBe(
      TEST_URL,
    );
  });

  it.each([["development"], ["production"], ["staging"], [undefined]])(
    "refuses when NODE_ENV is %s",
    (nodeEnv) => {
      const env = { ...SAFE_ENV, ...(nodeEnv !== undefined && { NODE_ENV: nodeEnv }) };
      if (nodeEnv === undefined) delete (env as Partial<typeof env>).NODE_ENV;

      expect(refusal({ env }).message).toMatch(/NODE_ENV is .*not "test"/);
    },
  );

  it.each([[undefined], [""], ["   "]])("refuses when TEST_DATABASE_URL is %j", (value) => {
    const env = {
      NODE_ENV: "test",
      DATABASE_URL: DEV_URL,
      ...(value !== undefined && { TEST_DATABASE_URL: value }),
    };

    expect(refusal({ env }).message).toContain("TEST_DATABASE_URL is not set");
  });

  it("refuses when the test URL is the same string as DATABASE_URL", () => {
    const error = refusal({ env: { ...SAFE_ENV, DATABASE_URL: TEST_URL } });

    expect(error.message).toContain("same database as DATABASE_URL");
  });

  it.each([
    ["different credentials", "postgresql://someone:else@localhost:5433/fixflow_test"],
    ["extra query options", `${TEST_URL}?sslmode=require&connection_limit=5`],
    ["the postgres:// scheme", "postgres://fixflow_test:x@localhost:5433/fixflow_test"],
    ["127.0.0.1 for localhost", "postgresql://fixflow_test:x@127.0.0.1:5433/fixflow_test"],
    ["an upper-case host", "postgresql://fixflow_test:x@LOCALHOST:5433/fixflow_test"],
  ])("refuses when DATABASE_URL is the same database with %s", (_what, sameDatabase) => {
    expect(refusal({ env: { ...SAFE_ENV, DATABASE_URL: sameDatabase } }).message).toContain(
      "same database as DATABASE_URL",
    );
  });

  it("refuses the Neon pooled and direct spellings of one database", () => {
    const direct = "postgresql://u:p@ep-cool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
    const pooled =
      "postgresql://u:p@ep-cool-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

    expect(
      refusal({ env: { NODE_ENV: "test", TEST_DATABASE_URL: direct, DATABASE_URL: pooled } })
        .message,
    ).toContain("same database as DATABASE_URL");
  });

  it("allows a different database on the same server", () => {
    expect(assertTestDatabase({ env: SAFE_ENV })).toBe(TEST_URL);
  });

  it("refuses when the test URL is the same database as DIRECT_DATABASE_URL", () => {
    const env = { ...SAFE_ENV, DIRECT_DATABASE_URL: TEST_URL };

    expect(refusal({ env }).message).toContain("same database as DIRECT_DATABASE_URL");
  });

  it("refuses when the URL about to be used is not the test database", () => {
    expect(refusal({ env: SAFE_ENV, activeUrl: DEV_URL }).message).toContain("active database");
    expect(assertTestDatabase({ env: SAFE_ENV, activeUrl: `${TEST_URL}?sslmode=disable` })).toBe(
      TEST_URL,
    );
  });

  it("refuses a URL it cannot parse, naming the variable", () => {
    const error = refusal({ env: { NODE_ENV: "test", TEST_DATABASE_URL: "not a url" } });

    expect(error.message).toContain("TEST_DATABASE_URL is not a valid URL");
  });

  it("never puts a URL or a credential in its message", () => {
    const messages = [
      refusal({ env: { ...SAFE_ENV, DATABASE_URL: TEST_URL } }).message,
      refusal({ env: SAFE_ENV, activeUrl: DEV_URL }).message,
      refusal({ env: { ...SAFE_ENV, NODE_ENV: "production" } }).message,
      refusal({ env: { NODE_ENV: "test", TEST_DATABASE_URL: "postgres://u:test-pw-secret@" } })
        .message,
    ];

    for (const message of messages) {
      expect(message).not.toContain("test-pw-secret");
      expect(message).not.toContain("localhost");
    }
  });

  it("reads process.env by default", () => {
    // Vitest runs with NODE_ENV=test; with no TEST_DATABASE_URL the guard still refuses.
    const saved = process.env.TEST_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    try {
      expect(() => assertTestDatabase()).toThrow(TestDatabaseGuardError);
    } finally {
      if (saved !== undefined) process.env.TEST_DATABASE_URL = saved;
    }
  });
});

describe("databaseIdentity", () => {
  it("ignores credentials, query options and the scheme", () => {
    expect(databaseIdentity("X", "postgresql://a:b@db.example.com:5432/app?sslmode=require")).toBe(
      databaseIdentity("X", "postgres://c:d@db.example.com/app"),
    );
  });

  it("tells databases apart by host, port and name", () => {
    const base = databaseIdentity("X", "postgresql://a:b@db.example.com:5432/app");

    expect(databaseIdentity("X", "postgresql://a:b@other.example.com:5432/app")).not.toBe(base);
    expect(databaseIdentity("X", "postgresql://a:b@db.example.com:5433/app")).not.toBe(base);
    expect(databaseIdentity("X", "postgresql://a:b@db.example.com:5432/app2")).not.toBe(base);
  });
});

describe("databaseName", () => {
  it("reads the name from the path", () => {
    expect(databaseName("X", "postgresql://a:b@localhost:5433/fixflow_test?sslmode=disable")).toBe(
      "fixflow_test",
    );
  });
});
