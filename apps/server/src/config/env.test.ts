import { describe, expect, it } from "vitest";

import { type Config, ConfigError, loadConfig } from "./env.js";

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
};

const PRODUCTION = {
  NODE_ENV: "production",
  WEB_ORIGIN: "https://fixflow.example.com",
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
  });

  it("treats blank and whitespace-only values as unset", () => {
    const config = loadConfig({ PORT: "", WEB_ORIGIN: "   ", UPSTASH_REDIS_REST_URL: "" });

    expect(config.port).toBe(4000);
    expect(config.webOrigin).toBe("http://localhost:3000");
    expect(config.rateLimit.upstash).toBeUndefined();
  });

  it("ignores unrelated variables", () => {
    expect(() =>
      loadConfig({ PATH: "/usr/bin", HOME: "/home/dev", DATABASE_URL: "x" }),
    ).not.toThrow();
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
    expect(problemNames({ NODE_ENV: "production", ...UPSTASH })).toEqual(["WEB_ORIGIN"]);
  });

  it("refuses to fall back silently to the in-memory rate limiter", () => {
    const names = problemNames({ NODE_ENV: "production", WEB_ORIGIN: PRODUCTION.WEB_ORIGIN });

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
    };

    const { message } = configError(secretValues);

    expect(message).toContain("PORT");
    expect(message).toContain("WEB_ORIGIN");
    expect(message).toContain("UPSTASH_REDIS_REST_URL");
    expect(message).not.toContain("do-not-print");
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
