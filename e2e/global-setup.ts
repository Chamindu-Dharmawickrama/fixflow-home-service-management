import { mkdirSync, rmSync } from "node:fs";

import { prepareE2eDatabase } from "../apps/server/src/test/e2e-db.js";
import { API_DOWN_WEB_URL, credentials, OUTBOX_DIR, WEB_URL } from "./support/env.js";

/**
 * The public pages (T08), visited once, one after the other, on both web servers before any test
 * starts. `next dev` compiles a route the first time it is requested, and when several workers ask
 * for routes it has not compiled yet it sometimes reads a build manifest while another request is
 * still writing it, and answers with "Unexpected end of JSON input" (seen on `/privacy` and on a
 * service page). Compiling them up front removes that race without changing what the tests check.
 */
const WARM_UP_PATHS = [
  "/",
  "/services",
  "/services/ac-routine-maintenance",
  "/services/no-such-service",
  "/privacy",
  "/sitemap.xml",
  "/robots.txt",
] as const;

async function warmUpPublicPages(): Promise<void> {
  for (const origin of [WEB_URL, API_DOWN_WEB_URL]) {
    for (const path of WARM_UP_PATHS) {
      try {
        const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(60_000) });
        await response.arrayBuffer();
      } catch (error) {
        // A page that cannot be warmed up is not a reason to stop: its own tests will say what is wrong.
        console.warn(`Could not warm up ${origin}${path}: ${String(error)}`);
      }
    }
  }
}

/**
 * Runs once before the tests, after Playwright has started the API and the web app: creates the
 * dedicated E2E database if needed, applies the migrations, empties it, and loads the base seed
 * (settings, services, the demo accounts with this run's passwords). The database guard in
 * apps/server/src/test/db.ts refuses to touch anything but E2E_DATABASE_URL.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
  mkdirSync(OUTBOX_DIR, { recursive: true });

  const { created, seed } = await prepareE2eDatabase({
    admin: credentials.demoAdminPassword,
    customer: credentials.demoCustomerPassword,
  });
  console.info(
    `E2E database ready (${created ? "created" : "reset"}): ${seed.users.created} demo accounts, ${seed.services.created} services.`,
  );
  await warmUpPublicPages();
}
