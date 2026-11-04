import {
  businessDayBounds,
  type FieldErrors,
  instantToWallClock,
  isDateOnly,
  isTimeOfDay,
  SCHEDULE_RULES,
  type ScheduleWorkOrderBody,
  type SchedulingConflictDto,
  wallClockToInstant,
  type WorkOrderStatus,
} from "@fixflow/shared";

import { formatTimeRange } from "@/lib/formatting/datetime";

import { shortDateLabel, shortWeekdayName } from "../calendar/lib/dates";

/**
 * The scheduling dialog's rules, as pure functions (FR-053, FR-054, D-104). A person types a day and
 * a time of day as they read on the business's clocks; the API takes UTC instants. The conversion is
 * `wallClockToInstant` from the shared package, run here in the browser with the business's time
 * zone given explicitly, so the zone of the browser never enters into it. The server judges the
 * result again with its own clock and, under the technician's lock, for overlaps: nothing here is a
 * rule, only early feedback.
 */

export type ScheduleField = "date" | "startTime" | "duration" | "technicianId" | "reason";
export type ScheduleFormErrors = Partial<Record<ScheduleField, string>>;

/** What the form holds. Everything is text, as the controls hold it. */
export interface ScheduleFormValues {
  /** `YYYY-MM-DD` on the business's calendar. */
  date: string;
  /** `HH:mm`, 24-hour, on the business's clocks. */
  startTime: string;
  /** Minutes, as text. */
  duration: string;
  technicianId: string;
  reason: string;
}

/** A first booking starts as a morning visit of two hours, which the person changes. */
export const DEFAULT_START_TIME = "09:00";
export const DEFAULT_DURATION_MINUTES = 120;

const STEP_MINUTES = 30;

/** Visits are offered in half-hours, up to the longest the server allows. */
export function durationChoices(extra?: number): number[] {
  const choices: number[] = [];
  for (
    let minutes = STEP_MINUTES;
    minutes <= SCHEDULE_RULES.maxDurationMinutes;
    minutes += STEP_MINUTES
  ) {
    choices.push(minutes);
  }
  if (
    extra !== undefined &&
    Number.isInteger(extra) &&
    extra > 0 &&
    extra <= SCHEDULE_RULES.maxDurationMinutes &&
    !choices.includes(extra)
  ) {
    choices.push(extra);
    choices.sort((a, b) => a - b);
  }
  return choices;
}

/** `30` → "30 minutes", `90` → "1 hour 30 minutes", `120` → "2 hours". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = hours === 0 ? "" : `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  const restText = rest === 0 ? "" : `${String(rest)} ${rest === 1 ? "minute" : "minutes"}`;
  return [hoursText, restText].filter((part) => part !== "").join(" ");
}

export interface ScheduleSource {
  /** The job already has an appointment to move (it is `SCHEDULED`). */
  rescheduling: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianId: string | null;
}

/**
 * The form's starting values. Moving a scheduled job starts from its appointment, read on the
 * business's clocks; a first booking (or a job that needs a new time) starts with no date, because
 * its old time, if it has one, is the one that did not work.
 */
export function initialScheduleValues(
  source: ScheduleSource,
  timeZone: string,
): ScheduleFormValues {
  if (source.rescheduling && source.scheduledStart !== null && source.scheduledEnd !== null) {
    const start = instantToWallClock(source.scheduledStart, timeZone);
    const minutes = Math.round(
      (Date.parse(source.scheduledEnd) - Date.parse(source.scheduledStart)) / 60_000,
    );
    return {
      date: start.date,
      startTime: start.time,
      duration: String(minutes),
      technicianId: source.technicianId ?? "",
      reason: "",
    };
  }
  return {
    date: "",
    startTime: DEFAULT_START_TIME,
    duration: String(DEFAULT_DURATION_MINUTES),
    technicianId: source.technicianId ?? "",
    reason: "",
  };
}

export interface ScheduleWindow {
  start: Date;
  end: Date;
}

export type ResolvedSchedule =
  { ok: true; window: ScheduleWindow } | { ok: false; errors: ScheduleFormErrors };

