import { isSafeAppPath } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../test/db.js";
import { seedDemoNotifications } from "./demo-notifications.js";
import { seedBaseData } from "./seed.js";

const prisma = getTestPrisma();
const PASSWORDS = { admin: "test-admin-password-1", customer: "test-customer-password-1" };

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("seedDemoNotifications (development only)", () => {
  it("gives the demo customer and the demo admin a few notifications, and nobody else", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS });

    const summary = await seedDemoNotifications(prisma);

    expect(summary).toEqual({ created: 5, existing: 0, missingAccounts: [] });
    const rows = await prisma.notification.findMany({ include: { recipient: true } });
    const byRecipient = (email: string) => rows.filter((row) => row.recipient.email === email);
    expect(byRecipient("alex.morgan@example.test")).toHaveLength(3);
    expect(byRecipient("admin@demo.fixflow.test")).toHaveLength(2);
    // The second demo customer keeps an empty bell.
    expect(byRecipient("priya.shah@example.test")).toHaveLength(0);
    expect(rows.every((row) => row.readAt === null)).toBe(true);
  });

  it("labels every one as demo data and links only to pages inside the app", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS });
    await seedDemoNotifications(prisma);

    const rows = await prisma.notification.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.message).toMatch(/Demo data\.$/);
      expect(isSafeAppPath(row.linkPath)).toBe(true);
    }
  });

  it("can be run again without duplicating anything", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS });
    await seedDemoNotifications(prisma);

    const second = await seedDemoNotifications(prisma);

    expect(second).toEqual({ created: 0, existing: 5, missingAccounts: [] });
    expect(await prisma.notification.count()).toBe(5);
  });

  it("says which accounts are missing, and creates nothing, before the base seed has run", async () => {
    const summary = await seedDemoNotifications(prisma);

    expect(summary.created).toBe(0);
    expect(summary.missingAccounts.sort()).toEqual([
      "admin@demo.fixflow.test",
      "alex.morgan@example.test",
    ]);
    expect(await prisma.notification.count()).toBe(0);
  });
});
