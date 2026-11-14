import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { formatDemoReport, verifyDemo } from "../src/db/verify-demo.js";
import { createPrismaClient } from "../src/lib/db.js";

/**
 * `npm run db:verify-demo` — checks the showcase data in the database named by DATABASE_URL against
 * the invariants of spec §19.3 and exits non-zero, listing each violation, if any fails. It only
 * reads. If it fails, fix the seed (apps/server/src/db/showcase), never the checker.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();

  let databaseUrl;
  try {
    databaseUrl = loadConfig().database.url;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (databaseUrl === undefined) {
    console.error(
      "DATABASE_URL is not set. Point it at the database to check (see apps/server/.env.example).",
    );
    process.exitCode = 1;
    return;
  }

  const target = new URL(databaseUrl);
  console.info(`Checking "${target.pathname.slice(1)}" on ${target.host}\n`);

  const prisma = createPrismaClient(databaseUrl);
  try {
    const report = await verifyDemo(prisma);
    console.info(formatDemoReport(report));
    if (!report.ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("The check could not run:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
