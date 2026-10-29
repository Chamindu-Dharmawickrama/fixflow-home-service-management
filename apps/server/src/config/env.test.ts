import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkPasswordPolicy } from "../lib/password.js";
import {
  type Config,
  CONFIG_VARIABLE_NAMES,
  ConfigError,
  loadConfig,
  loadDemoPasswords,
} from "./env.js";

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://eu1-example-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok-example-not-a-real-token",
};

const DATABASE_URL =
  "postgresql://app:db-secret-not-real@db.example.com:5432/fixflow?sslmode=require";

const SESSION_SECRET = "session-secret-for-tests-0123456789abcdef";

const PRODUCTION = {
  NODE_ENV: "production",
  WEB_ORIGIN: "https://fixflow.example.com",
  DATABASE_URL,
  SESSION_SECRET,
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
    const { auth, email, ...platform } = loadConfig({});

    expect(platform).toEqual({
      nodeEnv: "development",
      isProduction: false,
      port: 4000,
      logLevel: "info",
      logPretty: true,
      webOrigin: "http://localhost:3000",
      trustProxy: false,
      rateLimit: { driver: "memory", multiplier: 1, upstash: undefined },
      database: { url: undefined },
    } satisfies Omit<Config, "auth" | "email">);
    expect({ ...auth, sessionSecret: undefined }).toEqual({
      sessionSecret: undefined,
      sessionSecretIsEphemeral: true,
      cookieName: "fixflow_session",
      adminEmails: [],
      googleClientId: undefined,
      demoMode: false,
      publicSignupEnabled: true,
    });
    expect(email).toEqual({
      transport: "log",
      from: "FixFlow <no-reply@fixflow.test>",
      smtp: undefined,
      publicWebUrl: "http://localhost:3000",
      outboxDir: undefined,
    });
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
    expect(
      problemNames({ NODE_ENV: "production", DATABASE_URL, SESSION_SECRET, ...UPSTASH }),
    ).toEqual(["WEB_ORIGIN"]);
  });

  it("requires DATABASE_URL", () => {
    expect(
      problemNames({
        NODE_ENV: "production",
        WEB_ORIGIN: PRODUCTION.WEB_ORIGIN,
        SESSION_SECRET,
        ...UPSTASH,
      }),
    ).toEqual(["DATABASE_URL"]);
  });

  it("refuses to fall back silently to the in-memory rate limiter", () => {
    const names = problemNames({
      NODE_ENV: "production",
      WEB_ORIGIN: PRODUCTION.WEB_ORIGIN,
      DATABASE_URL,
      SESSION_SECRET,
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
      "SESSION_SECRET",
      "UPSTASH_REDIS_REST_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "WEB_ORIGIN",
    ]);
  });

  it("requires SESSION_SECRET", () => {
    const { SESSION_SECRET: _omitted, ...withoutSecret } = PRODUCTION;

    expect(problemNames(withoutSecret)).toEqual(["SESSION_SECRET"]);
  });

  it("uses the __Host- cookie name in production only", () => {
    expect(loadConfig(PRODUCTION).auth.cookieName).toBe("__Host-fixflow_session");
    expect(loadConfig({}).auth.cookieName).toBe("fixflow_session");
    expect(loadConfig({ NODE_ENV: "test" }).auth.cookieName).toBe("fixflow_session");
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
    ["DEMO_ADMIN_PASSWORD", "Password123!"],
    ["DEMO_CUSTOMER_PASSWORD", "1234567890"],
    ["SESSION_SECRET", "too-short"],
    ["ADMIN_EMAILS", "owner@example.com, not-an-email"],
    ["GOOGLE_CLIENT_ID", "short"],
    ["DEMO_MODE", "yes"],
    ["PUBLIC_SIGNUP_ENABLED", "1"],
    ["EMAIL_TRANSPORT", "sendmail"],
    ["EMAIL_FROM", "not an address"],
    ["SMTP_PORT", "0"],
    ["SMTP_SECURE", "maybe"],
    ["PUBLIC_WEB_URL", "https://app.example.com/reset"],
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

describe("loadConfig authentication variables", () => {
  it("normalizes and de-duplicates ADMIN_EMAILS", () => {
    const config = loadConfig({
      ADMIN_EMAILS:
        " Owner@CoolBreeze.example , admin@demo.fixflow.test,owner@coolbreeze.example,, ",
    });

    expect(config.auth.adminEmails).toEqual([
      "owner@coolbreeze.example",
      "admin@demo.fixflow.test",
    ]);
    expect(Object.isFrozen(config.auth.adminEmails)).toBe(true);
  });

  it("reads the switches", () => {
    const config = loadConfig({
      DEMO_MODE: "true",
      PUBLIC_SIGNUP_ENABLED: "false",
      GOOGLE_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com",
    });

    expect(config.auth).toMatchObject({
      demoMode: true,
      publicSignupEnabled: false,
      googleClientId: "1234567890-abc.apps.googleusercontent.com",
    });
  });

  it("uses the configured session secret and generates a different one per process otherwise", () => {
    const configured = loadConfig({ SESSION_SECRET });
    const first = loadConfig({});
    const second = loadConfig({});

    expect(configured.auth).toMatchObject({ sessionSecret: SESSION_SECRET });
    expect(configured.auth.sessionSecretIsEphemeral).toBe(false);
    expect(first.auth.sessionSecretIsEphemeral).toBe(true);
    expect(first.auth.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(first.auth.sessionSecret).not.toBe(second.auth.sessionSecret);
  });
});

describe("loadConfig e-mail variables", () => {
  it("defaults to the log transport and the web origin for links", () => {
    const { email } = loadConfig({ WEB_ORIGIN: "https://fixflow.example.com" });

    expect(email).toMatchObject({
      transport: "log",
      smtp: undefined,
      publicWebUrl: "https://fixflow.example.com",
    });
  });

  it("switches to smtp when a host is configured, with port and TLS defaults", () => {
    const plain = loadConfig({ SMTP_HOST: "smtp.example.com", EMAIL_FROM: "hello@example.com" });
    const secure = loadConfig({
      SMTP_HOST: "smtp.example.com",
      EMAIL_FROM: "CoolBreeze <hello@example.com>",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "smtp-password-not-real",
    });

    expect(plain.email.transport).toBe("smtp");
    expect(plain.email.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: undefined,
      password: undefined,
    });
    expect(secure.email.smtp).toMatchObject({ port: 465, secure: true, user: "mailer" });
  });

  it("lets an explicit log transport win over a configured host", () => {
    expect(
      loadConfig({ SMTP_HOST: "smtp.example.com", EMAIL_TRANSPORT: "log" }).email.transport,
    ).toBe("log");
  });

  it("requires a host and a sender for the smtp transport", () => {
    expect(problemNames({ EMAIL_TRANSPORT: "smtp" })).toEqual(["EMAIL_FROM", "SMTP_HOST"]);
  });

  it("requires SMTP_USER and SMTP_PASSWORD together", () => {
    expect(problemNames({ SMTP_USER: "mailer" })).toEqual(["SMTP_PASSWORD"]);
    expect(problemNames({ SMTP_PASSWORD: "smtp-password-not-real" })).toEqual(["SMTP_USER"]);
  });

  describe("in production (T06)", () => {
    const COMPLETE_SMTP = {
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "CoolBreeze <hello@coolbreeze.example>",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "smtp-password-not-real",
    };

    it("refuses the smtp transport without any of the SMTP variables", () => {
      expect(problemNames({ ...PRODUCTION, EMAIL_TRANSPORT: "smtp" })).toEqual([
        "EMAIL_FROM",
        "SMTP_HOST",
        "SMTP_PASSWORD",
        "SMTP_PORT",
        "SMTP_SECURE",
        "SMTP_USER",
      ]);
    });

    it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"])(
      "refuses the smtp transport when %s is missing",
      (missing) => {
        const env: Record<string, string> = { ...PRODUCTION, ...COMPLETE_SMTP };
        delete env[missing];

        expect(problemNames(env)).toContain(missing);
      },
    );

    it("names the variables without echoing any value", () => {
      const message = configError({ ...PRODUCTION, EMAIL_TRANSPORT: "smtp" }).message;

      expect(message).toContain("SMTP_PORT: is required in production when the e-mail transport");
      expect(message).toContain("SMTP_PASSWORD: is required in production");
      expect(message).not.toContain(SESSION_SECRET);
      expect(message).not.toContain(DATABASE_URL);
    });

    it("accepts a complete SMTP configuration", () => {
      const { email } = loadConfig({ ...PRODUCTION, ...COMPLETE_SMTP });

      expect(email.transport).toBe("smtp");
      expect(email.smtp).toMatchObject({ host: "smtp.example.com", port: 587, secure: false });
    });

    it("treats a configured host as the smtp transport and holds it to the same rule", () => {
      expect(problemNames({ ...PRODUCTION, SMTP_HOST: "smtp.example.com" })).toEqual([
        "EMAIL_FROM",
        "SMTP_PASSWORD",
        "SMTP_PORT",
        "SMTP_SECURE",
        "SMTP_USER",
      ]);
    });

    it("allows the log transport (the server warns about it at startup)", () => {
      expect(loadConfig({ ...PRODUCTION, EMAIL_TRANSPORT: "log" }).email.transport).toBe("log");
      expect(loadConfig(PRODUCTION).email.transport).toBe("log");
    });

    it("does not ask a non-production environment for the full set", () => {
      expect(
        loadConfig({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example.com", EMAIL_FROM: "a@b.co" })
          .email.transport,
      ).toBe("smtp");
    });
  });
});

describe("the example environment file", () => {
  const raw = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  /** Every uncommented NAME=value line, as `loadConfig` would see it. */
  const example: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] !== undefined) example[match[1]] = match[2] ?? "";
  }

  it("loads without errors, so a developer can copy it as it is", () => {
    expect(() => loadConfig(example)).not.toThrow();
    expect(() => loadDemoPasswords(example)).not.toThrow();
  });

  it("documents demo passwords that satisfy the password policy", () => {
    const admin = example.DEMO_ADMIN_PASSWORD ?? "";
    const customer = example.DEMO_CUSTOMER_PASSWORD ?? "";

    expect(admin.length).toBeGreaterThan(0);
    expect(checkPasswordPolicy(admin, { email: "admin@demo.fixflow.test" })).toBeUndefined();
    expect(checkPasswordPolicy(customer, { email: "alex.morgan@example.test" })).toBeUndefined();
  });

  it("lists the demo admin in ADMIN_EMAILS, because requireAdmin re-checks the allowlist (D-08)", () => {
    expect(loadConfig(example).auth.adminEmails).toContain("admin@demo.fixflow.test");
  });

  it("sets a session secret that is long enough", () => {
    expect(loadConfig(example).auth.sessionSecretIsEphemeral).toBe(false);
  });

  it("documents every variable the API reads", () => {
    for (const name of CONFIG_VARIABLE_NAMES) {
      expect(raw, `${name} is missing from .env.example`).toMatch(
        new RegExp(`^#?\\s*${name}=`, "m"),
      );
    }
  });
});

describe("loadDemoPasswords and the password policy", () => {
  it("refuses a demo password on the common-password list, without printing it", () => {
    let thrown: unknown;
    try {
      loadDemoPasswords({
        DEMO_ADMIN_PASSWORD: "Password123!",
        DEMO_CUSTOMER_PASSWORD: "a-demo-customer-password",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    const error = thrown as ConfigError;
    expect(error.problems.map((problem) => problem.variable)).toEqual(["DEMO_ADMIN_PASSWORD"]);
    expect(error.message).not.toContain("Password123");
  });
});
