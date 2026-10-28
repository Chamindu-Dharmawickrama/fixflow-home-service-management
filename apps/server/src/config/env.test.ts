import { describe, expect, it } from "vitest";

import { type Config, ConfigError, loadConfig, loadDemoPasswords } from "./env.js";

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
};

const DATABASE_URL =
  "postgresql://app:db-secret-not-real@db.example.com:5432/fixflow?sslmode=require";

const PRODUCTION = {
  NODE_ENV: "production",
  WEB_ORIGIN: "https://fixflow.example.com",
  DATABASE_URL,
  ...UPSTASH,
};

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("Expected loadConfig to throw a ConfigError");
}

function problemNames(env: Record<string, string>): string[] {
  return configError(env)
    .problems.map((problem) => problem.variable)
    .sort();
}

describe("loadConfig defaults", () => {
  it("needs no variables for local development", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: "development",
      isProduction: false,
      port: 4000,
      logLevel: "info",
      logPretty: true,
      webOrigin: "http://localhost:3000",
      trustProxy: false,
      rateLimit: { driver: "memory", multiplier: 1, upstash: undefined },
      database: { url: undefined },
    } satisfies Config);
  });

  it("is quiet and plain in the test environment", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.logLevel).toBe("silent");
    expect(config.logPretty).toBe(false);
  });

  it("returns a deeply frozen object", () => {
    const config = loadConfig({});

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.rateLimit)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
  });

  it("treats blank and whitespace-only values as unset", () => {
    const config = loadConfig({ PORT: "", WEB_ORIGIN: "   ", UPSTASH_REDIS_REST_URL: "" });

    expect(config.port).toBe(4000);
    expect(config.webOrigin).toBe("http://localhost:3000");
    expect(config.rateLimit.upstash).toBeUndefined();
  });

  it("ignores unrelated variables", () => {
    expect(() =>
      loadConfig({ PATH: "/usr/bin", HOME: "/home/dev", SOME_OTHER_TOOL_SETTING: "x" }),
    ).not.toThrow();
  });
});

describe("loadConfig database variables", () => {
  it("starts without a database in development, so a UI-only session needs no Postgres", () => {
    expect(loadConfig({}).database.url).toBeUndefined();
  });

  it("exposes DATABASE_URL to the runtime", () => {
    expect(loadConfig({ DATABASE_URL }).database.url).toBe(DATABASE_URL);
  });

  it("accepts the postgres:// scheme and the Prisma CLI and test URLs", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://u:p@localhost:5433/fixflow_dev",
      DIRECT_DATABASE_URL: DATABASE_URL,
      TEST_DATABASE_URL: "postgresql://u:p@localhost:5433/fixflow_test",
    });

    expect(config.database.url).toBe("postgres://u:p@localhost:5433/fixflow_dev");
  });
});

describe("loadConfig values", () => {
  it("parses PORT, LOG_LEVEL and WEB_ORIGIN", () => {
    const config = loadConfig({
      PORT: "8080",
      LOG_LEVEL: "debug",
      WEB_ORIGIN: "https://app.example.com",
    });

    expect(config).toMatchObject({
      port: 8080,
      logLevel: "debug",
      webOrigin: "https://app.example.com",
    });
  });

  it.each([
    ["true", true],
    ["false", false],
    ["0", false],
    ["1", 1],
    ["2", 2],
  ])("parses TRUST_PROXY=%s", (raw, expected) => {
    expect(loadConfig({ TRUST_PROXY: raw }).trustProxy).toBe(expected);
  });

  it("trusts one proxy hop by default in production only", () => {
    expect(loadConfig(PRODUCTION).trustProxy).toBe(1);
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY: "2" }).trustProxy).toBe(2);
  });

  it("scales rate limits outside production", () => {
    expect(loadConfig({ RATE_LIMIT_MULTIPLIER: "100" }).rateLimit.multiplier).toBe(100);
    expect(loadConfig({ RATE_LIMIT_MULTIPLIER: "0.5" }).rateLimit.multiplier).toBe(0.5);
  });
});

