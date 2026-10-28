import { defineConfig } from "prisma/config";

import { loadLocalEnvFile } from "./src/config/dotenv.js";

// Prisma 7 no longer loads `.env` itself. Load the same local file the API uses (development only,
// never overriding variables that are already set, so CI and the test setup can inject their own).
loadLocalEnvFile();

/**
 * The URL the Prisma CLI (migrate, db push, studio) connects to. Migrations need a DIRECT
 * connection: Neon's pooled endpoint runs PgBouncer in transaction mode, which cannot run them.
 * With a single local database there is no pooler, so DATABASE_URL is an acceptable fallback.
 * The running API never reads this: it connects through DATABASE_URL (see src/lib/db.ts).
 */
const migrationUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // `prisma generate` needs no database, so a missing URL only fails the commands that connect.
  ...(migrationUrl !== undefined && migrationUrl !== "" && { datasource: { url: migrationUrl } }),
});
