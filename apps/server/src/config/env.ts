import { z } from "zod";

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const RATE_LIMIT_DRIVERS = ["memory", "upstash"] as const;
export type RateLimitDriver = (typeof RATE_LIMIT_DRIVERS)[number];

export interface UpstashCredentials {
  readonly url: string;
  readonly token: string;
}

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
}

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
  }

  return problems;
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
