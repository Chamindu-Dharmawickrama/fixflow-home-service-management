import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { seedDemoNotifications } from "../src/db/demo-notifications.js";
import { createPrismaClient } from "../src/lib/db.js";

/**
 * `npm run demo:notifications -w @fixflow/server` — development only. Gives the seeded demo
 * customer and admin a few notifications (each marked "Demo data.") so the bell in the app can be
 * looked at before any workflow creates real ones. Safe to run repeatedly. Run `npm run db:seed`
 * first, so the demo accounts exist.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();

  let databaseUrl;
  let isProduction;
  try {
    const config = loadConfig();
    databaseUrl = config.database.url;
    isProduction = config.isProduction;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (isProduction) {
    console.error(
      "Demo notifications are a development tool. Refusing to run with NODE_ENV=production.",
    );
    process.exitCode = 1;
    return;
  }
  if (databaseUrl === undefined) {
    console.error(
      "DATABASE_URL is not set. Point it at the development database (see apps/server/.env.example).",
    );
    process.exitCode = 1;
    return;
  }

  // Say which database is being written to, without its credentials.
  const target = new URL(databaseUrl);
  console.info(`Adding demo notifications to "${target.pathname.slice(1)}" on ${target.host}`);

  const prisma = createPrismaClient(databaseUrl);
  try {
    const summary = await seedDemoNotifications(prisma);
    console.info(`  created: ${summary.created}, already present: ${summary.existing}`);
    if (summary.missingAccounts.length > 0) {
      console.error(
        `The demo accounts were not found (${summary.missingAccounts.join(", ")}). Run "npm run db:seed" first.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Adding demo notifications failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
