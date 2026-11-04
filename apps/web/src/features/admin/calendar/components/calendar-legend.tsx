import { type CalendarItemDto, WorkOrderStatus } from "@fixflow/shared";

import { STATUS_ICONS } from "@/components/ui/status-badge";
import { TECHNICIAN_COLOR_STYLES } from "@/features/admin/lib/technician-colors";
import { getStatusMeta } from "@/lib/formatting/status";
import { cn } from "@/lib/utils";

import { visitLook } from "../lib/visit-text";
import type { LegendTechnician } from "../lib/visits";

export interface CalendarLegendProps {
  technicians: readonly LegendTechnician[];
  items: readonly CalendarItemDto[];
}

const STATUS_ORDER: readonly WorkOrderStatus[] = [
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.NEEDS_RESCHEDULING,
  WorkOrderStatus.CANCELLED,
];

/**
 * What the colours and the icons mean. A block's colour is its technician's; its icon is its status,
 * the same icon the status badge uses. The status key lists only the statuses that are on screen, so
 * a week of ordinary scheduled visits does not explain icons that are not there.
 */
export function CalendarLegend({ technicians, items }: CalendarLegendProps) {
  const present = new Set(items.map((item) => item.status));
  const statuses = STATUS_ORDER.filter((status) => present.has(status));
  if (technicians.length === 0 && statuses.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-8">
      {technicians.length === 0 ? null : (
        <ul aria-label="Technician colours" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {technicians.map((technician) => (
            <li key={technician.id} className="flex min-w-0 items-center gap-2 text-ink-secondary">
              <span
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  TECHNICIAN_COLOR_STYLES[technician.calendarColor].dot,
                )}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {technician.name}
                {technician.isActive ? "" : " (inactive)"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {statuses.length === 0 ? null : (
        <ul aria-label="Status icons" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {statuses.map((status) => {
            const Icon = STATUS_ICONS[visitLook(status).icon];
            return (
              <li key={status} className="flex items-center gap-1.5 text-ink-secondary">
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {getStatusMeta("workOrder", status).label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
