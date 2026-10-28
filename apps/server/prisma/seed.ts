import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadConfig, loadDemoPasswords } from "../src/config/env.js";
import { seedBaseData } from "../src/db/seed.js";
import { createPrismaClient } from "../src/lib/db.js";

/**
 * `npm run db:seed` — loads the base demo data into the database named by DATABASE_URL. Safe to
 * run repeatedly (see `seedBaseData`). The demo account passwords must be supplied through
 * DEMO_ADMIN_PASSWORD and DEMO_CUSTOMER_PASSWORD; no password is stored in the source code.
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
        "\nThe seed cannot run without them. Set the variables named above in apps/server/.env (see apps/server/.env.example).",
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
  console.info(`Seeding "${target.pathname.slice(1)}" on ${target.host}`);

  const prisma = createPrismaClient(databaseUrl);
  try {
    const summary = await seedBaseData(prisma, { passwords });
    console.info(
      [
        `  settings:    ${summary.settings}`,
        `  services:    ${summary.services.created} created, ${summary.services.existing} already present`,
        `  users:       ${summary.users.created} created, ${summary.users.existing} already present, ${summary.users.passwordsUpdated} password(s) updated`,
        `  addresses:   ${summary.addresses.created} created, ${summary.addresses.existing} already present`,
        `  technicians: ${summary.technicians.created} created, ${summary.technicians.existing} already present`,
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
