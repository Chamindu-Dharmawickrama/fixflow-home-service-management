import { defineConfig, devices } from "@playwright/test";

import {
  API_URL,
  apiEnvironment,
  ensureRunEnvironment,
  WEB_URL,
  webEnvironment,
} from "./support/env.js";

// Before anything reads the environment: database URL, this run's demo passwords, session secret.
ensureRunEnvironment();

const API_HEALTH_URL = `${API_URL}/api/v1/health`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  // All workers share one `next dev` server, which compiles each route the first time it is
  // visited. Eight workers (the default on a big machine) made navigation assertions with the
  // default 5 s timeout fail at random; four keeps them reliable and the run well under five minutes.
  workers: isCI ? 2 : 4,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    // Tests talk to the web origin only; /api/v1/* reaches the API through the Next.js proxy.
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Starts both servers from the repository root, configured for the E2E database, demo mode and
  // the log email transport. They are never reused: a server left over from `npm run dev` points at
  // a development database and has a different configuration, so stop it first (the run fails with
  // "port already used" if one is still listening).
  webServer: [
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
  ],
});
