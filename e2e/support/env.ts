import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

/**
 * Everything about the E2E environment in one place, shared by the Playwright config (which
 * starts the servers), the global setup (which prepares the database) and the tests.
 *
 * The suite never touches a development database: it has its own (`fixflow_e2e`), its own API
 * on the usual ports, and its own demo passwords, generated fresh for each run so that no
 * password is written anywhere in the repository.
 */

export const WEB_URL = "http://localhost:3000";
export const API_URL = "http://localhost:4000";
/** A second web server whose API cannot be reached, for the public-site fallback checks (T08). */
export const API_DOWN_WEB_URL = "http://localhost:3001";
/**
 * The pass-through proxy between the main web server and the API (T25, `support/fault-proxy.ts`): a
 * test can make its own session's requests fail there, including the web server's own reads.
 */
export const FAULT_PROXY_URL = "http://localhost:4100";
/** Nothing listens on the discard port, so a request to it is refused at once. */
const UNREACHABLE_API_URL = "http://127.0.0.1:9";

/** The dedicated database. Overridable with `E2E_DATABASE_URL`; the guard insists its name has "e2e". */
const DEFAULT_E2E_DATABASE_URL =
  "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_e2e";

/** Where the API's log email transport writes during the run (emails to `.test` addresses are always logged). */
export const OUTBOX_DIR = resolve(import.meta.dirname, "../../.data/e2e-outbox");

/** The demo business owner is on the allowlist (D-08); so is a second admin the suite creates itself. */
export const DEMO_ADMIN_EMAIL = "admin@demo.fixflow.test";
export const E2E_SECOND_ADMIN_EMAIL = "e2e.admin@coolbreeze.test";
/**
 * An admin who is NOT one of the shared demo accounts, for the specs that change the business identity.
 * In demo mode the shared demo admin cannot (T24, Q-11), but this one is an ordinary admin on the allowlist.
 */
export const E2E_SETTINGS_ADMIN_EMAIL = "e2e.settings.admin@coolbreeze.test";

/** A fake client ID: enough for the Google button container to render. No real sign-in happens. */
const FAKE_GOOGLE_CLIENT_ID = "000000000000-e2etestclientid.apps.googleusercontent.com";

function randomPassphrase(): string {
  return `E2e-${randomBytes(12).toString("base64url")}-9`;
}

/**
 * Fills in the variables that must exist before the servers start and tests run. Idempotent: the
 * Playwright runner calls it first, and the worker processes it spawns inherit the result, so every
 * process sees the same passwords.
 */
export function ensureRunEnvironment(): void {
  process.env.E2E_DATABASE_URL ??= DEFAULT_E2E_DATABASE_URL;
  process.env.E2E_DEMO_ADMIN_PASSWORD ??= randomPassphrase();
  process.env.E2E_DEMO_CUSTOMER_PASSWORD ??= randomPassphrase();
  process.env.E2E_SESSION_SECRET ??= randomBytes(32).toString("hex");
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set; ensureRunEnvironment() has not run.`);
  }
  return value;
}

export const credentials = {
  get demoAdminPassword(): string {
    return required("E2E_DEMO_ADMIN_PASSWORD");
  },
  get demoCustomerPassword(): string {
    return required("E2E_DEMO_CUSTOMER_PASSWORD");
  },
};

/** The API's environment: the E2E database, demo mode, the log email transport and relaxed rate limits. */
export function apiEnvironment(): Record<string, string> {
  const databaseUrl = required("E2E_DATABASE_URL");
  return {
    NODE_ENV: "development",
    PORT: "4000",
    WEB_ORIGIN: WEB_URL,
    PUBLIC_WEB_URL: WEB_URL,
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: databaseUrl,
    // The rest of the real environment must not leak in from a developer's apps/server/.env.
    TEST_DATABASE_URL: "",
    SESSION_SECRET: required("E2E_SESSION_SECRET"),
    ADMIN_EMAILS: `${DEMO_ADMIN_EMAIL},${E2E_SECOND_ADMIN_EMAIL},${E2E_SETTINGS_ADMIN_EMAIL}`,
    DEMO_MODE: "true",
    PUBLIC_SIGNUP_ENABLED: "true",
    EMAIL_TRANSPORT: "log",
    EMAIL_OUTBOX_DIR: OUTBOX_DIR,
    GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID,
    // Memory limiter (never a developer's Upstash database) with limits far above what a run needs.
    RATE_LIMIT_DRIVER: "memory",
    RATE_LIMIT_MULTIPLIER: "1000",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    DEMO_ADMIN_PASSWORD: credentials.demoAdminPassword,
    DEMO_CUSTOMER_PASSWORD: credentials.demoCustomerPassword,
    LOG_LEVEL: "warn",
  };
}

/**
 * The web app's environment: it talks to the E2E API and shows the demo panel. The main suite's web
 * server reaches the API through the fault proxy (`apiUrl: FAULT_PROXY_URL`); the showcase suite's
 * goes to the API directly.
 */
export function webEnvironment(options: { apiUrl?: string } = {}): Record<string, string> {
  return {
    API_INTERNAL_URL: options.apiUrl ?? API_URL,
    // The public pages refresh what they read from the API after this many seconds (60 by default),
    // so the specs can see a change without a minute's wait.
    PUBLIC_REVALIDATE_SECONDS: "2",
    // Canonical links and the sitemap are built from this address.
    SITE_URL: WEB_URL,
    NEXT_PUBLIC_DEMO_MODE: "true",
    NEXT_PUBLIC_DEMO_ADMIN_PASSWORD: credentials.demoAdminPassword,
    NEXT_PUBLIC_DEMO_CUSTOMER_PASSWORD: credentials.demoCustomerPassword,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID,
  };
}

/** The same web app pointed at an API that is down, in its own build folder so the two dev servers do not collide. */
export function apiDownWebEnvironment(): Record<string, string> {
  return {
    ...webEnvironment(),
    API_INTERNAL_URL: UNREACHABLE_API_URL,
    NEXT_DIST_DIR: ".next-api-down",
    SITE_URL: API_DOWN_WEB_URL,
    // Not the portfolio demo: no banner, and the pages may be indexed (the other server is the demo).
    NEXT_PUBLIC_DEMO_MODE: "false",
  };
}
