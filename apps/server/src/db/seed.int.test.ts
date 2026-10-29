import { isBundledLogoKey, isBundledServiceImageKey } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { FakeClock } from "../lib/clock.js";
import { BUSINESS_SETTINGS_ID } from "../lib/db.js";
import { verifyPassword } from "../lib/password.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../test/db.js";
import { seedBaseData } from "./seed.js";
import { DEMO_ACCOUNTS, DEMO_LOGO_KEY, DEMO_SERVICES, DEMO_TECHNICIANS } from "./seed-data.js";

const prisma = getTestPrisma();

const PASSWORDS = { admin: "test-admin-password-1", customer: "test-customer-password-1" };
const clock = new FakeClock("2026-03-02T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function counts() {
  return {
    settings: await prisma.businessSettings.count(),
    services: await prisma.service.count(),
    users: await prisma.user.count(),
    profiles: await prisma.customerProfile.count(),
    addresses: await prisma.serviceAddress.count(),
    technicians: await prisma.technician.count(),
  };
}

describe("seedBaseData", () => {
  it("creates the settings, 5 services, 3 accounts with profiles and addresses, and 3 technicians", async () => {
    const summary = await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    expect(await counts()).toEqual({
      settings: 1,
      services: 5,
      users: 3,
      profiles: 2,
      addresses: 2,
      technicians: 3,
    });
    expect(summary).toEqual({
      settings: "created",
      services: { created: 5, existing: 0 },
      users: { created: 3, existing: 0, passwordsUpdated: 0 },
      addresses: { created: 2, existing: 0 },
      technicians: { created: 3, existing: 0 },
    });
  });

  it("can run any number of times without creating duplicates or changing anything", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });
    const firstCounts = await counts();
    const firstHashes = (await prisma.user.findMany({ orderBy: { email: "asc" } })).map(
      (user) => user.passwordHash,
    );

    const second = await seedBaseData(prisma, { passwords: PASSWORDS, clock });
    const third = await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    expect(await counts()).toEqual(firstCounts);
    for (const summary of [second, third]) {
      expect(summary).toEqual({
        settings: "existing",
        services: { created: 0, existing: 5 },
        users: { created: 0, existing: 3, passwordsUpdated: 0 },
        addresses: { created: 0, existing: 2 },
        technicians: { created: 0, existing: 3 },
      });
    }
    // A password that still verifies is not re-hashed, so the rows are byte-for-byte unchanged.
    const hashesAfter = (await prisma.user.findMany({ orderBy: { email: "asc" } })).map(
      (user) => user.passwordHash,
    );
    expect(hashesAfter).toEqual(firstHashes);
  });

  it("sets up the documented demo accounts (D-09) as ordinary local-password users", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.fixflow.test" },
    });
    const alex = await prisma.user.findUniqueOrThrow({
      where: { email: "alex.morgan@example.test" },
    });
    const priya = await prisma.user.findUniqueOrThrow({
      where: { email: "priya.shah@example.test" },
    });

    expect(admin).toMatchObject({
      name: "Morgan Reyes",
      role: "BUSINESS_ADMIN",
      isActive: true,
      googleSubject: null,
    });
    expect(alex).toMatchObject({
      name: "Alex Morgan",
      role: "CUSTOMER",
      isActive: true,
      googleSubject: null,
    });
    expect(priya).toMatchObject({ name: "Priya Shah", role: "CUSTOMER", isActive: true });
    expect(admin.emailVerifiedAt?.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(admin.termsAcceptedAt?.toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });

  it("stores Argon2id hashes that verify with the supplied passwords and nothing else", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const users = await prisma.user.findMany();
    for (const user of users) {
      const expected = user.role === "BUSINESS_ADMIN" ? PASSWORDS.admin : PASSWORDS.customer;
      const other = user.role === "BUSINESS_ADMIN" ? PASSWORDS.customer : PASSWORDS.admin;
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(expected);
      expect(await verifyPassword(expected, user.passwordHash ?? "")).toBe(true);
      expect(await verifyPassword(other, user.passwordHash ?? "")).toBe(false);
    }
  });

  it("gives each customer a profile with a phone and one default address", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const profiles = await prisma.customerProfile.findMany({
      include: { user: true, addresses: true },
      orderBy: { user: { email: "asc" } },
    });

    expect(profiles.map((profile) => profile.user.email)).toEqual([
      "alex.morgan@example.test",
      "priya.shah@example.test",
    ]);
    for (const profile of profiles) {
      expect(profile.phone).toMatch(/^\(212\) 555-01\d\d$/);
      expect(profile.addresses).toHaveLength(1);
      expect(profile.addresses[0]?.isDefault).toBe(true);
    }
  });

  it("creates the business settings singleton with the D-47 defaults", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: BUSINESS_SETTINGS_ID },
    });

    expect(settings).toMatchObject({
      businessName: "CoolBreeze Home Services",
      currencyCode: "USD",
      timeZone: "America/New_York",
      quotationValidityDays: 14,
      invoiceDueDays: 14,
    });
    expect(settings.defaultTaxRate.toFixed(2)).toBe("8.00");
  });

  it("creates the five services of the specification with realistic copy", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const services = await prisma.service.findMany({ orderBy: { sortOrder: "asc" } });

    expect(services.map((service) => [service.name, service.pricingMode])).toEqual([
      ["AC Diagnostic Visit", "QUOTE_REQUIRED"],
      ["AC Routine Maintenance", "FIXED"],
      ["Washing Machine Repair", "QUOTE_REQUIRED"],
      ["Electrical Safety Inspection", "QUOTE_REQUIRED"],
      ["Home Deep Cleaning", "FIXED"],
    ]);
    for (const service of services) {
      expect(service.isPublished).toBe(true);
      expect(service.archivedAt).toBeNull();
      expect(service.inclusions.length).toBeGreaterThanOrEqual(3);
      expect(service.shortDescription.length).toBeGreaterThan(40);
      expect(service.fullDescription.length).toBeGreaterThan(150);
      expect(service.estimatedDurationMinutes).toBeGreaterThan(0);
      expect(service.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      if (service.pricingMode === "FIXED") {
        expect(Number(service.startingPrice)).toBeGreaterThan(0);
      } else {
        expect(service.startingPrice).toBeNull();
      }
    }
  });

  it("creates three technicians including Jordan Lee", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const technicians = await prisma.technician.findMany({ orderBy: { name: "asc" } });

    expect(technicians.map((technician) => technician.name)).toEqual([
      "Jordan Lee",
      "Sam Okafor",
      "Taylor Brooks",
    ]);
    for (const technician of technicians) {
      expect(technician.isActive).toBe(true);
      expect(technician.specialties.length).toBeGreaterThan(0);
    }
  });

  it("does not overwrite edits made after seeding", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });
    await prisma.service.update({
      where: { slug: "home-deep-cleaning" },
      data: { name: "Deep Clean (edited)", isPublished: false },
    });
    await prisma.businessSettings.update({
      where: { id: BUSINESS_SETTINGS_ID },
      data: { tagline: "Edited tagline" },
    });
    await prisma.technician.update({
      where: {
        id: (await prisma.technician.findFirstOrThrow({ where: { name: "Jordan Lee" } })).id,
      },
      data: { isActive: false },
    });

    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    expect(
      await prisma.service.findUniqueOrThrow({ where: { slug: "home-deep-cleaning" } }),
    ).toMatchObject({
      name: "Deep Clean (edited)",
      isPublished: false,
    });
    expect(
      (await prisma.businessSettings.findUniqueOrThrow({ where: { id: BUSINESS_SETTINGS_ID } }))
        .tagline,
    ).toBe("Edited tagline");
    expect(
      (await prisma.technician.findFirstOrThrow({ where: { name: "Jordan Lee" } })).isActive,
    ).toBe(false);
    expect(await counts()).toMatchObject({ services: 5, technicians: 3 });
  });

  it("rotates a demo password when the environment value changes", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });
    const rotated = { admin: "a-new-admin-password-2", customer: PASSWORDS.customer };

    const summary = await seedBaseData(prisma, { passwords: rotated, clock });

    expect(summary.users).toEqual({ created: 0, existing: 3, passwordsUpdated: 1 });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@demo.fixflow.test" },
    });
    expect(await verifyPassword(rotated.admin, admin.passwordHash ?? "")).toBe(true);
    expect(await verifyPassword(PASSWORDS.admin, admin.passwordHash ?? "")).toBe(false);
  });

  it("repairs a partly seeded database instead of failing or duplicating", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });
    await prisma.technician.deleteMany({ where: { name: "Sam Okafor" } });
    await prisma.serviceAddress.deleteMany();

    const summary = await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    expect(summary.technicians).toEqual({ created: 1, existing: 2 });
    expect(summary.addresses).toEqual({ created: 2, existing: 0 });
    expect(await counts()).toMatchObject({ technicians: 3, addresses: 2 });
  });

  it("uses only fictional data: reserved .test domains and 555-01xx phone numbers", async () => {
    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    for (const user of await prisma.user.findMany()) {
      expect(user.email).toMatch(/@[a-z.]*\.?(test)$/);
    }
    const everything = JSON.stringify([
      await prisma.businessSettings.findMany(),
      await prisma.technician.findMany(),
      await prisma.customerProfile.findMany(),
      await prisma.service.findMany(),
    ]);
    expect(everything).not.toMatch(/lorem|ipsum/i);
    for (const phone of everything.match(/\(\d{3}\) \d{3}-\d{4}/g) ?? []) {
      expect(phone).toMatch(/^\(\d{3}\) 555-01\d\d$/);
    }
    for (const email of everything.match(/[\w.]+@[\w.]+/g) ?? []) {
      expect(email).toMatch(/\.test$/);
    }
  });
});

