import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadConfig, loadDemoPasswords } from "../src/config/env.js";
import { seedBaseData } from "../src/db/seed.js";
import { seedShowcase, ShowcaseError } from "../src/db/showcase/showcase.js";
import { formatDemoReport, verifyDemo } from "../src/db/verify-demo.js";
import { createPrismaClient } from "../src/lib/db.js";

/**
 * `npm run db:seed:demo` — loads the base seed and then the showcase dataset (T24) into the
 * database named by DATABASE_URL, then runs the invariant checker. It adds to an EMPTY business: if
 * requests already exist it stops and tells you to use `npm run db:reset-demo`, which empties the
 * database first (behind its own guard). The demo passwords come from DEMO_ADMIN_PASSWORD and
 * DEMO_CUSTOMER_PASSWORD; no password is in the source code.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();

  let passwords;
  let databaseUrl;
  try {
    passwords = loadDemoPasswords();
    databaseUrl = loadConfig().database.url;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      console.error(
        "\nSet the variables named above in apps/server/.env (see apps/server/.env.example).",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (databaseUrl === undefined) {
    console.error(
      "DATABASE_URL is not set. Point it at the database to seed (see apps/server/.env.example).",
    );
    process.exitCode = 1;
    return;
  }

  // Say which database is being written to, without its credentials.
  const target = new URL(databaseUrl);
  console.info(`Seeding the showcase into "${target.pathname.slice(1)}" on ${target.host}`);

  const prisma = createPrismaClient(databaseUrl);
  try {
    await seedBaseData(prisma, { passwords });
    const startedAt = Date.now();
    const summary = await seedShowcase(prisma, {
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) {
          console.info(`  ${done} of ${total} steps`);
        }
      },
    });
    console.info(
      [
        `Showcase loaded in ${((Date.now() - startedAt) / 1000).toFixed(1)} s:`,
        `  customers ${summary.customers}, requests ${summary.requests}, quotations ${summary.quotations},`,
        `  jobs ${summary.workOrders}, invoices ${summary.invoices}, payments ${summary.payments},`,
        `  notifications ${summary.notifications}, history events ${summary.activityEvents}`,
      ].join("\n"),
    );

    const report = await verifyDemo(prisma);
    console.info(`\n${formatDemoReport(report)}`);
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof ShowcaseError) {
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
  console.error("Seeding the showcase failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
