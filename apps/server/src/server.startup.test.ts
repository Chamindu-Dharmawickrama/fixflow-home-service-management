import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONFIG_VARIABLE_NAMES } from "./config/env.js";

const SERVER_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const TOKEN_VALUE = "tok-startup-test-must-never-be-printed";
const ORIGIN_VALUE = "origin-startup-test-must-never-be-printed";

interface StartResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the real `server.ts` entry point in a child process with exactly these variables set. */
function startServer(config: Record<string, string>): Promise<StartResult> {
  // Blank every variable the API reads, so a developer's shell or .env cannot change the result.
  const blanked = Object.fromEntries(CONFIG_VARIABLE_NAMES.map((name) => [name, ""]));

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: SERVER_DIRECTORY,
      env: { ...process.env, ...blanked, NODE_ENV: "production", ...config },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe("starting the API with an invalid configuration", () => {
  it("exits non-zero and names the missing variables without printing any value", async () => {
    // Production with nothing set except one (secret) token: WEB_ORIGIN and the Upstash URL are missing.
    const result = await startServer({ UPSTASH_REDIS_REST_TOKEN: TOKEN_VALUE });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid environment configuration");
    expect(result.stderr).toContain("WEB_ORIGIN");
    expect(result.stderr).toContain("UPSTASH_REDIS_REST_URL");
    expect(result.stderr).not.toContain(TOKEN_VALUE);
    expect(result.stdout).not.toContain(TOKEN_VALUE);
    expect(result.stdout).not.toContain("listening");
  }, 30_000);

  it("names an invalid variable without printing its value", async () => {
    const result = await startServer({ WEB_ORIGIN: ORIGIN_VALUE, PORT: "99999" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("WEB_ORIGIN");
    expect(result.stderr).toContain("PORT");
    expect(result.stderr).not.toContain(ORIGIN_VALUE);
    expect(result.stderr).not.toContain("99999");
  }, 30_000);
});
