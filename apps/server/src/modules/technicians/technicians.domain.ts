import {
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  TECHNICIAN_AVAILABILITY_DAYS,
  TECHNICIAN_COLORS,
  TECHNICIAN_UPCOMING_DAYS,
  TechnicianAction,
  type TechnicianAvailabilityDayDto,
  type TechnicianColor,
  WorkOrderStatus,
} from "@fixflow/shared";

import { startOfBusinessDay } from "../../lib/business-day.js";

/**
 * Pure rules for technician resources (FR-060 to FR-062): what counts as an upcoming assignment,
 * the hours booked on each day, which colour a new technician is offered and what changed in an
 * edit. No I/O: the service reads the rows and the clock and hands them in.
 */

/**
 * The statuses in which a job holds its technician's time. The same pair D-25 uses for overlap
 * checks, so "booked" means the same thing here and when scheduling (T17).
 */
export const BOOKED_STATUSES = [
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.IN_PROGRESS,
] as const satisfies readonly WorkOrderStatus[];

// ---- The windows of time (D-103) -------------------------------------------------------------

export interface BusinessDay {
  /** `YYYY-MM-DD` on the business's calendar. */
  date: string;
  /** The instant the day starts on the business's wall clock. */
  start: Date;
  /** The instant the next day starts, so a day is the half-open interval `[start, end)`. */
  end: Date;
}

export interface AssignmentWindow {
  /** The start of today on the business's wall clock: the earliest a booked hour can fall. */
  since: Date;
  /** An appointment that has not ended by this instant (now) is still to come. */
  from: Date;
  /** The start of the day after the last of the {@link TECHNICIAN_UPCOMING_DAYS} days. */
  until: Date;
  /** Today and the days after it for the availability summary, oldest first. */
  days: BusinessDay[];
}

/**
 * The windows an assignment is judged against, from the clock and the business time zone. Days are
 * counted on the business's calendar, not as 24-hour spans, so the day the clocks change is still
 * one day long and "today" is today where the business is, whatever the server's zone (BR-17).
 */
export function assignmentWindow(now: Date, timeZone: string): AssignmentWindow {
  const today = dateOnlyInTimeZone(now, timeZone);
  const days = Array.from({ length: TECHNICIAN_AVAILABILITY_DAYS }, (_, index) => {
    const date = addDaysToDateOnly(today, index);
    return {
      date,
      start: startOfBusinessDay(date, timeZone),
      end: startOfBusinessDay(addDaysToDateOnly(date, 1), timeZone),
    };
  });
  return {
    since: startOfBusinessDay(today, timeZone),
    from: now,
    until: startOfBusinessDay(addDaysToDateOnly(today, TECHNICIAN_UPCOMING_DAYS), timeZone),
    days,
  };
}

export interface Appointment {
  scheduledStart: Date;
  scheduledEnd: Date;
}

/**
 * An assignment is upcoming when its appointment has not ended yet and starts inside the window:
 * a job in progress right now counts, a job that finished this morning does not. Back-to-back
 * appointments are half-open, so one that ends at the very instant of `from` is already over.
 */
export function isUpcoming(appointment: Appointment, window: AssignmentWindow): boolean {
  return (
    appointment.scheduledEnd.getTime() > window.from.getTime() &&
    appointment.scheduledStart.getTime() < window.until.getTime()
  );
}

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * The minutes of appointments that fall on each day. An appointment that crosses midnight is split
 * between its days; one that lies outside every day counts nowhere.
 */
export function scheduledMinutesPerDay(
  appointments: readonly Appointment[],
  days: readonly BusinessDay[],
): TechnicianAvailabilityDayDto[] {
  return days.map((day) => {
    let milliseconds = 0;
    for (const appointment of appointments) {
      const overlap =
        Math.min(appointment.scheduledEnd.getTime(), day.end.getTime()) -
        Math.max(appointment.scheduledStart.getTime(), day.start.getTime());
      if (overlap > 0) {
        milliseconds += overlap;
      }
    }
    return { date: day.date, scheduledMinutes: Math.round(milliseconds / MILLISECONDS_PER_MINUTE) };
  });
}