describe("loadConfig rate limit driver", () => {
  it("defaults to memory without Upstash credentials", () => {
    expect(loadConfig({}).rateLimit.driver).toBe("memory");
  });

  it("defaults to upstash when both credentials exist", () => {
    const { rateLimit } = loadConfig(UPSTASH);

    expect(rateLimit.driver).toBe("upstash");
    expect(rateLimit.upstash).toEqual({
      url: UPSTASH.UPSTASH_REDIS_REST_URL,
      token: UPSTASH.UPSTASH_REDIS_REST_TOKEN,
    });
  });

  it("lets development opt out of Upstash explicitly", () => {
    const { rateLimit } = loadConfig({ ...UPSTASH, RATE_LIMIT_DRIVER: "memory" });

    expect(rateLimit.driver).toBe("memory");
  });

  it("requires credentials when upstash is chosen explicitly", () => {
    expect(problemNames({ RATE_LIMIT_DRIVER: "upstash" })).toEqual([
      "UPSTASH_REDIS_REST_TOKEN",
      "UPSTASH_REDIS_REST_URL",
    ]);
  });

  it("requires the credentials as a pair", () => {
    expect(problemNames({ UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL })).toEqual([
      "UPSTASH_REDIS_REST_TOKEN",
    ]);
    expect(problemNames({ UPSTASH_REDIS_REST_TOKEN: UPSTASH.UPSTASH_REDIS_REST_TOKEN })).toEqual([
      "UPSTASH_REDIS_REST_URL",
    ]);
  });
});

describe("loadConfig in production", () => {
  it("accepts a complete configuration", () => {
    const config = loadConfig(PRODUCTION);

    expect(config).toMatchObject({
      nodeEnv: "production",
      isProduction: true,
      logPretty: false,
      webOrigin: "https://fixflow.example.com",
    });
    expect(config.rateLimit.driver).toBe("upstash");
  });

  it("requires WEB_ORIGIN", () => {
    expect(problemNames({ NODE_ENV: "production", DATABASE_URL, ...UPSTASH })).toEqual([
      "WEB_ORIGIN",
    ]);
  });

  it("requires DATABASE_URL", () => {
    expect(
      problemNames({ NODE_ENV: "production", WEB_ORIGIN: PRODUCTION.WEB_ORIGIN, ...UPSTASH }),
    ).toEqual(["DATABASE_URL"]);
  });

  it("refuses to fall back silently to the in-memory rate limiter", () => {
    const names = problemNames({
      NODE_ENV: "production",
      WEB_ORIGIN: PRODUCTION.WEB_ORIGIN,
      DATABASE_URL,
    });

    expect(names).toEqual(["UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL"]);
  });

  it("refuses an explicit memory driver", () => {
    expect(problemNames({ ...PRODUCTION, RATE_LIMIT_DRIVER: "memory" })).toEqual([
      "RATE_LIMIT_DRIVER",
    ]);
  });

  it("refuses a rate limit multiplier other than 1", () => {
    expect(problemNames({ ...PRODUCTION, RATE_LIMIT_MULTIPLIER: "100" })).toEqual([
      "RATE_LIMIT_MULTIPLIER",
    ]);
  });

  it("reports every problem at once", () => {
    expect(problemNames({ NODE_ENV: "production" })).toEqual([
      "DATABASE_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "WEB_ORIGIN",
    ]);
  });
});

