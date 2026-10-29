import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../lib/db.js";
import {
  databaseName,
  disconnectTestPrisma,
  getTestPrisma,
  resetDatabase,
  TestDatabaseGuardError,
} from "./db.js";
import { createFullScenario } from "./fixtures.js";

const prisma = getTestPrisma();

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("resetDatabase", () => {
  it("empties every table but keeps Prisma's migration history", async () => {
    await createFullScenario(prisma);
    await prisma.referenceCounter.create({ data: { type: "REQUEST", year: 2026, value: 3 } });
    const migrations = await prisma.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM _prisma_migrations`;

    await resetDatabase(prisma);

    for (const model of [
      prisma.user,
      prisma.customerProfile,
      prisma.serviceRequest,
      prisma.quotation,
      prisma.workOrder,
      prisma.invoice,
      prisma.referenceCounter,
    ]) {
      expect(await (model as { count: () => Promise<number> }).count()).toBe(0);
    }
    const after = await prisma.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM _prisma_migrations`;
    expect(after[0]?.n).toBe(migrations[0]?.n);
    expect(after[0]?.n).toBeGreaterThanOrEqual(2);
  });

  it("refuses to touch a client that is connected to a different database", async () => {
    // The server's maintenance database exists everywhere PostgreSQL runs. It is never modified:
    // the live-connection check refuses before any statement that changes data.
    const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
    testUrl.pathname = "/postgres";
    expect(databaseName("test", testUrl.toString())).not.toBe(
      databaseName("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL ?? ""),
    );
    const elsewhere = createPrismaClient(testUrl.toString());
    try {
      await expect(resetDatabase(elsewhere)).rejects.toThrow(TestDatabaseGuardError);
      await expect(resetDatabase(elsewhere)).rejects.toThrow(/different database/);
    } finally {
      await elsewhere.$disconnect();
    }
  });

  it("will not empty the integration-test database on behalf of the Playwright variable", async () => {
    // E2E_DATABASE_URL is not set here, and even if it were, it would have to name this database.
    await createFullScenario(prisma);

    await expect(resetDatabase(prisma, "E2E_DATABASE_URL")).rejects.toThrow(TestDatabaseGuardError);

    expect(await prisma.user.count()).toBeGreaterThan(0);
    await resetDatabase(prisma);
  });
});
