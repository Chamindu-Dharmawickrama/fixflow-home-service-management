/**
 * `date` columns come back as midnight UTC; the date-only wire format is `YYYY-MM-DD` (CLAUDE.md §8).
 * The day is the one stored, so there is no time zone to apply.
 */
export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
