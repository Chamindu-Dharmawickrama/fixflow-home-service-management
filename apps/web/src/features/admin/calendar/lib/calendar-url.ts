import { isDateOnly } from "@fixflow/shared";

import { buildHref, type SearchParamsInput } from "@/lib/url";

import { CALENDAR_VIEWS, type CalendarView, weekRange } from "./dates";

/** The scheduling calendar (IA-A06, FR-052). */
export const CALENDAR_PATH = "/app/calendar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CalendarQuery {
  /**
   * The view the address names. `null` when it names none: the screen then picks the one that fits
   * the width of the window (week on a wide screen, day on a tablet, agenda on a phone).
   */
  view: CalendarView | null;
  /** The day shown, or any day of the week shown: `YYYY-MM-DD` on the business's calendar. */
  date: string;
  /** One technician's calendar, or `null` for everyone's. */
  technicianId: string | null;
  /** The day view lays the technicians out side by side instead of in one column. */
  split: boolean;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The calendar's view, date and technician from the page's `searchParams` (D-40). The address is typed
 * and edited by people, so anything unusable falls back to its default instead of failing the page:
 * an unknown view is ignored, a missing or impossible date means today, and a technician that is not
 * an id means everyone. (Whether the technician exists is for the page to say: it has the list.)
 */
export function parseCalendarQuery(params: SearchParamsInput, today: string): CalendarQuery {
  const view = CALENDAR_VIEWS.find((candidate) => candidate === first(params.view)) ?? null;
  const date = first(params.date)?.trim();
  const technician = first(params.technician)?.trim();
  return {
    view,
    date: date !== undefined && isDateOnly(date) ? date : today,
    technicianId: technician !== undefined && UUID.test(technician) ? technician : null,
    split: first(params.split) === "1",
  };
}

/**
 * The address of a calendar screen. Each part that is left at its default is left out, so the
 * plain `/app/calendar` stays plain and the address says only what the person chose.
 */
export function calendarHref(
  state: Pick<CalendarQuery, "view" | "technicianId" | "split"> & { date: string | null },
): string {
  return buildHref(
    CALENDAR_PATH,
    {},
    {
      view: state.view,
      date: state.date,
      technician: state.technicianId,
      split: state.split ? "1" : null,
    },
  );
}

/** The week of data that backs every view: the API is asked once per week, not once per day. */
export function dataRange(date: string): { from: string; to: string } {
  return weekRange(date);
}

/** The API route for the calendar's data. */
export function calendarApiRoute(date: string, technicianId: string | null): `/${string}` {
  const { from, to } = dataRange(date);
  const params = new URLSearchParams({ from, to });
  if (technicianId !== null) {
    params.set("technicianId", technicianId);
  }
  return `/admin/calendar?${params.toString()}`;
}
