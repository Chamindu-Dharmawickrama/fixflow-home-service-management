import { mkdirSync, rmSync } from "node:fs";

import { resetDemoDatabase } from "../../apps/server/src/db/reset-demo.js";
import { formatDemoReport } from "../../apps/server/src/db/verify-demo.js";
import { databaseName } from "../../apps/server/src/test/db.js";
import {
  createE2ePrisma,
  e2eDatabaseUrl,
  ensureE2eDatabase,
  migrateE2eDatabase,
} from "../../apps/server/src/test/e2e-db.js";
import { credentials, OUTBOX_DIR, WEB_URL } from "../support/env.js";

/**
 * Runs once before the showcase specs, after the API and the web app have started: creates the
 * showcase database if it is missing, applies the migrations, empties it, and loads the base seed and
 * the showcase (with this run's demo passwords), then runs the invariant checker. The same guard as
 * the main suite applies: only a database named by E2E_DATABASE_URL, with "e2e" in its name.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
  mkdirSync(OUTBOX_DIR, { recursive: true });

  const created = await ensureE2eDatabase();
  migrateE2eDatabase();

  const prisma = createE2ePrisma();
  try {
    const { showcase, report } = await resetDemoDatabase(prisma, {
      expectedDatabase: databaseName("E2E_DATABASE_URL", e2eDatabaseUrl()),
      passwords: {
        admin: credentials.demoAdminPassword,
        customer: credentials.demoCustomerPassword,
      },
    });
    console.info(
      `Showcase database ready (${created ? "created" : "reset"}): ${showcase.requests} requests, ${showcase.workOrders} jobs, ${showcase.invoices} invoices.`,
    );
    if (!report.ok) {
      throw new Error(`The showcase data failed its own checks:\n${formatDemoReport(report)}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  // Compile the first pages once, one after the other, so the workers do not race `next dev`.
  for (const path of ["/login", "/privacy", "/request-service"]) {
    try {
      const response = await fetch(`${WEB_URL}${path}`, { signal: AbortSignal.timeout(60_000) });
      await response.arrayBuffer();
    } catch (error) {
      console.warn(`Could not warm up ${path}: ${String(error)}`);
    }
  }
}