/** "no upcoming jobs", "1 upcoming job stays assigned": for the history line of a deactivation. */
export function keptAssignmentsPhrase(count: number): string {
  if (count === 0) {
    return "no upcoming jobs are assigned";
  }
  return count === 1
    ? "1 upcoming job stays assigned"
    : `${String(count)} upcoming jobs stay assigned`;
}

// ---- Colours ---------------------------------------------------------------------------------

/**
 * The colour a new technician is offered: the first in the palette that the fewest technicians
 * have, so the first eight all differ and after that the colours are shared as evenly as can be.
 * Inactive technicians count too: their past jobs still show on the calendar in their colour.
 * Anything stored that is not on the palette is ignored.
 */
export function pickCalendarColor(inUse: readonly string[]): TechnicianColor {
  const counts = new Map<TechnicianColor, number>(TECHNICIAN_COLORS.map((color) => [color, 0]));
  for (const used of inUse) {
    const known = TECHNICIAN_COLORS.find((color) => color === used);
    if (known !== undefined) {
      counts.set(known, (counts.get(known) ?? 0) + 1);
    }
  }
  const fewest = Math.min(...counts.values());
  return TECHNICIAN_COLORS.find((color) => counts.get(color) === fewest) ?? TECHNICIAN_COLORS[0];
}

// ---- The fields ------------------------------------------------------------------------------

export const TECHNICIAN_FIELDS = [
  "name",
  "phone",
  "email",
  "specialties",
  "notes",
  "calendarColor",
] as const;
export type TechnicianField = (typeof TECHNICIAN_FIELDS)[number];

export interface TechnicianValues {
  name: string;
  phone: string | null;
  email: string | null;
  specialties: string[];
  notes: string | null;
  calendarColor: string;
}

export type TechnicianPatch = { [Field in TechnicianField]?: TechnicianValues[Field] | undefined };

/**
 * Tidies a list of tags: spaces inside a tag become one, a blank tag goes, and a tag that repeats an
 * earlier one (ignoring case) goes too. The first spelling and the order entered are kept.
 */
export function tidySpecialties(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const tidy: string[] = [];
  for (const tag of tags) {
    const spaced = tag.replace(/\s+/g, " ").trim();
    const key = spaced.toLowerCase();
    if (spaced !== "" && !seen.has(key)) {
      seen.add(key);
      tidy.push(spaced);
    }
  }
  return tidy;
}

/** The stored values with a patch laid over them; a field the patch leaves out keeps its value. */
export function mergeTechnicianValues(
  current: TechnicianValues,
  patch: TechnicianPatch,
): TechnicianValues {
  return {
    name: patch.name ?? current.name,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    email: patch.email === undefined ? current.email : patch.email,
    specialties: patch.specialties ?? current.specialties,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    calendarColor: patch.calendarColor ?? current.calendarColor,
  };
}

function sameValue(a: TechnicianValues[TechnicianField], b: TechnicianValues[TechnicianField]) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((tag, index) => tag === b[index]);
  }
  return a === b;
}

/** The fields whose value differs, in the order of {@link TECHNICIAN_FIELDS}. */
export function changedTechnicianFields(
  current: TechnicianValues,
  next: TechnicianValues,
): TechnicianField[] {
  return TECHNICIAN_FIELDS.filter((field) => !sameValue(current[field], next[field]));
}

/** What the admin may do to a technician in their state (D-43). Editing is allowed in both. */
export function availableActions(isActive: boolean): TechnicianAction[] {
  return [
    TechnicianAction.EDIT,
    isActive ? TechnicianAction.DEACTIVATE : TechnicianAction.ACTIVATE,
  ];
}
