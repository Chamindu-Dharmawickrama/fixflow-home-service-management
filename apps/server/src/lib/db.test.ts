import { describe, expect, it } from "vitest";

import { createUnavailablePrisma, DatabaseUnavailableError } from "./db.js";

describe("createUnavailablePrisma", () => {
  it("fails loudly the moment anything tries to use the database", () => {
    const prisma = createUnavailablePrisma("no database in this test");

    expect(() => Reflect.get(prisma, "$queryRaw")).toThrow(DatabaseUnavailableError);
    expect(() => prisma.user).toThrow("no database in this test");
  });

  it("can be disconnected, awaited and inspected without throwing", async () => {
    const prisma = createUnavailablePrisma("unused");

    await expect(prisma.$disconnect()).resolves.toBeUndefined();
    await expect(Promise.resolve(prisma)).resolves.toBe(prisma);
    expect(String(Object.prototype.toString.call(prisma))).toContain("Object");
  });
});
