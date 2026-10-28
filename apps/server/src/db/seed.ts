import type { DemoPasswords } from "../config/env.js";
import { type Clock, systemClock } from "../lib/clock.js";
import { BUSINESS_SETTINGS_ID, type PrismaClient } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  DEMO_ACCOUNTS,
  DEMO_SERVICES,
  DEMO_SETTINGS,
  DEMO_TECHNICIANS,
  type DemoAccount,
} from "./seed-data.js";

export interface SeedOptions {
  passwords: DemoPasswords;
  clock?: Clock;
}

/** What one run did, so the CLI and the tests can report it. */
export interface SeedSummary {
  settings: "created" | "existing";
  services: { created: number; existing: number };
  users: { created: number; existing: number; passwordsUpdated: number };
  addresses: { created: number; existing: number };
  technicians: { created: number; existing: number };
}

function passwordFor(account: DemoAccount, passwords: DemoPasswords): string {
  return account.passwordVariable === "DEMO_ADMIN_PASSWORD" ? passwords.admin : passwords.customer;
}

/**
 * Loads the base demo data: business settings, the five services, the three demo accounts (with
 * customer profiles and one address each) and three technicians. It can run any number of times:
 * every record is looked up by its natural key (the settings id, the service slug, the user's
 * email, the address label, the technician's name) and created only if it is missing.
 *
 * Existing rows are never overwritten, so edits made in the admin screens survive a re-run. The
 * one exception is a demo account's password: if the stored hash does not verify against the
 * password from the environment, it is replaced, so changing `DEMO_*_PASSWORD` and re-seeding
 * rotates the credential. The seed does not hash a password that already verifies.
 *
 * The full showcase dataset (requests, quotations, jobs, invoices) is a later task.
 */
export async function seedBaseData(
  prisma: PrismaClient,
  options: SeedOptions,
): Promise<SeedSummary> {
  const clock = options.clock ?? systemClock;
  const summary: SeedSummary = {
    settings: "existing",
    services: { created: 0, existing: 0 },
    users: { created: 0, existing: 0, passwordsUpdated: 0 },
    addresses: { created: 0, existing: 0 },
    technicians: { created: 0, existing: 0 },
  };

  // Business settings: one fixed row.
  const settings = await prisma.businessSettings.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
  });
  if (settings === null) {
    await prisma.businessSettings.create({ data: { id: BUSINESS_SETTINGS_ID, ...DEMO_SETTINGS } });
    summary.settings = "created";
  }

  // Services, by slug.
  for (const service of DEMO_SERVICES) {
    const existing = await prisma.service.findUnique({
      where: { slug: service.slug },
      select: { id: true },
    });
    if (existing === null) {
      await prisma.service.create({ data: service });
      summary.services.created += 1;
    } else {
      summary.services.existing += 1;
    }
  }

  // Demo accounts, by normalized email.
  for (const account of DEMO_ACCOUNTS) {
    const password = passwordFor(account, options.passwords);
    const existing = await prisma.user.findUnique({ where: { email: account.email } });

    let userId: string;
    if (existing === null) {
      const now = clock.now();
      const user = await prisma.user.create({
        data: {
          email: account.email,
          name: account.name,
          role: account.role,
          passwordHash: await hashPassword(password),
          emailVerifiedAt: now,
          termsAcceptedAt: now,
        },
      });
      userId = user.id;
      summary.users.created += 1;
    } else {
      userId = existing.id;
      summary.users.existing += 1;
      const stillValid =
        existing.passwordHash !== null && (await verifyPassword(password, existing.passwordHash));
      if (!stillValid) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash: await hashPassword(password) },
        });
        summary.users.passwordsUpdated += 1;
      }
    }

    if (account.role !== "CUSTOMER") {
      continue;
    }

    // Customers get a profile and one default address.
    const profile =
      (await prisma.customerProfile.findUnique({ where: { userId } })) ??
      (await prisma.customerProfile.create({
        data: { userId, ...(account.phone !== undefined && { phone: account.phone }) },
      }));

    const { address } = account;
    if (address !== undefined) {
      const existingAddress = await prisma.serviceAddress.findFirst({
        where: { customerId: profile.id, label: address.label },
        select: { id: true },
      });
      if (existingAddress === null) {
        await prisma.serviceAddress.create({
          data: {
            customerId: profile.id,
            label: address.label,
            line1: address.line1,
            ...(address.line2 !== undefined && { line2: address.line2 }),
            city: address.city,
            region: address.region,
            postalCode: address.postalCode,
            ...(address.accessNotes !== undefined && { accessNotes: address.accessNotes }),
            isDefault: true,
          },
        });
        summary.addresses.created += 1;
      } else {
        summary.addresses.existing += 1;
      }
    }
  }

  // Technicians, by name.
  for (const technician of DEMO_TECHNICIANS) {
    const existing = await prisma.technician.findFirst({
      where: { name: technician.name },
      select: { id: true },
    });
    if (existing === null) {
      await prisma.technician.create({ data: technician });
      summary.technicians.created += 1;
    } else {
      summary.technicians.existing += 1;
    }
  }

  return summary;
}
