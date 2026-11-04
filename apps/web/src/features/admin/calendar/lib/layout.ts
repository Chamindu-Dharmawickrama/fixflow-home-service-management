import { addDaysToDateOnly, instantToWallClock } from "@fixflow/shared";

/**
 * Where a visit goes on the grid (T19). Pure functions of the visit's instants and the business's
 * time zone: the zone of the browser never enters into it (BR-17), so a 10:00 visit on the business's
 * clocks is in the 10:00 row whoever looks at it, from wherever.
 *
 * The grid is a **wall-clock** grid: its rows are the hours the business's clocks read, so a visit
 * labelled 10:00 to 12:00 fills the 10 and 11 rows, always, even on a day the clocks change. (On such
 * a day an hour of the grid is missing or doubled in real time, which the grid does not try to draw.)
 */

export const MINUTES_PER_DAY = 24 * 60;

/** A visit shorter than this is still drawn this tall, so it can be read and pressed. */
export const MIN_BLOCK_MINUTES = 30;

/** The height of one hour row of the grid, in rem. The grid, its lines and a block's text all read it. */
export const HOUR_HEIGHT_REM = 3.5;

/** The vertical room a block's text has: its padding, and the height of one line of its text (both in rem). */
const BLOCK_PADDING_REM = 0.5;
const BLOCK_LINE_REM = 1;
const BLOCK_MAX_LINES = 4;

/**
 * How many whole lines of text fit a block that lasts `minutes`: a block shows the lines that fit and
 * no more, so a line is never cut in half. A half-hour block has room for one line (the time), an hour
 * for three (adding the reference and the service), an hour and a half for all four. Always at least one.
 */
export function visibleLineCount(minutes: number): number {
  const room = (minutes / 60) * HOUR_HEIGHT_REM - BLOCK_PADDING_REM;
  return Math.max(1, Math.min(BLOCK_MAX_LINES, Math.floor(room / BLOCK_LINE_REM)));
}

/** The hours the grid shows when nothing falls outside them: 07:00 to 20:00 (spec §9.2). */
export const DEFAULT_VISIBLE_HOURS = { startHour: 7, endHour: 20 } as const;

