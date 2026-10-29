import { randomBytes } from "node:crypto";

import { z } from "zod";

import { isCommonPassword } from "../lib/common-passwords.js";
import { looksLikeEmail, parseEmailList } from "../lib/email-address.js";

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const RATE_LIMIT_DRIVERS = ["memory", "upstash"] as const;
export type RateLimitDriver = (typeof RATE_LIMIT_DRIVERS)[number];

export const EMAIL_TRANSPORTS = ["log", "smtp"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

export interface UpstashCredentials {
  readonly url: string;
  readonly token: string;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** `true` = TLS from the first byte (usually port 465); `false` = STARTTLS when offered. */
  readonly secure: boolean;
  readonly user: string | undefined;
  readonly password: string | undefined;
}

/** The session cookie's name outside production; production uses the `__Host-` prefixed one. */
export const SESSION_COOKIE_NAME_DEVELOPMENT = "fixflow_session";
export const SESSION_COOKIE_NAME_PRODUCTION = "__Host-fixflow_session";

const SESSION_SECRET_MIN_LENGTH = 32;
const DEFAULT_EMAIL_FROM = "FixFlow <no-reply@fixflow.test>";

/** Typed, frozen API configuration. Parsed once at startup by {@link loadConfig}. */
export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Human-readable log output; development only. */
  readonly logPretty: boolean;
  /** The single browser origin allowed by CORS (and, from T05, by the CSRF Origin check). */
  readonly webOrigin: string;
  /** Express `trust proxy` setting: `false`, `true`, or the number of proxy hops. */
  readonly trustProxy: boolean | number;
  readonly rateLimit: {
    readonly driver: RateLimitDriver;
    /** Scales every named limit. Test and E2E environments raise it; production must keep `1`. */
    readonly multiplier: number;
    readonly upstash: UpstashCredentials | undefined;
  };
  readonly database: {
    /**
     * The runtime connection URL (Neon: the pooled endpoint). Required in production; elsewhere
     * the API starts without it and `/api/v1/health/ready` reports 503.
     */
    readonly url: string | undefined;
  };
  readonly auth: {
    /** HMAC key for session and password-reset token hashes. At least 32 characters. */
    readonly sessionSecret: string;
    /**
     * True when `SESSION_SECRET` was not set and a random per-process secret was generated, which
     * is allowed outside production only: every restart then signs everyone out.
     */
    readonly sessionSecretIsEphemeral: boolean;
    /** `__Host-fixflow_session` in production, `fixflow_session` elsewhere (D-10). */
    readonly cookieName: string;
    /** `ADMIN_EMAILS`, normalized and de-duplicated (D-08). */
    readonly adminEmails: readonly string[];
    /** The OAuth Web client ID that Google ID tokens must be issued for. Unset = Google sign-in is off. */
    readonly googleClientId: string | undefined;
    /** Public demo: demo accounts cannot change or reset their passwords (D-09). */
    readonly demoMode: boolean;
    /** `false` closes registration (local and Google) without a code change (D-09). */
    readonly publicSignupEnabled: boolean;
  };
  readonly email: {
    readonly transport: EmailTransport;
    /** The `From` header, for example `CoolBreeze <hello@coolbreeze.example>`. */
    readonly from: string;
    readonly smtp: SmtpSettings | undefined;
    /** The web app's public origin, used to build links in emails. Defaults to `webOrigin`. */
    readonly publicWebUrl: string;
    /** Where the log transport writes emails (development and test only). */
    readonly outboxDir: string | undefined;
  };
}

const DEMO_PASSWORD_MIN_LENGTH = 10;
const DEMO_PASSWORD_MAX_LENGTH = 128;
const DEMO_PASSWORD_EXPECTED = `${DEMO_PASSWORD_MIN_LENGTH}-${DEMO_PASSWORD_MAX_LENGTH} characters that are not a common password`;

