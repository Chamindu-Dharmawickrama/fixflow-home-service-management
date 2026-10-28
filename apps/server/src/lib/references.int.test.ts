import { ReferenceType } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../test/db.js";
import { FIXTURE_TIME_ZONE } from "../test/fixtures.js";
import { nextReference } from "./references.js";

const prisma = getTestPrisma();
const NEW_YORK = FIXTURE_TIME_ZONE;
const MIDDAY = new Date("2026-06-15T16:00:00.000Z");

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/** One reference in its own transaction, as a business operation would allocate it. */
function allocate(type: ReferenceType, at: Date = MIDDAY): Promise<string> {
  return prisma.$transaction((tx) => nextReference(tx, type, at, NEW_YORK));
}

describe("nextReference", () => {
  it("starts at 00001 and counts up, in the D-17 format", async () => {
    expect(await allocate(ReferenceType.REQUEST)).toBe("FF-2026-00001");
    expect(await allocate(ReferenceType.REQUEST)).toBe("FF-2026-00002");
    expect(await allocate(ReferenceType.REQUEST)).toBe("FF-2026-00003");
  });

  it("uses the prefix of each type and counts each type separately", async () => {
    expect(await allocate(ReferenceType.REQUEST)).toBe("FF-2026-00001");
    expect(await allocate(ReferenceType.QUOTATION)).toBe("QT-2026-00001");
    expect(await allocate(ReferenceType.WORK_ORDER)).toBe("JOB-2026-00001");
    expect(await allocate(ReferenceType.INVOICE)).toBe("INV-2026-00001");
    expect(await allocate(ReferenceType.QUOTATION)).toBe("QT-2026-00002");
    expect(await allocate(ReferenceType.REQUEST)).toBe("FF-2026-00002");
  });

  it("restarts at 00001 in a new year and keeps the old year's count", async () => {
    await allocate(ReferenceType.REQUEST, new Date("2026-12-20T12:00:00.000Z"));
    await allocate(ReferenceType.REQUEST, new Date("2026-12-21T12:00:00.000Z"));

    expect(await allocate(ReferenceType.REQUEST, new Date("2027-01-05T12:00:00.000Z"))).toBe(
      "FF-2027-00001",
    );
    expect(await allocate(ReferenceType.REQUEST, new Date("2026-12-22T12:00:00.000Z"))).toBe(
      "FF-2026-00003",
    );
  });

  it("takes the year from the business time zone, not from UTC", async () => {
    // 03:30 UTC on 1 January 2027 is still 22:30 on 31 December 2026 in New York.
    const newYearInUtc = new Date("2027-01-01T03:30:00.000Z");

    expect(await allocate(ReferenceType.INVOICE, newYearInUtc)).toBe("INV-2026-00001");
    expect(
      await prisma.$transaction((tx) =>
        nextReference(tx, ReferenceType.INVOICE, newYearInUtc, "UTC"),
      ),
    ).toBe("INV-2027-00001");
  });

  it("gives sequential numbers inside one transaction", async () => {
    const references = await prisma.$transaction(async (tx) => [
      await nextReference(tx, ReferenceType.REQUEST, MIDDAY, NEW_YORK),
      await nextReference(tx, ReferenceType.REQUEST, MIDDAY, NEW_YORK),
    ]);

    expect(references).toEqual(["FF-2026-00001", "FF-2026-00002"]);
  });

  it("gives the number back when the transaction rolls back, so there are no gaps", async () => {
    await allocate(ReferenceType.QUOTATION);

    await expect(
      prisma.$transaction(async (tx) => {
        await nextReference(tx, ReferenceType.QUOTATION, MIDDAY, NEW_YORK);
        throw new Error("the business operation failed after the reference was allocated");
      }),
    ).rejects.toThrow("business operation failed");

    expect(await allocate(ReferenceType.QUOTATION)).toBe("QT-2026-00002");
  });

  it("also works with the plain client outside a transaction", async () => {
    expect(await nextReference(prisma, ReferenceType.REQUEST, MIDDAY, NEW_YORK)).toBe(
      "FF-2026-00001",
    );
  });

  it("hands out 20 unique, gap-free numbers to 20 concurrent transactions", async () => {
    // The counter row does not exist yet, so this also races the very first insert.
    const references = await Promise.all(
      Array.from({ length: 20 }, () => allocate(ReferenceType.REQUEST)),
    );

    expect(new Set(references).size).toBe(20);
    const sequences = references
      .map((reference) => Number(reference.split("-")[2]))
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_unused, index) => index + 1));
    expect(references.every((reference) => /^FF-2026-\d{5}$/.test(reference))).toBe(true);

    const counter = await prisma.referenceCounter.findUniqueOrThrow({
      where: { type_year: { type: "REQUEST", year: 2026 } },
    });
    expect(counter.value).toBe(20);
  });

  it("stays unique and gap-free when concurrent transactions mix commits and rollbacks", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_unused, index) =>
        prisma.$transaction(async (tx) => {
          const reference = await nextReference(tx, ReferenceType.INVOICE, MIDDAY, NEW_YORK);
          if (index % 4 === 0) throw new Error("rolled back");
          return reference;
        }),
      ),
    );

    const committed = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );
    expect(committed).toHaveLength(15);
    const sequences = committed
      .map((reference) => Number(reference.split("-")[2]))
      .sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 15 }, (_unused, index) => index + 1));
  });
});