describe("loadConfig errors", () => {
  it.each([
    ["NODE_ENV", "staging"],
    ["PORT", "not-a-port"],
    ["PORT", "0"],
    ["PORT", "70000"],
    ["LOG_LEVEL", "verbose"],
    ["WEB_ORIGIN", "https://app.example.com/path"],
    ["WEB_ORIGIN", "https://app.example.com/"],
    ["WEB_ORIGIN", "app.example.com"],
    ["WEB_ORIGIN", "ftp://app.example.com"],
    ["TRUST_PROXY", "maybe"],
    ["UPSTASH_REDIS_REST_URL", "http://insecure.example.com"],
    ["RATE_LIMIT_DRIVER", "redis"],
    ["RATE_LIMIT_MULTIPLIER", "0"],
    ["RATE_LIMIT_MULTIPLIER", "-3"],
    ["RATE_LIMIT_MULTIPLIER", "99999999"],
    ["DATABASE_URL", "mysql://localhost/fixflow"],
    ["DATABASE_URL", "postgresql://localhost"],
    ["DATABASE_URL", "not a url"],
    ["DIRECT_DATABASE_URL", "http://localhost/fixflow"],
    ["TEST_DATABASE_URL", "localhost:5433/fixflow_test"],
    ["DEMO_ADMIN_PASSWORD", "short"],
    ["DEMO_CUSTOMER_PASSWORD", "x".repeat(129)],
  ])("rejects %s=%s and names the variable", (name, value) => {
    expect(problemNames({ [name]: value })).toContain(name);
  });

  it("lists every invalid variable, not just the first", () => {
    expect(problemNames({ PORT: "x", LOG_LEVEL: "y", WEB_ORIGIN: "z" })).toEqual([
      "LOG_LEVEL",
      "PORT",
      "WEB_ORIGIN",
    ]);
  });

  it("never includes a value in the message", () => {
    const secretValues = {
      PORT: "port-value-do-not-print",
      WEB_ORIGIN: "origin-value-do-not-print",
      UPSTASH_REDIS_REST_URL: "http://url-value-do-not-print.example.com",
      UPSTASH_REDIS_REST_TOKEN: "token-value-do-not-print",
      DATABASE_URL: "mysql://user:password-value-do-not-print@db.example.com/fixflow",
      DEMO_ADMIN_PASSWORD: "tiny-9ch!",
    };

    const { message } = configError(secretValues);

    expect(message).toContain("PORT");
    expect(message).toContain("WEB_ORIGIN");
    expect(message).toContain("UPSTASH_REDIS_REST_URL");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("DEMO_ADMIN_PASSWORD");
    expect(message).not.toContain("do-not-print");
    expect(message).not.toContain("tiny-9ch");
  });

  it("explains what is expected for an invalid value", () => {
    expect(configError({ PORT: "abc" }).message).toContain(
      "PORT: is invalid; expected an integer between 1 and 65535",
    );
  });

  it("says 'is required' for a missing variable", () => {
    expect(configError({ NODE_ENV: "production" }).message).toContain(
      "WEB_ORIGIN: is required in production",
    );
  });
});

describe("loadDemoPasswords", () => {
  const VALID = {
    DEMO_ADMIN_PASSWORD: "a-demo-admin-password",
    DEMO_CUSTOMER_PASSWORD: "a-demo-customer-password",
  };

  function demoError(env: Record<string, string>): ConfigError {
    try {
      loadDemoPasswords(env);
    } catch (error) {
      if (error instanceof ConfigError) return error;
      throw error;
    }
    throw new Error("Expected loadDemoPasswords to throw a ConfigError");
  }

  it("returns both passwords", () => {
    expect(loadDemoPasswords(VALID)).toEqual({
      admin: "a-demo-admin-password",
      customer: "a-demo-customer-password",
    });
  });

  it("names every missing variable", () => {
    const error = demoError({});

    expect(error.problems.map((problem) => problem.variable)).toEqual([
      "DEMO_ADMIN_PASSWORD",
      "DEMO_CUSTOMER_PASSWORD",
    ]);
    expect(error.message).toContain("is required to seed the demo accounts");
  });

  it("names the one that is missing and never prints a value", () => {
    const error = demoError({ DEMO_ADMIN_PASSWORD: "an-admin-password-do-not-print" });

    expect(error.problems.map((problem) => problem.variable)).toEqual(["DEMO_CUSTOMER_PASSWORD"]);
    expect(error.message).not.toContain("do-not-print");
  });

  it("refuses a password that is too short, without printing it", () => {
    const error = demoError({ ...VALID, DEMO_CUSTOMER_PASSWORD: "tiny-9ch!" });

    expect(error.message).toContain(
      "DEMO_CUSTOMER_PASSWORD: is invalid; expected 10-128 characters",
    );
    expect(error.message).not.toContain("tiny-9ch");
  });

  it("is not part of the runtime Config, which is passed around and must hold no credentials", () => {
    const config = loadConfig({ ...VALID });

    expect(JSON.stringify(config)).not.toContain("a-demo-admin-password");
  });
});
