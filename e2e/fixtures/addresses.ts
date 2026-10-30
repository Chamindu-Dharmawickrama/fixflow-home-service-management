import { withDatabase } from "./accounts.js";

/**
 * Customer-profile scenarios for the E2E suite: rows inserted straight into the E2E database and
 * read back from it, as the rest of the fixtures are (CLAUDE.md §11). There is no test-only endpoint
 * in the product. The tests change only the accounts they create, never the shared demo customers.
 */

export interface FixtureAddress {
  label: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  accessNotes?: string;
  isDefault?: boolean;
}

export interface StoredAddress {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  accessNotes: string | null;
  isDefault: boolean;
}

async function profileIdOf(
  prisma: Parameters<Parameters<typeof withDatabase>[0]>[0],
  userId: string,
) {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { userId },
    select: { id: true },
  });
  return profile.id;
}

/** Gives a customer addresses. The first one is the default unless another says `isDefault`. */
export async function createAddressesFor(
  userId: string,
  addresses: readonly FixtureAddress[],
): Promise<void> {
  await withDatabase(async (prisma) => {
    const customerId = await profileIdOf(prisma, userId);
    const anyDefault = addresses.some((address) => address.isDefault === true);
    for (const [index, address] of addresses.entries()) {
      await prisma.serviceAddress.create({
        data: {
          customerId,
          label: address.label,
          line1: address.line1 ?? `${100 + index} Fixture Lane`,
          line2: address.line2 ?? null,
          city: address.city ?? "Harbor City",
          region: address.region ?? "NY",
          postalCode: address.postalCode ?? "10001",
          accessNotes: address.accessNotes ?? null,
          isDefault: address.isDefault ?? (!anyDefault && index === 0),
        },
      });
    }
  });
}

/** The customer's addresses as stored, oldest first. */
export async function readAddressesOf(userId: string): Promise<StoredAddress[]> {
  return withDatabase(async (prisma) => {
    const customerId = await profileIdOf(prisma, userId);
    const rows = await prisma.serviceAddress.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      accessNotes: row.accessNotes,
      isDefault: row.isDefault,
    }));
  });
}

/** The name and phone number as stored. */
export async function readProfileOf(
  userId: string,
): Promise<{ name: string; phone: string | null }> {
  return withDatabase(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, customerProfile: { select: { phone: true } } },
    });
    return { name: user.name, phone: user.customerProfile?.phone ?? null };
  });
}
