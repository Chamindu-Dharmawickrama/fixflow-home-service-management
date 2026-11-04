import type { CalendarItemDto } from "@fixflow/shared";

import { STATUS_ICONS } from "@/components/ui/status-badge";
import { TECHNICIAN_COLOR_STYLES } from "@/features/admin/lib/technician-colors";
import { cn } from "@/lib/utils";

import {
  type BlockColumn,
  blockPosition,
  type VisibleHours,
  visibleLineCount,
  type VisitSegment,
} from "../lib/layout";
import { visitAccessibleName, visitLook, visitTimeRange } from "../lib/visit-text";
import { businessDateOf } from "../lib/visits";

export interface VisitBlockProps {
  visit: CalendarItemDto;
  segment: VisitSegment;
  hours: VisibleHours;
  /** Which side-by-side slot the block takes, and how many slots its cluster has. */
  slot: BlockColumn;
  timeZone: string;
  onOpen: (visit: CalendarItemDto, trigger: HTMLButtonElement) => void;
}

/** The gap between two blocks side by side, and between a block and its column's edge. */
const GAP_PX = 2;

/**
 * One visit on the time grid. It is a button that opens the visit's drawer, positioned by the time the
 * business's clocks read and coloured by its technician (the colour pair keeps AA contrast, see
 * `tokens.test.ts`). The status is never carried by colour alone: an icon (the same one the badge
 * uses) sits beside the time, a cancelled visit is struck through, one that holds no time has a
 * dashed edge, and the accessible name ends with the status in words. Text that does not fit is
 * truncated; everything is in the drawer and in the name.
 */
export function VisitBlock({ visit, segment, hours, slot, timeZone, onOpen }: VisitBlockProps) {
  const { topPercent, heightPercent } = blockPosition(segment, hours);
  const look = visitLook(visit.status);
  const Icon = STATUS_ICONS[look.icon];
  const color =
    visit.technician === null ? null : TECHNICIAN_COLOR_STYLES[visit.technician.calendarColor];
  const width = 100 / slot.columns;
  // Only the lines that fit are drawn, so a short block never shows a line cut in half; the name and
  // the drawer carry the rest. The order is the order of the accessible name, so what is drawn is
  // always the start of it.
  const lines = visibleLineCount(segment.endMin - segment.startMin);

  return (
    <li
      className="absolute"
      style={{
        top: `${String(topPercent)}%`,
        height: `${String(heightPercent)}%`,
        left: `calc(${String(slot.column * width)}% + ${String(GAP_PX / 2)}px)`,
        width: `calc(${String(width)}% - ${String(GAP_PX)}px)`,
      }}
    >
      <button
        type="button"
        data-testid="visit-block"
        data-visit-id={visit.id}
        data-status={visit.status}
        data-start-minute={segment.startMin}
        data-end-minute={segment.endMin}
        aria-label={visitAccessibleName(visit, timeZone, (instant) =>
          businessDateOf(instant, timeZone),
        )}
        onClick={(event) => onOpen(visit, event.currentTarget)}
        className={cn(
          "flex h-full w-full flex-col overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-xs leading-4",
          "shadow-sm ring-1 ring-inset ring-border-strong/20 motion-safe:transition-shadow hover:shadow-md",
          color === null
            ? "border-border-strong bg-surface-muted text-ink"
            : [color.edge, color.block],
          look.dashed && "border-dashed",
          look.struck && "line-through",
          segment.continuesFromPrevious && "rounded-t-none",
          segment.continuesIntoNext && "rounded-b-none",
        )}
      >
        {/* The spaces between the lines are real text, which a flex container does not draw: they keep
            "12:00 PM" and "JOB-…" apart for anything that reads the text of the button, such as the
            check that the visible text is part of the name (WCAG 2.5.3). */}
        <span className="flex min-w-0 items-start gap-1 font-semibold">
          <Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 truncate">{visitTimeRange(visit, timeZone)}</span>
        </span>
        {lines >= 2 ? (
          <>
            {" "}
            <span className="block truncate font-medium">{visit.reference}</span>
          </>
        ) : null}
        {lines >= 3 ? (
          <>
            {" "}
            <span className="block truncate">{visit.serviceName}</span>
          </>
        ) : null}
        {lines >= 4 ? (
          <>
            {" "}
            <span className="block truncate">{visit.customerName}</span>
          </>
        ) : null}
      </button>
    </li>
  );
}
