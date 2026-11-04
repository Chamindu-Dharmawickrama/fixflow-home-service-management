import type { CustomerWorkOrderListItemDto } from "@fixflow/shared";
import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { JOBS_PATH } from "../lib/jobs";
import { JobList } from "./job-cards";

export interface UpcomingVisitsProps {
  /** The first few jobs that still have something to happen, the soonest visit first. */
  jobs: readonly CustomerWorkOrderListItemDto[];
  /** All the customer has under way, so the link can say there are more. */
  totalItems: number;
  timeZone: string;
}

/**
 * "Upcoming visits" on the portal overview: the booked visits first, then any job that is waiting
 * for a time, each with its date and time on the business's clocks. With none under way it says
 * what to expect rather than leaving a gap.
 */
export function UpcomingVisits({ jobs, totalItems, timeZone }: UpcomingVisitsProps) {
  return (
    <Card aria-labelledby="upcoming-visits-heading" role="region">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle as="h2" id="upcoming-visits-heading">
          Upcoming visits
        </CardTitle>
        {totalItems > 0 ? (
          <Link
            href={JOBS_PATH}
            className="rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            View all jobs
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {jobs.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-ink-secondary">
            <CalendarClock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            No visits are booked. When you accept a quotation we&apos;ll set up the job and book a
            time, and it will appear here.
          </p>
        ) : (
          <JobList jobs={jobs} timeZone={timeZone} label="Upcoming visits" />
        )}
      </CardContent>
    </Card>
  );
}
