import { defineConfig, devices } from "@playwright/test";

import {
  API_URL,
  apiEnvironment,
  ensureRunEnvironment,
  WEB_URL,
  webEnvironment,
} from "./support/env.js";

/**
 * The documentation screenshots (T27): `npm run screenshots`. Six pictures of the real running
 * application on the showcase data, written to `docs/screenshots/` in the order of the portfolio plan.
 *
 * Two modes, the same script:
 *
 * - **Local (the default).** Starts the API and the web app exactly as the showcase suite does, on its own
 *   database (`fixflow_e2e_screenshots`, created if missing, emptied and reseeded on every run: the guard
 *   insists its name contains "e2e") with random demo passwords. Needs `npm run db:test:up` and free ports
 *   3000 and 4000, so stop `npm run dev` first.
 * - **Hosted.** `BASE_URL=https://<web> E2E_DEMO_ADMIN_PASSWORD=… E2E_DEMO_CUSTOMER_PASSWORD=… npm run screenshots`
 *   photographs a deployed demo (the published demo passwords, from the shell, never from a file). Nothing is
 *   started and no database is touched; reset the demo first so the data is the showcase.
 */
const remoteBaseUrl = process.env.BASE_URL;

if (remoteBaseUrl === undefined) {
  process.env.E2E_DATABASE_URL =
    process.env.E2E_SCREENSHOTS_DATABASE_URL ??
    "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_e2e_screenshots";
} else if (
  (process.env.E2E_DEMO_ADMIN_PASSWORD ?? "") === "" ||
  (process.env.E2E_DEMO_CUSTOMER_PASSWORD ?? "") === ""
) {
  // ensureRunEnvironment() would invent random passwords, which can never sign in to a deployed site.
  throw new Error(
    "BASE_URL is set, so E2E_DEMO_ADMIN_PASSWORD and E2E_DEMO_CUSTOMER_PASSWORD must be set to the demo's published passwords.",
  );
}

ensureRunEnvironment();

export default defineConfig({
  testDir: "./screenshots",
  ...(remoteBaseUrl === undefined ? { globalSetup: "./showcase/global-setup.ts" } : {}),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results-screenshots",
  use: { baseURL: remoteBaseUrl ?? WEB_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer:
    remoteBaseUrl !== undefined
      ? []
      : [
          {
            command: "npm run dev:server",
            cwd: "..",
            url: `${API_URL}/api/v1/health`,
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
