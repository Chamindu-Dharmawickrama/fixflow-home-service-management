import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadDemoPasswords } from "../src/config/env.js";
import {
  assertDemoResetAllowed,
  DemoResetGuardError,
  resetDemoDatabase,
} from "../src/db/reset-demo.js";
import { ShowcaseError } from "../src/db/showcase/showcase.js";
import { formatDemoReport } from "../src/db/verify-demo.js";
import { createPrismaClient } from "../src/lib/db.js";

/**
 * `npm run db:reset-demo` — EMPTIES the database named by DATABASE_URL and loads the base seed and
 * the showcase again (T24). It refuses to run unless DEMO_MODE=true and CONFIRM_DEMO_RESET is exactly
 * the name of that database, and it prints the host and database name (never credentials) before it
 * acts. See docs/DEPLOYMENT.md for the reset procedure and the scheduled workflow.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();

  let allowed;
  let passwords;
  try {
    allowed = assertDemoResetAllowed();
    passwords = loadDemoPasswords();
  } catch (error) {
    if (error instanceof DemoResetGuardError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ConfigError) {
      console.error(error.message);
      console.error("\nThe reset loads the demo accounts, so it needs both demo passwords.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { target } = allowed;
  console.info(`Resetting the demo: emptying "${target.database}" on ${target.host} ...`);

  const prisma = createPrismaClient(allowed.url);
  try {
    const startedAt = Date.now();
    const { showcase, report } = await resetDemoDatabase(prisma, {
      expectedDatabase: target.database,
      passwords,
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) {
          console.info(`  ${done} of ${total} steps`);
        }
      },
    });
    console.info(
      [
        `Reset done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s:`,
        `  customers ${showcase.customers}, requests ${showcase.requests}, quotations ${showcase.quotations},`,
        `  jobs ${showcase.workOrders}, invoices ${showcase.invoices}, payments ${showcase.payments},`,
        `  notifications ${showcase.notifications}, history events ${showcase.activityEvents}`,
        "",
        formatDemoReport(report),
      ].join("\n"),
    );
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof DemoResetGuardError || error instanceof ShowcaseError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("The reset failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
