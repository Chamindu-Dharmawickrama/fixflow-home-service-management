import {
  type AdminTechnicianDto,
  TECHNICIAN_AVAILABILITY_DAYS,
  TECHNICIAN_UPCOMING_DAYS,
  type TechnicianAssignmentDto,
  type TechnicianAvailabilityDayDto,
} from "@fixflow/shared";
import { CalendarClock, Mail, Phone } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeRange } from "@/lib/formatting/datetime";
import { cn } from "@/lib/utils";

import { TECHNICIAN_COLOR_STYLES } from "../lib/technician-colors";
import {
  dayTileLines,
  firstNameOf,
  formatBookedTime,
  keepMeridiemTogether,
} from "../lib/technicians";
import { SpecialtyTags } from "./specialty-tags";

/** How to reach the technician and what they work on: the details the admin keeps. */
export function TechnicianDetailsCard({ technician }: { technician: AdminTechnicianDto }) {
  const color = TECHNICIAN_COLOR_STYLES[technician.calendarColor];
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Details</CardTitle>
        <CardDescription className="break-words">
          For your team only. {firstNameOf(technician.name)} cannot sign in, and customers see just
          their name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="Phone">
            {technician.phone === null ? (
              <span className="text-ink-secondary">Not added</span>
            ) : (
              <a
                href={`tel:${technician.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-1.5 text-brand underline-offset-4 hover:underline"
              >
                <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                {technician.phone}
              </a>
            )}
          </DescriptionItem>
          <DescriptionItem term="Email">
            {technician.email === null ? (
              <span className="text-ink-secondary">Not added</span>
            ) : (
              <a
                href={`mailto:${technician.email}`}
                className="inline-flex items-center gap-1.5 break-all text-brand underline-offset-4 hover:underline"
              >
                <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                {technician.email}
              </a>
            )}
          </DescriptionItem>
          <DescriptionItem term="Specialties">
            {technician.specialties.length === 0 ? (
              <span className="text-ink-secondary">None added</span>
            ) : (
              <SpecialtyTags tags={technician.specialties} />
            )}
          </DescriptionItem>
          <DescriptionItem term="Calendar colour">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={cn("size-4 shrink-0 rounded-full", color.dot)} />
              {color.label}
            </span>
          </DescriptionItem>
          <DescriptionItem term="Notes">
            {technician.notes === null ? (
              <span className="text-ink-secondary">No notes</span>
            ) : (
              <span className="whitespace-pre-line">{technician.notes}</span>
            )}
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/**
 * The next seven days, a tile for each: how much of the day is already booked, from the real jobs.
 * It is booked time only: FixFlow does not know when anyone works (D-39), so a free day means
 * nothing is scheduled, not that the technician is working.
 */
export function AvailabilityCard({ days }: { days: readonly TechnicianAvailabilityDayDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Next {TECHNICIAN_AVAILABILITY_DAYS} days</CardTitle>
        <CardDescription>
          Time already scheduled each day. Working hours are not tracked, so “Free” means nothing is
          booked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Four to a row, not seven: beside the details a week is narrower than "2 h 30 min" needs. */}
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {days.map((day, index) => {
            const booked = day.scheduledMinutes > 0;
            const { heading, date } = dayTileLines(day, index);
            return (
              <li
                key={day.date}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-lg border p-3",
                  booked ? "border-brand bg-brand-soft" : "border-border bg-surface",
                )}
              >
                <time dateTime={day.date} className="flex flex-col text-xs text-ink-secondary">
                  <span className="font-medium text-ink">{heading}</span>{" "}
                  <span className="whitespace-nowrap">{date}</span>
                </time>
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    booked ? "text-brand" : "text-ink-secondary",
                  )}
                >
                  {formatBookedTime(day.scheduledMinutes)}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function assignmentColumns(timeZone: string): DataTableColumn<TechnicianAssignmentDto>[] {
  return [
    {
      id: "reference",
      header: "Job",
      primary: true,
      cell: (job) => <ReferenceText reference={job.reference} />,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (job) => <span className="break-words">{job.customerName}</span>,
    },
    {
      id: "service",
      header: "Service",
      cell: (job) => <span className="break-words">{job.serviceName}</span>,
    },
    {
      id: "when",
      header: "When",
      cell: (job) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(job.scheduledStart, timeZone)}</span>
          <span className="text-xs text-ink-secondary">
            {keepMeridiemTogether(formatTimeRange(job.scheduledStart, job.scheduledEnd, timeZone))}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (job) => <StatusBadge kind="workOrder" status={job.status} />,
    },
  ];
}

/**
 * The jobs that still have to happen in the next 14 days, soonest first: scheduled ones and ones
 * under way (D-103). Jobs are not links yet; the job pages come with the work-order screens.
 */
export function UpcomingAssignmentsCard({
  technician,
  timeZone,
}: {
  technician: AdminTechnicianDto;
  timeZone: string;
}) {
  const { upcomingAssignments, name, isActive } = technician;
  return (
    <section aria-labelledby="upcoming-jobs" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="upcoming-jobs" className="text-lg font-semibold text-ink">
          Upcoming jobs
        </h2>
        <p className="break-words text-sm text-ink-secondary">
          Scheduled or in progress, starting in the next {TECHNICIAN_UPCOMING_DAYS} days.
          {!isActive && upcomingAssignments.length > 0
            ? ` ${firstNameOf(name)} is inactive; these jobs stay assigned until you reassign them.`
            : null}
        </p>
      </div>
      {upcomingAssignments.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          titleAs="h3"
          title="No upcoming jobs"
          description={
            isActive
              ? `When a job is scheduled with ${firstNameOf(name)}, it appears here.`
              : `${firstNameOf(name)} has no jobs coming up and is not offered for new ones.`
          }
        />
      ) : (
        <DataTable<TechnicianAssignmentDto>
          caption={`Upcoming jobs for ${name}`}
          rows={upcomingAssignments}
          getRowId={(job) => job.reference}
          columns={assignmentColumns(timeZone)}
        />
      )}
    </section>
  );
}
