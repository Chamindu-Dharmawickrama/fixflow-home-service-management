import { dateOnlyInTimeZone } from "@fixflow/shared";

/** The customer's quotation page (IA-C03). The API only ever shows a customer their own. */
export function portalQuotationPath(id: string): string {
  return `/portal/quotations/${encodeURIComponent(id)}`;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from today to the last valid day, on the business's calendar: 0 on the last
 * day itself, negative once it has passed. Both ends are dates, so a day on which the clocks change
 * is still one day, and the browser's own time zone plays no part (BR-17).
 */
export function daysUntilValidUntil(validUntil: string, now: Date, timeZone: string): number {
  const today = dateOnlyInTimeZone(now, timeZone);
  return Math.round(
    (Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/** How much time is left to answer, in words: "5 days left", "1 day left", "last day to answer". */
export function remainingDaysText(days: number): string {
  if (days <= 0) {
    return "last day to answer";
  }
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** From this many days or fewer the customer is nudged that time is running out. */
export const RUNNING_OUT_DAYS = 2;

export function isRunningOut(days: number): boolean {
  return days <= RUNNING_OUT_DAYS;
}