/**
 * The fixed text shown for an invalid variable. Messages never include the offending value
 * (a malformed secret must not end up in a log), so they come from this table, not from Zod.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  NODE_ENV: NODE_ENVS.join(", "),
  PORT: "an integer between 1 and 65535",
  LOG_LEVEL: LOG_LEVELS.join(", "),
  WEB_ORIGIN: "an origin such as https://app.example.com (scheme and host, no path)",
  TRUST_PROXY: "true, false, or the number of proxy hops",
  UPSTASH_REDIS_REST_URL: "an https URL",
  UPSTASH_REDIS_REST_TOKEN: "a non-empty string",
  RATE_LIMIT_DRIVER: RATE_LIMIT_DRIVERS.join(", "),
  RATE_LIMIT_MULTIPLIER: "a number greater than 0",
  DATABASE_URL: "a postgresql:// connection URL with a host and a database name",
  DIRECT_DATABASE_URL: "a postgresql:// connection URL with a host and a database name",
  TEST_DATABASE_URL: "a postgresql:// connection URL with a host and a database name",
  DEMO_ADMIN_PASSWORD: DEMO_PASSWORD_EXPECTED,
  DEMO_CUSTOMER_PASSWORD: DEMO_PASSWORD_EXPECTED,
  SESSION_SECRET: `a random string of at least ${SESSION_SECRET_MIN_LENGTH} characters`,
  ADMIN_EMAILS: "a comma-separated list of email addresses",
  GOOGLE_CLIENT_ID: "a Google OAuth client ID ending in .apps.googleusercontent.com",
  DEMO_MODE: "true or false",
  PUBLIC_SIGNUP_ENABLED: "true or false",
  EMAIL_TRANSPORT: EMAIL_TRANSPORTS.join(", "),
  EMAIL_FROM: "an address such as hello@example.com or Name <hello@example.com>",
  EMAIL_OUTBOX_DIR: "a directory path",
  SMTP_HOST: "a host name",
  SMTP_PORT: "an integer between 1 and 65535",
  SMTP_SECURE: "true or false",
  SMTP_USER: "a non-empty string",
  SMTP_PASSWORD: "a non-empty string",
  PUBLIC_WEB_URL: "an origin such as https://app.example.com (scheme and host, no path)",
};

const DEFAULT_PORT = 4000;
const DEFAULT_DEV_WEB_ORIGIN = "http://localhost:3000";
const MAX_RATE_LIMIT_MULTIPLIER = 10_000;
/** One proxy hop: the platform load balancer in front of the API (verified in T09, D-06). */
const DEFAULT_PRODUCTION_TRUST_PROXY = 1;

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname !== "" &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/** The password policy (D-51) as far as it can apply to a seeded account: length and not a common password. */
function isDemoPassword(value: string): boolean {
  return (
    value.length >= DEMO_PASSWORD_MIN_LENGTH &&
    value.length <= DEMO_PASSWORD_MAX_LENGTH &&
    !isCommonPassword(value)
  );
}

function isEmailList(value: string): boolean {
  return parseEmailList(value).invalid === 0;
}

