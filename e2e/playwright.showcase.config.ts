import { defineConfig, devices } from "@playwright/test";

import {
  API_URL,
  apiEnvironment,
  ensureRunEnvironment,
  WEB_URL,
  webEnvironment,
} from "./support/env.js";

/**
 * The showcase suite (T24): a handful of read-only checks of the application running on the seeded
 * showcase data (dashboard figures, the calendar, Alex's portal), plus the pictures of every screen.
 *
 * It has its own configuration and its own database because the main suite shares one database with
 * dozens of specs that count and plant rows, which a seeded business (with its requests, jobs and
 * invoices) would upset. This one starts the same API and web app on the same ports, so run it after
 * the main suite, never at the same time (`npm run test:e2e` does that). The database is
 * `fixflow_e2e_showcase` unless `E2E_SHOWCASE_DATABASE_URL` says otherwise; the guard insists its
 * name contains "e2e", and it is emptied and reseeded on every run.
 */
process.env.E2E_DATABASE_URL =
  process.env.E2E_SHOWCASE_DATABASE_URL ??
  "postgresql://fixflow_test:fixflow_test@localhost:5433/fixflow_e2e_showcase";

// Nothing in the support module reads the environment until a function is called, so setting the
// database above, before this call, is enough.
ensureRunEnvironment();

export default defineConfig({
  testDir: "./showcase",
  globalSetup: "./showcase/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-showcase" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report-showcase" }]],
  outputDir: "test-results-showcase",
  use: { baseURL: WEB_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
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