/** The part of a visit that falls on one business day. */
export interface VisitSegment {
  visitId: string;
  /** The business day, `YYYY-MM-DD`. */
  date: string;
  /** Minutes after midnight on the business's clocks, `0` to `1440`. */
  startMin: number;
  /** Minutes after midnight; at least {@link MIN_BLOCK_MINUTES} after the start, at most `1440`. */
  endMin: number;
  /** The visit began on an earlier day: this block is its continuation. */
  continuesFromPrevious: boolean;
  /** The visit goes on past midnight into the next day. */
  continuesIntoNext: boolean;
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * The parts of a visit, one for each business day it touches. A visit that starts at 23:00 and ends at
 * 01:00 the next day is two segments, `23:00–24:00` and `00:00–01:00` (it is clipped at midnight in
 * each day's column). A visit that ends exactly at midnight is one segment that ends at 24:00, with no
 * empty one on the next day.
 */
export function segmentsOf(
  visit: { id: string; start: string; end: string },
  timeZone: string,
): VisitSegment[] {
  const start = instantToWallClock(visit.start, timeZone);
  const end = instantToWallClock(visit.end, timeZone);
  const startMin = minutesOf(start.time);
  let endDate = end.date;
  let endMin = minutesOf(end.time);

  if (endDate < start.date) {
    // A damaged visit that ends before it starts is drawn as the shortest block, not dropped.
    endDate = start.date;
    endMin = startMin;
  }
  if (endDate > start.date && endMin === 0) {
    // Ending at midnight is the end of the previous day, not a zero-length block on the next.
    endDate = addDaysToDateOnly(endDate, -1);
    endMin = MINUTES_PER_DAY;
  }
  if (endDate === start.date && endMin <= startMin) {
    // Equal, or the end reads earlier because the clocks went back during the visit: use the real
    // length of the visit, floored at the shortest block.
    const real = Math.round((Date.parse(visit.end) - Date.parse(visit.start)) / 60_000);
    endMin = startMin + Math.max(real, MIN_BLOCK_MINUTES);
  }

  const segments: VisitSegment[] = [];
  let date = start.date;
  for (let guard = 0; guard < 8; guard += 1) {
    const first = date === start.date;
    const last = date === endDate;
    const from = first ? startMin : 0;
    const to = last ? endMin : MINUTES_PER_DAY;
    segments.push({
      visitId: visit.id,
      date,
      startMin: from,
      endMin: Math.min(MINUTES_PER_DAY, Math.max(to, from + MIN_BLOCK_MINUTES)),
      continuesFromPrevious: !first,
      continuesIntoNext: !last,
    });
    if (last) break;
    date = addDaysToDateOnly(date, 1);
  }
  return segments;
}

export interface VisibleHours {
  /** The first hour row, `0` to `23`. */
  startHour: number;
  /** The hour at which the grid ends, `1` to `24`: the last row is the one before it. */
  endHour: number;
}

/**
 * The hours the grid shows: 07:00 to 20:00, widened to whole hours that include any visit that starts
 * earlier or ends later, so no visit is ever cut off or hidden.
 */
export function visibleHoursFor(
  segments: readonly Pick<VisitSegment, "startMin" | "endMin">[],
  defaults: VisibleHours = DEFAULT_VISIBLE_HOURS,
): VisibleHours {
  let startHour = defaults.startHour;
  let endHour = defaults.endHour;
  for (const segment of segments) {
    startHour = Math.min(startHour, Math.floor(segment.startMin / 60));
    endHour = Math.max(endHour, Math.ceil(segment.endMin / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export interface BlockPosition {
  /** Percent of the column's height, from its top edge. */
  topPercent: number;
  heightPercent: number;
}

/** Where a segment sits in a column that shows `hours`. Percentages, so the column's height is CSS's. */
export function blockPosition(
  segment: Pick<VisitSegment, "startMin" | "endMin">,
  hours: VisibleHours,
): BlockPosition {
  const total = (hours.endHour - hours.startHour) * 60;
  const from = Math.max(segment.startMin, hours.startHour * 60);
  const to = Math.min(segment.endMin, hours.endHour * 60);
  return {
    topPercent: ((from - hours.startHour * 60) / total) * 100,
    heightPercent: (Math.max(to - from, 0) / total) * 100,
  };
}

/** The number of hour rows a column has. */
export function hourCount(hours: VisibleHours): number {
  return hours.endHour - hours.startHour;
}

export interface BlockColumn {
  /** The side-by-side slot this block takes, from `0`. */
  column: number;
  /** How many slots its cluster of overlapping blocks needs: the block is `1 / columns` wide. */
  columns: number;
}

/**
 * Lays out overlapping blocks side by side. Blocks that overlap in time, directly or through a chain
 * of others, form a **cluster**; the cluster is divided into as many equal columns as its busiest
 * moment needs, and each block takes the first column that is free when it starts. Blocks that only
 * touch (one ends when the next starts) do not overlap and can share a column. Blocks that overlap
 * nothing are one column wide, so they use the whole width.
 *
 * Deterministic: ties are broken by the earlier start, then the longer block, then the id, so the
 * same visits always land in the same columns and a re-render never shuffles them.
 */
export function layoutColumns(
  segments: readonly Pick<VisitSegment, "visitId" | "startMin" | "endMin">[],
): Map<string, BlockColumn> {
  const sorted = [...segments].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.visitId.localeCompare(b.visitId),
  );
  const result = new Map<string, BlockColumn>();

  let cluster: { visitId: string; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const member of cluster) {
      result.set(member.visitId, { column: member.column, columns: columnEnds.length });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    if (cluster.length > 0 && segment.startMin >= clusterEnd) {
      closeCluster();
    }
    let column = columnEnds.findIndex((end) => end <= segment.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(segment.endMin);
    } else {
      columnEnds[column] = segment.endMin;
    }
    cluster.push({ visitId: segment.visitId, column });
    clusterEnd = cluster.length === 1 ? segment.endMin : Math.max(clusterEnd, segment.endMin);
  }
  closeCluster();
  return result;
}