/** Accepts `Name <a@b.c>` or a bare address. */
function isFromAddress(value: string): boolean {
  const angle = /<([^<>]+)>\s*$/.exec(value);
  return looksLikeEmail(angle?.[1] ?? value) && !/[\r\n]/.test(value);
}

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  PORT: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65535)
    .default(DEFAULT_PORT),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  WEB_ORIGIN: z.string().refine(isOrigin).optional(),
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|\d{1,2})$/)
    .transform((value): boolean | number => {
      if (value === "true") return true;
      if (value === "false") return false;
      return Number(value) === 0 ? false : Number(value);
    })
    .optional(),
  UPSTASH_REDIS_REST_URL: z.string().refine(isHttpsUrl).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  RATE_LIMIT_DRIVER: z.enum(RATE_LIMIT_DRIVERS).optional(),
  RATE_LIMIT_MULTIPLIER: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number)
    .refine((value) => value > 0 && value <= MAX_RATE_LIMIT_MULTIPLIER)
    .default(1),
  DATABASE_URL: z.string().refine(isPostgresUrl).optional(),
  // Prisma CLI only (prisma.config.ts): migrations need a direct, non-pooled connection.
  DIRECT_DATABASE_URL: z.string().refine(isPostgresUrl).optional(),
  // Integration tests only; src/test/db.ts refuses to touch any other database.
  TEST_DATABASE_URL: z.string().refine(isPostgresUrl).optional(),
  // Seed only (prisma/seed.ts); read through loadDemoPasswords, never placed in Config.
  DEMO_ADMIN_PASSWORD: z.string().refine(isDemoPassword).optional(),
  DEMO_CUSTOMER_PASSWORD: z.string().refine(isDemoPassword).optional(),

  // Authentication (T05)
  SESSION_SECRET: z.string().min(SESSION_SECRET_MIN_LENGTH).optional(),
  ADMIN_EMAILS: z.string().refine(isEmailList).optional(),
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  DEMO_MODE: booleanString.default(false),
  PUBLIC_SIGNUP_ENABLED: booleanString.default(true),

  // E-mail (T05 builds the minimal module, T06 extends it)
  EMAIL_TRANSPORT: z.enum(EMAIL_TRANSPORTS).optional(),
  EMAIL_FROM: z.string().max(200).refine(isFromAddress).optional(),
  EMAIL_OUTBOX_DIR: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).max(253).optional(),
  SMTP_PORT: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65535)
    .optional(),
  SMTP_SECURE: booleanString.optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  PUBLIC_WEB_URL: z.string().refine(isOrigin).optional(),
});

type ParsedEnv = z.output<typeof envSchema>;

/** Every environment variable the API reads. */
export const CONFIG_VARIABLE_NAMES: readonly string[] = Object.keys(envSchema.shape);

export interface ConfigProblem {
  readonly variable: string;
  readonly reason: string;
}

/** Thrown when the environment is invalid. Lists variable **names** only, never their values. */
export class ConfigError extends Error {
  readonly problems: readonly ConfigProblem[];

