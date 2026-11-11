import {
  type AttentionItemType,
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGES,
  type DashboardRange,
  DEFAULT_DASHBOARD_RANGE,
  isDashboardRange,
} from "@fixflow/shared";

import { hourInTimeZone } from "@/lib/formatting";
import type { SearchParamsInput } from "@/lib/url";

/** The business's dashboard (IA-A01). */
export const DASHBOARD_PATH = "/app/dashboard";

/**
 * The range from the address (D-40). The address is typed by people, so anything unusable falls back
 * to the default instead of failing the page.
 */
export function parseDashboardRange(params: SearchParamsInput): DashboardRange {
  const asked = Array.isArray(params.range) ? params.range[0] : params.range;
  return isDashboardRange(asked) ? asked : DEFAULT_DASHBOARD_RANGE;
}

/** The address of a range: the default range has the clean address. */
export function rangeHref(range: DashboardRange): string {
  return range === DEFAULT_DASHBOARD_RANGE ? DASHBOARD_PATH : `${DASHBOARD_PATH}?range=${range}`;
}

export const RANGE_OPTIONS: ReadonlyArray<{ range: DashboardRange; label: string }> =
  DASHBOARD_RANGES.map((range) => ({ range, label: DASHBOARD_RANGE_LABELS[range] }));

/** What the "new requests" figure says it covers: "Today", "Last 7 days". */
export const PERIOD_CONTEXT: Readonly<Record<DashboardRange, string>> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

/**
 * "Good morning", "Good afternoon" or "Good evening" for the hour on the business's clocks: the
 * greeting follows the business's day, not the browser's (D-42). Before noon is morning, noon to five
 * is afternoon, and the rest is evening.
 */
export function greetingFor(instant: string, timeZone: string): string {
  const hour = hourInTimeZone(instant, timeZone);
  if (hour < 12) {
    return "Good morning";
  }
  return hour < 17 ? "Good afternoon" : "Good evening";
}

/** The first word of a full name, for a greeting ("Morgan Reyes" is "Morgan"); a blank name is "there". */
export function firstName(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? "there" : first;
}

/** How each kind of attention item is labelled in colour as well as words. */
export const ATTENTION_TONES: Readonly<
  Record<AttentionItemType, "danger" | "attention" | "info" | "neutral">
> = {
  OVERDUE_INVOICE: "danger",
  JOB_TODAY_NOT_STARTED: "attention",
  NEW_REQUEST: "info",
  ACCEPTED_QUOTATION: "info",
  JOB_NEEDS_SCHEDULING: "attention",
  JOB_AWAITING_INVOICE: "neutral",
  QUOTATION_EXPIRING: "attention",
};
