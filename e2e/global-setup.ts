import { mkdirSync, rmSync } from "node:fs";

import { prepareE2eDatabase } from "../apps/server/src/test/e2e-db.js";
import { credentials, OUTBOX_DIR } from "./support/env.js";

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
}
