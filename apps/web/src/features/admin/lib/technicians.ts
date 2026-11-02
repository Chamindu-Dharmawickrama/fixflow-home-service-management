import {
  LIMITS,
  TECHNICIAN_ACTIVE_FILTERS,
  type TechnicianActiveFilter,
  type TechnicianAvailabilityDayDto,
} from "@fixflow/shared";

import { buildHref, type SearchParamsInput } from "@/lib/url";

/** The business's technicians (IA-A10). */
export const TECHNICIANS_PATH = "/app/technicians";

export const TECHNICIANS_PAGE_SIZE = LIMITS.pagination.defaultPageSize;

/** One technician's page, keyed by id (a name is a label, never the address). */
export function adminTechnicianPath(id: string): string {
  return `${TECHNICIANS_PATH}/${encodeURIComponent(id)}`;
}

// ---- The list ---------------------------------------------------------------------------------

export type SortOrder = "asc" | "desc";

export interface TechniciansQuery {
  q: string | undefined;
  /** The tab: who is active, who is not, or everyone. The people who can be scheduled come first. */
  active: TechnicianActiveFilter;
  /** The list is sorted by name; this is which way. */
  order: SortOrder;
  page: number;
}

/** The tab shown when the address names none. */
export const DEFAULT_ACTIVE_FILTER: TechnicianActiveFilter = "true";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The list's tab, search, order and page from the page's `searchParams` (D-40). The address is typed
 * and edited by people, so anything unusable falls back to its default instead of failing the page.
 * (The API is strict and answers `422`; this keeps a hand-edited link working.)
 */
export function parseTechniciansQuery(params: SearchParamsInput): TechniciansQuery {
  const q = first(params.q)
    ?.trim()
    .replace(/\s+/g, " ")
    .slice(0, LIMITS.technician.search.maxLength);
  const active = first(params.active);
  const order = first(params.order);
  const page = first(params.page);

  return {
    q: q === undefined || q === "" ? undefined : q,
    active: TECHNICIAN_ACTIVE_FILTERS.find((filter) => filter === active) ?? DEFAULT_ACTIVE_FILTER,
    order: order === "desc" ? "desc" : "asc",
    page:
      page !== undefined && /^\d+$/.test(page) && Number(page) >= 1
        ? Math.min(Number(page), LIMITS.pagination.maxPage)
        : 1,
  };
}

/** The query string for `GET /admin/technicians`. */
export function toTechniciansApiQueryString(query: TechniciansQuery): string {
  const params = new URLSearchParams({
    active: query.active,
    page: String(query.page),
    pageSize: String(TECHNICIANS_PAGE_SIZE),
    sort: "name",
    order: query.order,
  });
  if (query.q !== undefined) params.set("q", query.q);
  return params.toString();
}

/** True when a search narrows the list (so an empty result means "no match", not "none yet"). */
export function hasActiveSearch(query: TechniciansQuery): boolean {
  return query.q !== undefined;
}

/** The link of a tab: that filter, back on page 1, keeping the search. The default tab has a clean address. */
export function techniciansTabHref(
  params: SearchParamsInput,
  active: TechnicianActiveFilter,
): string {
  return buildHref(TECHNICIANS_PATH, params, {
    active: active === DEFAULT_ACTIVE_FILTER ? null : active,
    page: null,
  });
}

/** The link the "Name" column header goes to: the other way round. */
export function techniciansSortHref(params: SearchParamsInput, query: TechniciansQuery): string {
  return buildHref(TECHNICIANS_PATH, params, {
    order: query.order === "asc" ? "desc" : "asc",
    page: null,
  });
}

// ---- Words ------------------------------------------------------------------------------------

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * What is still true of an inactive technician's jobs, for the note on their page: they stay with
 * them until someone reassigns them (FR-060). The verb agrees with the count.
 */
export function inactiveJobsSentence(upcomingJobCount: number): string {
  if (upcomingJobCount === 0) {
    return "They have no upcoming jobs.";
  }
  return upcomingJobCount === 1
    ? "1 upcoming job stays assigned until you reassign it."
    : `${String(upcomingJobCount)} upcoming jobs stay assigned until you reassign them.`;
}

/** The first word of a name, for "Jordan won't be available…". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * What deactivating a technician does, in plain words (FR-060): the jobs stay assigned and can be
 * reassigned one by one, and the technician stops being offered for new work. The count is the one
 * the page was loaded with; the answer to the deactivation reports the real one.
 */
export function deactivateConsequence(name: string, upcomingJobCount: number): string {
  const unavailable = `${firstNameOf(name)} won't be available for new assignments.`;
  if (upcomingJobCount === 0) {
    return `${name} has no upcoming jobs. ${unavailable}`;
  }
  const count = `${String(upcomingJobCount)} upcoming ${plural(upcomingJobCount, "job", "jobs")}`;
  const stay = plural(
    upcomingJobCount,
    "It stays assigned; you can reassign it from the job.",
    "They stay assigned; you can reassign them from each job.",
  );
  return `${name} has ${count}. ${stay} ${unavailable}`;
}

/**
 * What to say after a deactivation, from the server's own count of the jobs that stayed: they stay
 * assigned (FR-060), and the admin can move them one by one.
 */
export function deactivatedMessage(name: string, stayedAssigned: number): string {
  if (stayedAssigned === 0) {
    return `${firstNameOf(name)} won't be offered for new jobs.`;
  }
  return stayedAssigned === 1
    ? "1 upcoming job stays assigned. Reassign it from the job when you are ready."
    : `${String(stayedAssigned)} upcoming jobs stay assigned. Reassign them from each job when you are ready.`;
}

/** Booked time for the summary: "Free", "45 min", "2 h", "2 h 30 min". */
export function formatBookedTime(minutes: number): string {
  if (minutes <= 0) return "Free";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A day of the summary as its tile shows it: `{ weekday: "Mon", date: "Mar 2" }`. The day is a date on
 * the business's calendar (`YYYY-MM-DD`), so it is read as written, never through a time zone.
 */
export function describeDay(date: string): { weekday: string; date: string } {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return { weekday, date: `${MONTHS[month - 1] ?? ""} ${String(day)}` };
}

/**
 * The two lines that name a day's tile, the same shape for every day so the tiles line up: today is
 * named and then dated ("Today" / "Mon Mar 2"), another day is its weekday and then its date
 * ("Tue" / "Mar 3"). Today is the first day of the summary.
 */
export function dayTileLines(
  day: TechnicianAvailabilityDayDto,
  index: number,
): { heading: string; date: string } {
  const { weekday, date } = describeDay(day.date);
  return index === 0
    ? { heading: "Today", date: `${weekday} ${date}` }
    : { heading: weekday, date };
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Keeps "10:00 AM" together when a time range has to wrap, so it breaks at the dash and never leaves
 * "AM" alone on a line.
 */
export function keepMeridiemTogether(timeRange: string): string {
  return timeRange.replace(/(\d) (AM|PM)/g, `$1${NO_BREAK_SPACE}$2`);
}
