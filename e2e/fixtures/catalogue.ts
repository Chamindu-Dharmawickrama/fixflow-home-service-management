import { BUSINESS_SETTINGS_ID } from "../../apps/server/src/lib/db.js";
import { withDatabase } from "./accounts.js";

/**
 * Helpers for the catalogue and settings specs. They talk to the E2E database directly, as the other
 * fixtures do: the specs create their data through the real screens, but clean up (and put shared
 * settings back) here, because there is no delete in the product (BR-04: services are archived).
 */

/** The names of services created by a spec start with this, followed by a unique tag. */
export const E2E_SERVICE_PREFIX = "E2E ";

/** Removes the services whose name starts with `prefix` (and nothing else). */
export async function deleteServicesNamed(prefix: string): Promise<number> {
  if (!prefix.startsWith(E2E_SERVICE_PREFIX)) {
    throw new Error(`Refusing to delete services by a prefix that is not "${E2E_SERVICE_PREFIX}".`);
  }
  return withDatabase(async (prisma) => {
    const result = await prisma.service.deleteMany({ where: { name: { startsWith: prefix } } });
    return result.count;
  });
}

/** The business phone number as stored, so a spec can restore it. */
export async function storedBusinessPhone(): Promise<string> {
  return withDatabase(async (prisma) => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: BUSINESS_SETTINGS_ID },
      select: { phone: true },
    });
    return settings.phone;
  });
}

export async function restoreBusinessPhone(phone: string): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.businessSettings.update({ where: { id: BUSINESS_SETTINGS_ID }, data: { phone } });
  });
}
