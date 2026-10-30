import { defineConfig, devices } from "@playwright/test";

import {
  API_DOWN_WEB_URL,
  API_URL,
  apiDownWebEnvironment,
  apiEnvironment,
  ensureRunEnvironment,
  WEB_URL,
  webEnvironment,
} from "./support/env.js";

// Before anything reads the environment: database URL, this run's demo passwords, session secret.
ensureRunEnvironment();

const API_HEALTH_URL = `${API_URL}/api/v1/health`;
const isCI = Boolean(process.env.CI);

// A hosted deployment to check (T09): `BASE_URL=https://<web> npm run test:e2e -- --project=webkit`.
// Nothing is started and no database is prepared (the global setup would reset the E2E database, which
// does not exist there), only the tests tagged @smoke run, and the demo passwords are those of the
// hosted seed (E2E_DEMO_ADMIN_PASSWORD, E2E_DEMO_CUSTOMER_PASSWORD).
const remoteBaseUrl = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests",
  ...(remoteBaseUrl === undefined ? { globalSetup: "./global-setup.ts" } : { grep: /@smoke/ }),
  fullyParallel: true,
  // All workers share one `next dev` server, which compiles each route the first time it is
  // visited. Eight workers (the default on a big machine) made navigation assertions with the
  // default 5 s timeout fail at random; four keeps them reliable and the run well under five minutes.
  workers: remoteBaseUrl !== undefined ? 1 : isCI ? 2 : 4,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    // Tests talk to the web origin only; /api/v1/* reaches the API through the Next.js proxy.
    baseURL: remoteBaseUrl ?? WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Safari's cookie rules are the reason for the same-origin proxy (D-06); it is only run against a hosted URL.
    ...(remoteBaseUrl === undefined
      ? []
      : [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]),
  ],
  // Starts both servers from the repository root, configured for the E2E database, demo mode and
  // the log email transport. They are never reused: a server left over from `npm run dev` points at
  // a development database and has a different configuration, so stop it first (the run fails with
  // "port already used" if one is still listening).
  webServer:
    remoteBaseUrl !== undefined
      ? []
      : [
          {
            command: "npm run dev:server",
            cwd: "..",
            url: API_HEALTH_URL,
            reuseExistingServer: false,
            timeout: 60_000,
            env: apiEnvironment(),
          },
          {
            command: "npm run dev:web",
            cwd: "..",
            url: WEB_URL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: webEnvironment(),
          },
          // The web app again, with an API that is down: the public pages must still render (T08).
          {
            command: "npx next dev --port 3001",
            cwd: "../apps/web",
            url: API_DOWN_WEB_URL,
            reuseExistingServer: false,
            timeout: 120_000,
            env: apiDownWebEnvironment(),
          },
        ],
});
