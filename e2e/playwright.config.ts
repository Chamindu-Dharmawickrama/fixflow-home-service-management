import { defineConfig, devices } from "@playwright/test";

const WEB_URL = "http://localhost:3000";
const API_HEALTH_URL = "http://localhost:4000/api/v1/health";
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
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
  // Starts both servers from the repository root, or reuses ones already running locally
  // (for example from `npm run dev`).
  webServer: [
    {
      command: "npm run dev:server",
      cwd: "..",
      url: API_HEALTH_URL,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: "npm run dev:web",
      cwd: "..",
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