/** The visit as instants, or what stops the form from naming one. */
export function resolveSchedule(
  values: Pick<ScheduleFormValues, "date" | "startTime" | "duration">,
  timeZone: string,
): ResolvedSchedule {
  const errors: ScheduleFormErrors = {};

  if (values.date === "" || !isDateOnly(values.date)) {
    errors.date = "Choose the date of the visit.";
  }
  if (!isTimeOfDay(values.startTime)) {
    errors.startTime = "Enter the start time.";
  }
  const minutes = Number(values.duration);
  if (
    values.duration === "" ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > SCHEDULE_RULES.maxDurationMinutes
  ) {
    errors.duration = "Choose how long the visit lasts.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const start = wallClockToInstant(values.date, values.startTime, timeZone);
  if (start === null) {
    return {
      ok: false,
      errors: {
        startTime: `${values.startTime} does not exist on that day: the clocks go forward that night. Choose another time.`,
      },
    };
  }
  return { ok: true, window: { start, end: new Date(start.getTime() + minutes * 60_000) } };
}

/** The reason is needed to move an appointment, and only then. */
export function reasonProblem(reason: string, rescheduling: boolean): string | undefined {
  if (!rescheduling) return undefined;
  const length = reason.trim().length;
  const { rescheduleReasonMinLength: min, rescheduleReasonMaxLength: max } = SCHEDULE_RULES;
  if (length < min) {
    return `Enter a reason of ${String(min)} to ${String(max)} characters, so the history says why the visit moved.`;
  }
  if (length > max) {
    return `The reason must be ${String(max)} characters or fewer.`;
  }
  return undefined;
}

/** Everything the form can check before asking the server. */
export function validateScheduleForm(
  values: ScheduleFormValues,
  timeZone: string,
  rescheduling: boolean,
): ScheduleFormErrors {
  const resolved = resolveSchedule(values, timeZone);
  const errors: ScheduleFormErrors = resolved.ok ? {} : resolved.errors;
  if (values.technicianId === "") {
    errors.technicianId = "Choose a technician.";
  }
  const reason = reasonProblem(values.reason, rescheduling);
  if (reason !== undefined) {
    errors.reason = reason;
  }
  return errors;
}

/** The request body for a form that passed {@link validateScheduleForm}. */
export function toScheduleBody(
  window: ScheduleWindow,
  values: ScheduleFormValues,
  expectedStatus: WorkOrderStatus,
  rescheduling: boolean,
): ScheduleWorkOrderBody {
  return {
    scheduledStart: window.start.toISOString(),
    scheduledEnd: window.end.toISOString(),
    technicianId: values.technicianId,
    expectedStatus,
    ...(rescheduling && { reason: values.reason.trim() }),
  };
}

/**
 * The server's field errors, placed beside the controls the person sees: the start belongs to the
 * date, the end to the duration. Anything about a field the form does not have is left out (the
 * dialog's alert shows the message).
 */
export function mapServerFieldErrors(fieldErrors: FieldErrors | undefined): ScheduleFormErrors {
  const errors: ScheduleFormErrors = {};
  if (fieldErrors === undefined) return errors;
  if (fieldErrors.scheduledStart !== undefined) errors.date = fieldErrors.scheduledStart;
  if (fieldErrors.scheduledEnd !== undefined) errors.duration = fieldErrors.scheduledEnd;
  if (fieldErrors.technicianId !== undefined) errors.technicianId = fieldErrors.technicianId;
  if (fieldErrors.reason !== undefined) errors.reason = fieldErrors.reason;
  return errors;
}

// ---- Asking the server about conflicts ----------------------------------------------------------

export interface ConflictsRequest {
  technicianId: string;
  start: Date;
  end: Date;
  /** The job being scheduled, so it never clashes with its own old appointment. */
  excludeId: string;
}

/** The pre-check's address (`GET /admin/work-orders/conflicts`). */
export function conflictsRoute(request: ConflictsRequest): `/${string}` {
  const params = new URLSearchParams({
    technicianId: request.technicianId,
    start: request.start.toISOString(),
    end: request.end.toISOString(),
    excludeId: request.excludeId,
  });
  return `/admin/work-orders/conflicts?${params.toString()}`;
}

/** The whole of one business day, for "this technician's other jobs that day". */
export function dayRequest(
  date: string,
  technicianId: string,
  excludeId: string,
  timeZone: string,
): ConflictsRequest | null {
  if (!isDateOnly(date) || technicianId === "") return null;
  const { start, end } = businessDayBounds(date, timeZone);
  return { technicianId, start, end, excludeId };
}

/** `JOB-2026-00031, 10:00 – 12:00 AM`: a job and its time, on the business's clocks. */
export function describeJobTime(
  job: Pick<SchedulingConflictDto, "reference" | "scheduledStart" | "scheduledEnd">,
  timeZone: string,
): string {
  return `${job.reference}, ${formatTimeRange(job.scheduledStart, job.scheduledEnd, timeZone)}`;
}

/** The inline sentence for the pre-check's answer: "Conflicts with JOB-2026-00031, 10:00 AM – 12:00 PM." */
export function conflictSentence(
  conflicts: readonly SchedulingConflictDto[],
  timeZone: string,
): string {
  const [first, ...others] = conflicts;
  if (first === undefined) return "";
  const more = others.length === 0 ? "" : ` and ${String(others.length)} more`;
  return `Conflicts with ${describeJobTime(first, timeZone)}${more}.`;
}

/** `Tue, Mar 3, 10:00 AM – 12:00 PM`: a slot with its day, on the business's clocks. */
export function describeSlot(start: string, end: string, timeZone: string): string {
  const { date } = instantToWallClock(start, timeZone);
  return `${shortWeekdayName(date)}, ${shortDateLabel(date)}, ${formatTimeRange(start, end, timeZone)}`;
}

/**
 * The sentence that states a reschedule before it is saved (spec §10.3: safe rescheduling): "Move
 * JOB-2026-00031 from Tue, Mar 3, 10:00 AM – 12:00 PM to Wed, Mar 4, 2:00 – 4:00 PM?". When only the
 * technician changes it says that instead, and when nothing changes there is nothing to confirm
 * (`null`). The server still decides; this only lets the admin read what they are about to do.
 */
export function describeMove(
  input: {
    reference: string;
    current: { start: string; end: string };
    next: ScheduleWindow;
    /** The chosen technician differs from the job's current one. */
    technicianChanged: boolean;
    technicianName: string | undefined;
  },
  timeZone: string,
): string | null {
  const nextStart = input.next.start.toISOString();
  const nextEnd = input.next.end.toISOString();
  const sameTime =
    input.next.start.getTime() === Date.parse(input.current.start) &&
    input.next.end.getTime() === Date.parse(input.current.end);
  const who =
    input.technicianChanged && input.technicianName !== undefined ? input.technicianName : null;
  const from = describeSlot(input.current.start, input.current.end, timeZone);

  if (sameTime) {
    return who === null ? null : `Keep ${input.reference} at ${from} and give it to ${who}?`;
  }
  const to = describeSlot(nextStart, nextEnd, timeZone);
  return `Move ${input.reference} from ${from} to ${to}${who === null ? "" : `, with ${who}`}?`;
}