  constructor(problems: readonly ConfigProblem[]) {
    super(
      [
        "Invalid environment configuration:",
        ...problems.map(({ variable, reason }) => `  - ${variable}: ${reason}`),
      ].join("\n"),
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/** Keeps only the variables this API reads, trimmed, with blank values treated as unset. */
function readKnownVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  const known: Record<string, string> = {};
  for (const name of CONFIG_VARIABLE_NAMES) {
    const value = env[name]?.trim();
    if (value) {
      known[name] = value;
    }
  }
  return known;
}

function problemsFromSchema(error: z.ZodError, input: Record<string, string>): ConfigProblem[] {
  const problems = new Map<string, ConfigProblem>();
  for (const issue of error.issues) {
    const variable = String(issue.path[0] ?? "(environment)");
    const reason =
      input[variable] === undefined
        ? "is required"
        : `is invalid; expected ${EXPECTED[variable] ?? "a valid value"}`;
    problems.set(variable, { variable, reason });
  }
  return [...problems.values()];
}

function resolveDriver(parsed: ParsedEnv): RateLimitDriver {
  const hasCredentials =
    parsed.UPSTASH_REDIS_REST_URL !== undefined && parsed.UPSTASH_REDIS_REST_TOKEN !== undefined;
  return parsed.RATE_LIMIT_DRIVER ?? (hasCredentials ? "upstash" : "memory");
}

/** Rules that span several variables, or that depend on `NODE_ENV`. */
function crossFieldProblems(parsed: ParsedEnv): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (variable: string, reason: string): void => {
    problems.push({ variable, reason });
  };

  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = parsed;
  if (url !== undefined && token === undefined) {
    add("UPSTASH_REDIS_REST_TOKEN", "is required when UPSTASH_REDIS_REST_URL is set");
  }
  if (token !== undefined && url === undefined) {
    add("UPSTASH_REDIS_REST_URL", "is required when UPSTASH_REDIS_REST_TOKEN is set");
  }

  const driver = resolveDriver(parsed);
  if (driver === "upstash" && (url === undefined || token === undefined)) {
    const credentialsAlreadyReported = problems.length > 0;
    if (!credentialsAlreadyReported) {
      add("UPSTASH_REDIS_REST_URL", "is required when the rate limit driver is upstash");
      add("UPSTASH_REDIS_REST_TOKEN", "is required when the rate limit driver is upstash");
    }
  }

  if (parsed.NODE_ENV === "production") {
    if (parsed.WEB_ORIGIN === undefined) {
      add("WEB_ORIGIN", "is required in production");
    }
    if (parsed.DATABASE_URL === undefined) {
      add("DATABASE_URL", "is required in production");
    }
    if (driver === "memory") {
      // The in-memory limiter is per process: it would silently stop limiting across instances
      // and restarts. Production must use Upstash, so refuse to start rather than degrade.
      if (parsed.RATE_LIMIT_DRIVER === "memory") {
        add("RATE_LIMIT_DRIVER", "must be upstash in production");
      } else {
        add(
          "UPSTASH_REDIS_REST_URL",
          "is required in production (the memory rate limiter is not allowed)",
        );
        add(
          "UPSTASH_REDIS_REST_TOKEN",
          "is required in production (the memory rate limiter is not allowed)",
        );
      }
    }
    if (parsed.RATE_LIMIT_MULTIPLIER !== 1) {
      add("RATE_LIMIT_MULTIPLIER", "must be 1 in production");
    }
    if (parsed.SESSION_SECRET === undefined) {
      add("SESSION_SECRET", "is required in production");
    }
  }

  if (resolveEmailTransport(parsed) === "smtp") {
    if (parsed.SMTP_HOST === undefined) {
      add("SMTP_HOST", "is required when the e-mail transport is smtp");
    }
    if (parsed.EMAIL_FROM === undefined) {
      add("EMAIL_FROM", "is required when the e-mail transport is smtp");
    }
  }
  if (parsed.SMTP_USER !== undefined && parsed.SMTP_PASSWORD === undefined) {
    add("SMTP_PASSWORD", "is required when SMTP_USER is set");
  }
  if (parsed.SMTP_PASSWORD !== undefined && parsed.SMTP_USER === undefined) {
    add("SMTP_USER", "is required when SMTP_PASSWORD is set");
  }

  if (parsed.NODE_ENV === "production" && resolveEmailTransport(parsed) === "smtp") {
    // In production nothing is guessed: the port and TLS mode have defaults elsewhere, but a real
    // mail server is configured explicitly, with credentials. (`log` is allowed; the server warns.)
    const required: ReadonlyArray<[variable: string, value: unknown]> = [
      ["SMTP_HOST", parsed.SMTP_HOST],
      ["SMTP_PORT", parsed.SMTP_PORT],
      ["SMTP_SECURE", parsed.SMTP_SECURE],
      ["SMTP_USER", parsed.SMTP_USER],
      ["SMTP_PASSWORD", parsed.SMTP_PASSWORD],
      ["EMAIL_FROM", parsed.EMAIL_FROM],
    ];
    for (const [variable, value] of required) {
      if (value === undefined && !problems.some((problem) => problem.variable === variable)) {
        add(variable, "is required in production when the e-mail transport is smtp");
      }
    }
  }

  return problems;
}

/** Explicit `EMAIL_TRANSPORT`, else `smtp` when an SMTP host is configured, else `log`. */
function resolveEmailTransport(parsed: ParsedEnv): EmailTransport {
  return parsed.EMAIL_TRANSPORT ?? (parsed.SMTP_HOST === undefined ? "log" : "smtp");
}

function buildSmtp(parsed: ParsedEnv): SmtpSettings | undefined {
  if (parsed.SMTP_HOST === undefined) {
    return undefined;
  }
  const secure = parsed.SMTP_SECURE ?? false;
  return {
    host: parsed.SMTP_HOST,
    port: parsed.SMTP_PORT ?? (secure ? 465 : 587),
    secure,
    user: parsed.SMTP_USER,
    password: parsed.SMTP_PASSWORD,
  };
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function buildConfig(parsed: ParsedEnv): Config {
  const nodeEnv = parsed.NODE_ENV;
  const isProduction = nodeEnv === "production";
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = parsed;

  return deepFreeze({
    nodeEnv,
    isProduction,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === "test" ? "silent" : "info"),
    logPretty: nodeEnv === "development",
    webOrigin: parsed.WEB_ORIGIN ?? DEFAULT_DEV_WEB_ORIGIN,
    trustProxy: parsed.TRUST_PROXY ?? (isProduction ? DEFAULT_PRODUCTION_TRUST_PROXY : false),
    rateLimit: {
      driver: resolveDriver(parsed),
      multiplier: parsed.RATE_LIMIT_MULTIPLIER,
      upstash: url !== undefined && token !== undefined ? { url, token } : undefined,
    },
    database: { url: parsed.DATABASE_URL },
    auth: {
      // Outside production a missing secret gets a random one, so the API still starts with no
      // `.env`; production refuses to start without one (see crossFieldProblems).
      sessionSecret: parsed.SESSION_SECRET ?? randomBytes(32).toString("hex"),
      sessionSecretIsEphemeral: parsed.SESSION_SECRET === undefined,
      cookieName: isProduction ? SESSION_COOKIE_NAME_PRODUCTION : SESSION_COOKIE_NAME_DEVELOPMENT,
      adminEmails: parseEmailList(parsed.ADMIN_EMAILS).emails,
      googleClientId: parsed.GOOGLE_CLIENT_ID,
      demoMode: parsed.DEMO_MODE,
      publicSignupEnabled: parsed.PUBLIC_SIGNUP_ENABLED,
    },
    email: {
      transport: resolveEmailTransport(parsed),
      from: parsed.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
      smtp: buildSmtp(parsed),
      publicWebUrl: parsed.PUBLIC_WEB_URL ?? parsed.WEB_ORIGIN ?? DEFAULT_DEV_WEB_ORIGIN,
      outboxDir: parsed.EMAIL_OUTBOX_DIR,
    },
  });
}

/**
 * Parses and validates the environment once. Pass an explicit `env` in tests; nothing here reads
 * files. Throws {@link ConfigError} listing every invalid variable by name.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input = readKnownVariables(env);

  const result = envSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(problemsFromSchema(result.error, input));
  }

  const problems = crossFieldProblems(result.data);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return buildConfig(result.data);
}

export interface DemoPasswords {
  readonly admin: string;
  readonly customer: string;
}

/**
 * The passwords for the seeded demo accounts. Only `prisma/seed.ts` calls this. They are kept out
 * of {@link Config} on purpose: that object is passed everywhere and must never hold a credential
 * that could end up in a log line. Throws {@link ConfigError} naming what is missing or too weak.
 */
export function loadDemoPasswords(env: NodeJS.ProcessEnv = process.env): DemoPasswords {
  const input = readKnownVariables(env);
  const problems: ConfigProblem[] = [];
  const read = (variable: "DEMO_ADMIN_PASSWORD" | "DEMO_CUSTOMER_PASSWORD"): string => {
    const value = input[variable];
    if (value === undefined) {
      problems.push({ variable, reason: "is required to seed the demo accounts" });
      return "";
    }
    if (!isDemoPassword(value)) {
      problems.push({
        variable,
        reason: `is invalid; expected ${EXPECTED[variable] ?? "a valid value"}`,
      });
    }
    return value;
  };

  const admin = read("DEMO_ADMIN_PASSWORD");
  const customer = read("DEMO_CUSTOMER_PASSWORD");
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return { admin, customer };
}
