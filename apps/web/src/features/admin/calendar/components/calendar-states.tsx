import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { JOBS_PATH } from "@/features/admin/lib/jobs";

import { type CalendarView, spanPhrase } from "../lib/dates";
import { HOUR_HEIGHT_REM } from "../lib/layout";

/**
 * A week or a day with nothing on it (FR-083). It says so, says how many jobs are waiting for a time
 * (the usual reason for an empty calendar), and links to them.
 */
export function CalendarEmpty({
  view,
  date,
  today,
  needsSchedulingTotal,
  filtered,
}: {
  view: CalendarView;
  date: string;
  today: string;
  needsSchedulingTotal: number;
  /** One technician's calendar is open: the others may have visits. */
  filtered: boolean;
}) {
  const waiting =
    needsSchedulingTotal === 0
      ? "Jobs appear here once they have a time and a technician."
      : `${String(needsSchedulingTotal)} ${needsSchedulingTotal === 1 ? "job is" : "jobs are"} waiting for a time.`;
  return (
    <EmptyState
      icon={CalendarDays}
      titleAs="h3"
      title={`No visits scheduled ${spanPhrase(view, date, today)}`}
      description={
        filtered ? `${waiting} Choose All technicians to see everyone's visits.` : waiting
      }
      action={
        needsSchedulingTotal === 0 ? undefined : (
          <Button asChild variant="outline">
            <Link href={`${JOBS_PATH}?view=needs-scheduling`}>See the jobs waiting for a time</Link>
          </Button>
        )
      }
    />
  );
}

/** More visits matched than one answer carries (500). Rare, but never silent. */
export function TruncatedNotice() {
  return (
    <FormAlert tone="info">
      This range has more visits than can be shown at once, so the latest ones are left out. Choose
      one technician, or the day view, to see the rest.
    </FormAlert>
  );
}

/** The calendar while its data or the window's width is loading: the toolbar's shape and an hour grid. */
export function CalendarSkeleton({ label = "Loading the calendar" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-10" />
        <Skeleton className="h-10 w-10" />
        <Skeleton className="h-7 w-48" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-52" />
      </div>
      <Skeleton
        className="w-full rounded-xl"
        style={{ height: `${String(HOUR_HEIGHT_REM * 8)}rem` }}
      />
    </div>
  );
}