describe("seed data definitions", () => {
  it("gives the demo business a bundled logo and every service a bundled picture (D-30)", async () => {
    for (const service of DEMO_SERVICES) {
      expect(isBundledServiceImageKey(service.imageKey), service.slug).toBe(true);
    }
    expect(isBundledLogoKey(DEMO_LOGO_KEY)).toBe(true);

    await seedBaseData(prisma, { passwords: PASSWORDS, clock });

    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: BUSINESS_SETTINGS_ID },
    });
    expect(settings).toMatchObject({ logoKey: DEMO_LOGO_KEY, logoUrl: null });
    const services = await prisma.service.findMany({ select: { imageKey: true, imageUrl: true } });
    expect(services).toHaveLength(5);
    for (const service of services) {
      expect(isBundledServiceImageKey(service.imageKey)).toBe(true);
      expect(service.imageUrl).toBeNull();
    }
  });

  it("lists distinct natural keys, so the lookups cannot collide", () => {
    expect(new Set(DEMO_SERVICES.map((service) => service.slug)).size).toBe(DEMO_SERVICES.length);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.email)).size).toBe(DEMO_ACCOUNTS.length);
    expect(new Set(DEMO_TECHNICIANS.map((technician) => technician.name)).size).toBe(
      DEMO_TECHNICIANS.length,
    );
  });
});
