/**
 * `date` columns come back as midnight UTC; the date-only wire format is `YYYY-MM-DD` (CLAUDE.md §8).
 * The day is the one stored, so there is no time zone to apply.
 */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` day as the UTC-midnight `Date` Prisma writes a `date` column from: the inverse of {@link toDateOnly}. */
export function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
