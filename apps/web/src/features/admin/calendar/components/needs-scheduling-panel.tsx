import { CALENDAR_RULES, type CalendarWaitingJobDto, WorkOrderStatus } from "@fixflow/shared";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { JOBS_PATH } from "@/features/admin/lib/jobs";
import { formatDate, formatTimeRange } from "@/lib/formatting/datetime";

export interface NeedsSchedulingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: readonly CalendarWaitingJobDto[];
  /** How many jobs wait in all; `jobs` holds at most {@link CALENDAR_RULES.maxNeedsScheduling}. */
  total: number;
  timeZone: string;
  /** Give this job a time: the parent closes the panel and opens the scheduling dialog. */
  onSchedule: (job: CalendarWaitingJobDto) => void;
  /** Focus goes back to the button that opened the panel (the parent knows it). */
  onClosed: () => void;
}

/**
 * Jobs that are waiting for a time (workflow 7.4): new ones, and those that need a new time, the
 * latter first. A side panel that slides in over the calendar (full width on a phone), so the grid
 * keeps its width. Each job has a "Schedule" button that opens the same scheduling dialog the job
 * page uses, with the same conflict checks.
 */
export function NeedsSchedulingPanel({
  open,
  onOpenChange,
  jobs,
  total,
  timeZone,
  onSchedule,
  onClosed,
}: NeedsSchedulingPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton
        className="w-full max-w-md overflow-y-auto p-5 sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <SheetHeader className="pr-8">
          <SheetTitle>Needs scheduling</SheetTitle>
          <SheetDescription className="text-ink-secondary">
            {total === 0
              ? "Every job has a time."
              : `${String(total)} ${total === 1 ? "job is" : "jobs are"} waiting for a time. Jobs that need a new time come first.`}
          </SheetDescription>
        </SheetHeader>

        {jobs.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            titleAs="h3"
            title="Nothing is waiting"
            description="Jobs appear here when a customer accepts a quotation, or when a visit has to be moved to a new time."
            className="px-4 py-8"
          />
        ) : (
          <ul aria-label="Jobs waiting for a time" className="flex flex-col gap-3">
            {jobs.map((job) => (
              <li
                key={job.id}
                data-testid="waiting-job"
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">
                    {job.reference}
                  </span>
                  <StatusBadge kind="workOrder" status={job.status} />
                </div>
                <p className="text-sm text-ink [overflow-wrap:anywhere]">
                  {job.serviceName} for {job.customerName}
                </p>
                <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{job.city}</p>
                {job.status === WorkOrderStatus.NEEDS_RESCHEDULING &&
                job.scheduledStart !== null &&
                job.scheduledEnd !== null ? (
                  <p className="text-sm text-ink-secondary">
                    Was booked for {formatDate(job.scheduledStart, timeZone)},{" "}
                    {formatTimeRange(job.scheduledStart, job.scheduledEnd, timeZone)}
                  </p>
                ) : null}
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Schedule ${job.reference} for ${job.customerName}`}
                    onClick={() => onSchedule(job)}
                  >
                    <CalendarPlus aria-hidden="true" />
                    Schedule
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {total > jobs.length ? (
          <p className="text-sm text-ink-secondary">
            Showing the first {String(CALENDAR_RULES.maxNeedsScheduling)} of {String(total)}.{" "}
            <Link
              href={`${JOBS_PATH}?view=needs-scheduling`}
              className="font-medium text-brand underline underline-offset-4"
            >
              See all of them in Jobs
            </Link>
            .
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
