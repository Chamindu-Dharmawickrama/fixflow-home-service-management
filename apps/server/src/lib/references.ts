import { TZDate } from "@date-fns/tz";
import { ReferenceType } from "@fixflow/shared";

import type { DbClient } from "./db.js";

/** The prefix of each human-readable reference (D-17). */
export const REFERENCE_PREFIXES = {
  [ReferenceType.REQUEST]: "FF",
  [ReferenceType.QUOTATION]: "QT",
  [ReferenceType.WORK_ORDER]: "JOB",
  [ReferenceType.INVOICE]: "INV",
} as const satisfies Record<ReferenceType, string>;

const SEQUENCE_DIGITS = 5;

/** `("REQUEST", 2026, 7)` → `"FF-2026-00007"`. A sequence above 99999 simply grows a digit. */
export function formatReference(type: ReferenceType, year: number, sequence: number): string {
  return `${REFERENCE_PREFIXES[type]}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
}

/**
 * The calendar year of an instant in the business time zone. Late on 31 December in New York is
 * already next year in UTC, and the reference must follow the business's calendar (D-17, BR-17).
 */
export function referenceYear(at: Date, timeZone: string): number {
  const year = new TZDate(at.getTime(), timeZone).getFullYear();
  if (!Number.isInteger(year)) {
    throw new Error(`Cannot compute a reference year for the time zone "${timeZone}".`);
  }
  return year;
}

/**
 * Allocates the next reference of a type, for example `FF-2026-00001` (D-17).
 *
 * Call it inside the transaction that creates the record. The counter row is created or
 * incremented with one atomic upsert, so two concurrent callers can never receive the same number;
 * the second waits on the row lock until the first commits. Because the increment is part of the
 * caller's transaction, a rollback gives the number back: references have no gaps.
 */
export async function nextReference(
  tx: DbClient,
  type: ReferenceType,
  at: Date,
  timeZone: string,
): Promise<string> {
  const year = referenceYear(at, timeZone);

  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "reference_counters" ("type", "year", "value")
    VALUES (${type}::"reference_type", ${year}::int, 1)
    ON CONFLICT ("type", "year")
    DO UPDATE SET "value" = "reference_counters"."value" + 1
    RETURNING "value"`;

  const sequence = rows[0]?.value;
  if (sequence === undefined) {
    throw new Error("The reference counter returned no value.");
  }
  return formatReference(type, year, sequence);
}
