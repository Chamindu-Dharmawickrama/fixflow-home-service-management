import {
  type CalendarDto,
  type CalendarItemDto,
  type CalendarWaitingJobDto,
  wallClockToInstant,
  WorkOrderAction,
  WorkOrderStatus,
  workOrderStatusLabel,
} from "@fixflow/shared";

/** The business zone every calendar test reads the clocks of, and a browser zone that differs from it. */
export const BUSINESS_ZONE = "America/New_York";

/** An instant from a reading of the business's clocks: `at("2026-03-03", "10:00")` is 15:00Z. */
export function at(date: string, time: string): string {
  const instant = wallClockToInstant(date, time, BUSINESS_ZONE);
  if (instant === null) {
    throw new Error(`${date} ${time} does not exist in ${BUSINESS_ZONE}.`);
  }
  return instant.toISOString();
}

export const JORDAN = { id: "11111111-1111-4111-8111-111111111111", name: "Jordan Lee" } as const;
export const SAM = { id: "22222222-2222-4222-8222-222222222222", name: "Sam Ortiz" } as const;

let counter = 0;

/** A visit on the calendar; every field can be overridden. The start and end read on the business's clocks. */
export function visit(
  overrides: Partial<CalendarItemDto> & { date?: string; from?: string; to?: string } = {},
): CalendarItemDto {
  counter += 1;
  const { date = "2026-03-03", from = "10:00", to = "12:00", ...rest } = overrides;
  const status = rest.status ?? WorkOrderStatus.SCHEDULED;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    reference: `JOB-2026-${String(counter).padStart(5, "0")}`,
    status,
    statusLabel: workOrderStatusLabel(status),
    start: at(date, from),
    end: at(date, to),
    technician: { id: JORDAN.id, name: JORDAN.name, calendarColor: "blue" },
    customerName: "Alex Morgan",
    serviceName: "AC Routine Maintenance",
    city: "Brooklyn",
    availableActions:
      status === WorkOrderStatus.SCHEDULED
        ? [WorkOrderAction.RESCHEDULE, WorkOrderAction.START, WorkOrderAction.CANCEL]
        : [],
    ...rest,
  };
}

export function waitingJob(overrides: Partial<CalendarWaitingJobDto> = {}): CalendarWaitingJobDto {
  counter += 1;
  const status = overrides.status ?? WorkOrderStatus.PENDING_SCHEDULING;
  return {
    id: `99999999-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    reference: `JOB-2026-${String(counter).padStart(5, "0")}`,
    status,
    statusLabel: workOrderStatusLabel(status),
    serviceName: "Duct Cleaning",
    customerName: "Priya Raman",
    city: "Queens",
    scheduledStart: null,
    scheduledEnd: null,
    technician: null,
    ...overrides,
  };
}

export function calendarData(overrides: Partial<CalendarDto> = {}): CalendarDto {
  return {
    from: "2026-03-02",
    to: "2026-03-08",
    timeZone: BUSINESS_ZONE,
    items: [],
    truncated: false,
    needsScheduling: [],
    needsSchedulingTotal: 0,
    ...overrides,
  };
}
