import { type CustomerWorkOrderListItemDto, WorkOrderStatus } from "@fixflow/shared";
import Link from "next/link";

import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTimeRange, formatTimeZoneName } from "@/lib/formatting";

import { jobPath } from "../lib/jobs";

/**
 * A visit's window on the business's clocks: the day, then the time range and the zone's name.
 * Times are the business's, never the browser's (BR-17), so they read the same wherever the
 * customer is.
 */
export function VisitWindow({
  start,
  end,
  timeZone,
}: {
  start: string;
  end: string;
  timeZone: string;
}) {
  return (
    <span className="flex flex-col">
      <DateTimeText value={start} timeZone={timeZone} display="date" className="font-medium" />
      <span className="text-ink-secondary">
        {formatTimeRange(start, end, timeZone)} {formatTimeZoneName(start, timeZone)}
      </span>
    </span>
  );
}

/** What a card says in the place of a time, for a job that has none to show. */
function noTimeText(job: Pick<CustomerWorkOrderListItemDto, "status">): string {
  switch (job.status) {
    case WorkOrderStatus.NEEDS_RESCHEDULING:
      return "We are finding a new time";
    case WorkOrderStatus.CANCELLED:
      return "No visit will take place";
    default:
      return "Waiting for a time";
  }
}

/**
 * A job as a card: its reference (the link), its status, the service, the date and time of the
 * visit, and the technician's first name. The whole card is the link's target. A job with no time
 * says why in words rather than showing an empty line.
 */
export function JobCard({
  job,
  timeZone,
}: {
  job: CustomerWorkOrderListItemDto;
  timeZone: string;
}) {
  return (
    <li className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={jobPath(job.id)}
          className="font-medium text-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          <ReferenceText reference={job.reference} />{" "}
          <span className="sr-only">for {job.serviceName}</span>
        </Link>
        <StatusBadge kind="workOrder" status={job.status} />
      </div>
      <p className="min-w-0 text-base font-medium text-ink [overflow-wrap:anywhere]">
        {job.serviceName}
      </p>
      <p className="text-sm text-ink">
        {job.scheduledStart !== null && job.scheduledEnd !== null ? (
          <VisitWindow start={job.scheduledStart} end={job.scheduledEnd} timeZone={timeZone} />
        ) : (
          <span className="text-ink-secondary">{noTimeText(job)}</span>
        )}
      </p>
      {job.technician === null ? null : (
        <p className="text-sm text-ink-secondary">With {job.technician.displayName}</p>
      )}
      {job.completedAt === null ? null : (
        <p className="text-sm text-ink-secondary">
          Completed <DateTimeText value={job.completedAt} timeZone={timeZone} display="date" />
        </p>
      )}
    </li>
  );
}

/** A list of job cards. The caller names the list and decides what an empty one says. */
export function JobList({
  jobs,
  timeZone,
  label,
}: {
  jobs: readonly CustomerWorkOrderListItemDto[];
  timeZone: string;
  label: string;
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} timeZone={timeZone} />
      ))}
    </ul>
  );
}
