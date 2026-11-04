import { type CalendarItemDto, instantToWallClock, type TechnicianColor } from "@fixflow/shared";

import { segmentsOf, type VisitSegment } from "./layout";

/** Grouping the week's visits for the views (T19). Pure; the views only draw what these return. */

/** The business day an instant falls on, `YYYY-MM-DD`. */
export function businessDateOf(instant: string, timeZone: string): string {
  return instantToWallClock(instant, timeZone).date;
}

/** A visit and the part of it that falls on one day: what a block draws. */
export interface DayVisit {
  visit: CalendarItemDto;
  segment: VisitSegment;
}

/**
 * The blocks of each day in `days`, earliest first. A visit that runs past midnight has a block on
 * each day it touches; a block on a day outside `days` is left out (that day is not on screen).
 */
export function blocksByDay(
  items: readonly CalendarItemDto[],
  days: readonly string[],
  timeZone: string,
): Map<string, DayVisit[]> {
  const result = new Map<string, DayVisit[]>(days.map((day) => [day, []]));
  for (const visit of items) {
    for (const segment of segmentsOf(
      { id: visit.id, start: visit.start, end: visit.end },
      timeZone,
    )) {
      result.get(segment.date)?.push({ visit, segment });
    }
  }
  for (const blocks of result.values()) {
    blocks.sort(
      (a, b) =>
        a.segment.startMin - b.segment.startMin ||
        b.segment.endMin - a.segment.endMin ||
        a.visit.id.localeCompare(b.visit.id),
    );
  }
  return result;
}

export interface AgendaDay {
  /** The business day, `YYYY-MM-DD`. */
  date: string;
  visits: CalendarItemDto[];
}

/**
 * The agenda: visits grouped by the day they start, in time order. A day with no visit has no entry,
 * so empty days collapse away.
 */
export function agendaDays(items: readonly CalendarItemDto[], timeZone: string): AgendaDay[] {
  const byDay = new Map<string, CalendarItemDto[]>();
  for (const visit of items) {
    const date = businessDateOf(visit.start, timeZone);
    const day = byDay.get(date);
    if (day === undefined) {
      byDay.set(date, [visit]);
    } else {
      day.push(visit);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, visits]) => ({
      date,
      visits: [...visits].sort(
        (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id),
      ),
    }));
}

export interface TechnicianColumn {
  /** `null` for visits that have no technician. */
  technicianId: string | null;
  name: string;
  calendarColor: TechnicianColor | null;
  blocks: DayVisit[];
}

/**
 * One day's blocks split into a column per technician (the day view's "split by technician"): the
 * technicians who have a visit that day, A to Z, then any visits with nobody assigned.
 */
export function splitByTechnician(blocks: readonly DayVisit[]): TechnicianColumn[] {
  const columns = new Map<string, TechnicianColumn>();
  for (const block of blocks) {
    const technician = block.visit.technician;
    const key = technician?.id ?? "";
    const column = columns.get(key);
    if (column === undefined) {
      columns.set(key, {
        technicianId: technician?.id ?? null,
        name: technician?.name ?? "No technician",
        calendarColor: technician?.calendarColor ?? null,
        blocks: [block],
      });
    } else {
      column.blocks.push(block);
    }
  }
  return [...columns.values()].sort((a, b) => {
    if (a.technicianId === null) return 1;
    if (b.technicianId === null) return -1;
    return a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId);
  });
}

export interface LegendTechnician {
  id: string;
  name: string;
  calendarColor: TechnicianColor;
  isActive: boolean;
}

/**
 * The technicians the legend names: every active technician, plus an inactive one who still has a
 * visit on screen (their colour must be explained), A to Z.
 */
export function legendTechnicians(
  technicians: readonly LegendTechnician[],
  items: readonly CalendarItemDto[],
): LegendTechnician[] {
  const onScreen = new Set(items.flatMap((item) => (item.technician ? [item.technician.id] : [])));
  return technicians
    .filter((technician) => technician.isActive || onScreen.has(technician.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
