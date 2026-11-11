import type { DashboardJobDto } from "@fixflow/shared";
import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { formatDate, formatTimeRange } from "@/lib/formatting";

import { CALENDAR_PATH } from "../../calendar/lib/calendar-url";
import { JOBS_PATH } from "../../lib/jobs";

const LINK =
  "rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover";

export interface UpcomingScheduleProps {
  jobs: readonly DashboardJobDto[];
  timeZone: string;
  /** Today on the business's calendar, `YYYY-MM-DD`: a visit today reads "Today" instead of a date. */
  today: string;
}

/**
 * "Upcoming schedule" (FR-082): the next visits in order, each with its time on the business's
 * clocks, the job, the customer's name, the service and the technician, and links to the calendar and
 * the jobs list. A visit under way stays until it ends.
 */
export function UpcomingSchedule({ jobs, timeZone, today }: UpcomingScheduleProps) {
  return (
    <Card aria-labelledby="schedule-heading" role="region" data-testid="upcoming-schedule">
      <CardHeader>
        <CardTitle as="h2" id="schedule-heading">
          Upcoming schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-ink-secondary">
            <CalendarDays aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            No visits are booked. Jobs that are waiting for a time are listed under Needs attention.
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Next visits">
            {jobs.map((job) => {
              const isToday =
                formatDate(job.scheduledStart, timeZone) === formatDate(today, timeZone);
              return (
                <li key={job.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-ink">
                    {isToday ? (
                      "Today"
                    ) : (
                      <DateTimeText value={job.scheduledStart} timeZone={timeZone} display="date" />
                    )}
                    {" · "}
                    <span className="tabular-nums">
                      {formatTimeRange(job.scheduledStart, job.scheduledEnd, timeZone)}
                    </span>
                  </p>
                  <p className="min-w-0 text-sm text-ink-secondary [overflow-wrap:anywhere]">
                    <Link href={job.link} className={LINK}>
                      <ReferenceText reference={job.reference} />
                    </Link>{" "}
                    · {job.customerName} · {job.serviceName}
                    {job.technicianName === null ? "" : ` · ${job.technicianName}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Link href={CALENDAR_PATH} className={LINK}>
          Open the calendar
        </Link>
        <Link href={JOBS_PATH} className={LINK}>
          All jobs
        </Link>
      </CardFooter>
    </Card>
  );
}
