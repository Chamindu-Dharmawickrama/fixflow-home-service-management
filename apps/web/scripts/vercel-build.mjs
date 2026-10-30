// The Vercel build (T09), run by `buildCommand` in vercel.json from the apps/web folder:
//   1. builds @fixflow/shared (the web app imports its compiled output),
//   2. wakes the API, then
//   3. runs `next build`.
//
// Step 2 matters on Render's free plan: a build made while the API is asleep bakes the "we can't show
// this right now" notice into the prerendered public pages until they are first visited (F-41). The
// wait is best effort: an API that never answers does not fail the build (the pages still build and
// recover on their first visit).
//
// This is a script because Vercel limits `buildCommand` to 256 characters.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const WEB_DIR = resolve(import.meta.dirname, "..");
const REPOSITORY_ROOT = resolve(WEB_DIR, "../..");
const ATTEMPTS = 6;
const ATTEMPT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 10_000;

function run(script, cwd) {
  const result = spawnSync("npm", ["run", script], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`"npm run ${script}" in ${cwd} failed (${result.status ?? result.signal}).`);
    process.exit(result.status ?? 1);
  }
}

async function wakeApi() {
  const base = process.env.API_INTERNAL_URL?.replace(/\/+$/, "");
  if (!base) {
    return;
  }
  const url = `${base}/api/v1/health`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      if (response.ok) {
        console.info(`The API answered (attempt ${attempt}).`);
        return;
      }
      console.info(`The API answered ${response.status} (attempt ${attempt}).`);
    } catch {
      console.info(`The API did not answer (attempt ${attempt} of ${ATTEMPTS}).`);
    }
    if (attempt < ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.info(
    "The API never answered; the public pages will show their retry message until they are first visited.",
  );
}

run("build:shared", REPOSITORY_ROOT);
await wakeApi();
run("build", WEB_DIR);
