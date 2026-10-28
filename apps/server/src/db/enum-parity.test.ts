import * as shared from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import * as prismaEnums from "../generated/prisma/enums.js";

/**
 * The status and role vocabularies exist twice: as Prisma enums (the database) and as constants in
 * `@fixflow/shared` (the API contract and the web app). They must be identical, or a value the
 * database accepts could be unknown to the web app, or the other way round.
 */

const SHARED_ENUM_NAMES = [
  "ActivityEntityType",
  "EmailDeliveryStatus",
  "InvoiceStatus",
  "NoteVisibility",
  "NotificationType",
  "PaymentMethod",
  "PreferredWindow",
  "PricingMode",
  "QuotationStatus",
  "ReferenceType",
  "Role",
  "ServiceRequestStatus",
  "WorkOrderStatus",
] as const;

type EnumObject = Readonly<Record<string, string>>;

const prismaByName = prismaEnums as unknown as Record<string, EnumObject>;
const sharedByName = shared as unknown as Record<string, EnumObject>;

describe("Prisma enums and @fixflow/shared constants", () => {
  it("define the same set of enums", () => {
    const prismaNames = Object.keys(prismaEnums)
      .filter((name) => typeof prismaByName[name] === "object")
      .sort();

    expect(prismaNames).toEqual([...SHARED_ENUM_NAMES].sort());
  });

  it.each(SHARED_ENUM_NAMES)("%s has the same values in both places", (name) => {
    const fromPrisma = prismaByName[name];
    const fromShared = sharedByName[name];

    expect(fromPrisma, `${name} is missing from the Prisma schema`).toBeDefined();
    expect(fromShared, `${name} is missing from @fixflow/shared`).toBeDefined();
    expect(Object.values(fromPrisma ?? {}).sort()).toEqual(Object.values(fromShared ?? {}).sort());
  });
});
