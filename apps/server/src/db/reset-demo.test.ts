import { describe, expect, it } from "vitest";

import { assertDemoResetAllowed, DemoResetGuardError, describeTarget } from "./reset-demo.js";

const PASSWORD = "very-secret-pw-1234";
const USER = "neondb_owner";
const URL_OF = (database: string, host = "ep-quiet-mouse-12345.us-east-2.aws.neon.tech") =>
  `postgresql://${USER}:${PASSWORD}@${host}/${database}?sslmode=require`;

/** An environment in which the reset is allowed. */
const OK: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DEMO_MODE: "true",
  DATABASE_URL: URL_OF("fixflow_demo"),
  CONFIRM_DEMO_RESET: "fixflow_demo",
};

function refusal(env: NodeJS.ProcessEnv): DemoResetGuardError {
  try {
    assertDemoResetAllowed(env);
  } catch (error) {
    if (error instanceof DemoResetGuardError) return error;
    throw error;
  }
  throw new Error("The reset was allowed, but it should have been refused.");
}

describe("assertDemoResetAllowed (the reset guard, T24)", () => {
  it("allows the reset when DEMO_MODE is true and the confirmation is the database's name", () => {
    const { url, target } = assertDemoResetAllowed(OK);
    expect(url).toBe(OK.DATABASE_URL);
    expect(target).toEqual({
      host: "ep-quiet-mouse-12345.us-east-2.aws.neon.tech",
      database: "fixflow_demo",
    });
  });

  it("reports the target without credentials", () => {
    const { target } = assertDemoResetAllowed(OK);
    const text = JSON.stringify(target);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(USER);
    expect(text).not.toContain("sslmode");
  });

  describe("refuses", () => {
    it("without DEMO_MODE", () => {
      const { DEMO_MODE: _removed, ...env } = OK;
      expect(refusal(env).message).toContain("DEMO_MODE is not true");
    });

    it.each(["false", "TRUE", "1", "yes", ""])("when DEMO_MODE is %j", (value) => {
      expect(refusal({ ...OK, DEMO_MODE: value }).message).toContain("DEMO_MODE is not true");
    });

    it("without a confirmation", () => {
      const { CONFIRM_DEMO_RESET: _removed, ...env } = OK;
      expect(refusal(env).message).toContain("CONFIRM_DEMO_RESET is not set");
      expect(refusal({ ...OK, CONFIRM_DEMO_RESET: "  " }).message).toContain(
        "CONFIRM_DEMO_RESET is not set",
      );
    });

    it("when the confirmation is not the database's name", () => {
      for (const wrong of [
        "fixflow_dev",
        "FIXFLOW_DEMO",
        "fixflow_demo_2",
        "fixflow",
        "yes",
        "true",
      ]) {
        expect(refusal({ ...OK, CONFIRM_DEMO_RESET: wrong }).message).toContain("does not match");
      }
    });

    it("when DATABASE_URL cannot be parsed, without repeating it", () => {
      const unparseable = `postgresql://${USER}:${PASSWORD}@ep-quiet-mouse-12345.neon.tech:notaport/fixflow_demo`;
      expect(() => new URL(unparseable)).toThrow();

      const error = refusal({ ...OK, DATABASE_URL: unparseable });

      expect(error.message).toContain("DATABASE_URL is not a valid URL");
      expect(error.message).not.toContain(PASSWORD);
      expect(error.message).not.toContain(USER);
    });

    it("when DATABASE_URL is missing, malformed or names no database", () => {
      const { DATABASE_URL: _removed, ...missing } = OK;
      expect(refusal(missing).message).toContain("DATABASE_URL is not set");
      expect(refusal({ ...OK, DATABASE_URL: "not a url" }).message).toContain("not a valid URL");
      expect(
        refusal({ ...OK, DATABASE_URL: `postgresql://${USER}:${PASSWORD}@localhost:5432` }).message,
      ).toContain("does not name a database");
    });

    it('in a test run (NODE_ENV is "test"), even with everything else in order', () => {
      expect(refusal({ ...OK, NODE_ENV: "test" }).message).toContain('NODE_ENV is "test"');
    });

    it("when the database is the integration-test database or the E2E database", () => {
      const local = "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_test";
      const demoOnLocal = {
        ...OK,
        DATABASE_URL: local,
        CONFIRM_DEMO_RESET: "fixflow_test",
      };
      expect(refusal({ ...demoOnLocal, TEST_DATABASE_URL: local }).message).toContain(
        "same database as TEST_DATABASE_URL",
      );
      // The same database spelled another way: 127.0.0.1 for localhost, and a different user.
      expect(
        refusal({
          ...demoOnLocal,
          TEST_DATABASE_URL: "postgresql://someone:else@127.0.0.1:5433/fixflow_test",
        }).message,
      ).toContain("same database as TEST_DATABASE_URL");

      const e2e = "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_e2e";
      expect(
        refusal({
          ...OK,
          DATABASE_URL: e2e,
          CONFIRM_DEMO_RESET: "fixflow_e2e",
          E2E_DATABASE_URL: e2e,
        }).message,
      ).toContain("same database as E2E_DATABASE_URL");
    });

    it("when Neon's pooled and direct hosts name the test database", () => {
      const pooled = URL_OF("fixflow_demo", "ep-quiet-mouse-12345-pooler.us-east-2.aws.neon.tech");
      expect(
        refusal({ ...OK, DATABASE_URL: pooled, TEST_DATABASE_URL: OK.DATABASE_URL }).message,
      ).toContain("same database as TEST_DATABASE_URL");
    });

    it("allows a different test database to exist alongside the demo one", () => {
      const env = {
        ...OK,
        TEST_DATABASE_URL: "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_test",
      };
      expect(assertDemoResetAllowed(env).target.database).toBe("fixflow_demo");
    });
  });

  it("never puts a credential or the connection URL in a refusal", () => {
    const refusals = [
      refusal({ ...OK, DEMO_MODE: "false" }),
      refusal({ ...OK, CONFIRM_DEMO_RESET: "other" }),
      refusal({ ...OK, CONFIRM_DEMO_RESET: "" }),
      refusal({ ...OK, NODE_ENV: "test" }),
      // A URL that really cannot be parsed (a port that is not a number), with a password in it.
      refusal({
        ...OK,
        DATABASE_URL: `postgresql://${USER}:${PASSWORD}@ep-quiet-mouse-12345.neon.tech:notaport/fixflow_demo`,
      }),
      refusal({ ...OK, TEST_DATABASE_URL: OK.DATABASE_URL }),
    ];
    for (const error of refusals) {
      expect(error.message).not.toContain(PASSWORD);
      expect(error.message).not.toContain(USER);
      expect(error.message).not.toContain("neon.tech");
      expect(error.message.startsWith("Refusing to reset the demo database:")).toBe(true);
    }
  });
});

describe("describeTarget", () => {
  it("names the host (and port) and the database, and nothing else", () => {
    expect(
      describeTarget("DATABASE_URL", "postgresql://a:b@db.internal:6543/demo%20db?x=1"),
    ).toEqual({
      host: "db.internal:6543",
      database: "demo db",
    });
  });
});
