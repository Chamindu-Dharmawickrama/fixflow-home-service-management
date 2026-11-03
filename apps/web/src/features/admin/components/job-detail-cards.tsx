import type { AdminWorkOrderDto } from "@fixflow/shared";
import { ArrowRight, CalendarClock, Mail, Phone } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { DocumentLines, DocumentTotals } from "@/components/ui/document";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { formatAddressLines } from "@/features/portal/lib/format-address";
import { formatTimeZoneName } from "@/lib/formatting/datetime";
import { documentTotalRows } from "@/lib/formatting/document-totals";

import { adminCustomerPath } from "../lib/customers";
import { adminQuotationPath } from "../lib/quotations";
import { adminRequestPath } from "../lib/requests-queue";
import { formatDuration } from "../lib/schedule-form";
import { JobScheduleText } from "./job-schedule-text";
import { TechnicianName } from "./technicians-table";

interface CardProps {
  job: AdminWorkOrderDto;
  timeZone: string;
}

/** When the visit is and who is going, or a plain "not scheduled yet" that says what to do next. */
export function JobScheduleCard({ job, timeZone }: CardProps) {
  const { technician } = job;
  const scheduled = job.scheduledStart !== null && job.scheduledEnd !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Appointment</CardTitle>
        <CardDescription>
          Times are shown on the business&apos;s clocks ({timeZone}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {scheduled ? (
          <DescriptionList>
            <DescriptionItem term="When">
              <JobScheduleText
                start={job.scheduledStart}
                end={job.scheduledEnd}
                timeZone={timeZone}
              />
            </DescriptionItem>
            <DescriptionItem term="Length">
              {formatDuration(
                Math.round(
                  (Date.parse(job.scheduledEnd ?? "") - Date.parse(job.scheduledStart ?? "")) /
                    60_000,
                ),
              )}
            </DescriptionItem>
            <DescriptionItem term="Technician">
              {technician === null ? (
                <span className="text-ink-secondary">No technician</span>
              ) : (
                <span className="flex flex-col gap-1">
                  <TechnicianName name={technician.name} color={technician.calendarColor} />
                  {technician.isActive ? null : (
                    <span className="text-ink-secondary">
                      Inactive: reschedule to give the job to someone else.
                    </span>
                  )}
                  {technician.phone === null ? null : (
                    <a
                      href={`tel:${technician.phone}`}
                      className="inline-flex min-h-6 items-center gap-2 font-medium text-brand underline-offset-4 hover:underline"
                    >
                      <Phone aria-hidden="true" className="size-4 shrink-0" />
                      {technician.phone}
                    </a>
                  )}
                  {technician.email === null ? null : (
                    <a
                      href={`mailto:${technician.email}`}
                      className="inline-flex min-h-6 items-center gap-2 break-all font-medium text-brand underline-offset-4 hover:underline"
                    >
                      <Mail aria-hidden="true" className="size-4 shrink-0" />
                      {technician.email}
                    </a>
                  )}
                </span>
              )}
            </DescriptionItem>
            {job.startedAt === null ? null : (
              <DescriptionItem term="Started">
                <DateTimeText value={job.startedAt} timeZone={timeZone} />{" "}
                {formatTimeZoneName(job.startedAt, timeZone)}
              </DescriptionItem>
            )}
            {job.completedAt === null ? null : (
              <DescriptionItem term="Completed">
                <DateTimeText value={job.completedAt} timeZone={timeZone} />{" "}
                {formatTimeZoneName(job.completedAt, timeZone)}
              </DescriptionItem>
            )}
          </DescriptionList>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="flex items-center gap-2 text-base font-semibold text-ink">
              <CalendarClock aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
              Not scheduled yet
            </p>
            <p className="text-sm text-ink-secondary">
              {job.availableActions.includes("SCHEDULE")
                ? "Choose a day, a time and a technician. The customer is told the date and time as soon as you save."
                : "This job has no appointment."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What the job is for, and the work and prices the customer agreed to. */
export function JobScopeCard({ job }: Pick<CardProps, "job">) {
  const { quotation } = job;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Scope of work</CardTitle>
        <CardDescription>
          Written from the customer&apos;s request and the quotation they accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="whitespace-pre-line break-words text-sm text-ink">{job.scopeDescription}</p>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Accepted quotation{" "}
            <Link
              href={adminQuotationPath(quotation.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              <ReferenceText reference={quotation.reference} />
            </Link>
          </h3>
          <DocumentLines
            caption={`Lines of quotation ${quotation.reference}`}
            currencyCode={quotation.currencyCode}
            lines={quotation.lines.map((line) => ({
              id: line.id,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              taxable: line.taxable,
            }))}
          />
          <DocumentTotals
            currencyCode={quotation.currencyCode}
            rows={documentTotalRows(quotation, quotation.taxRate)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** Where the work is, with the access notes the technician needs at the door. */
export function JobAddressCard({ job }: Pick<CardProps, "job">) {
  const { address } = job;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Service address</CardTitle>
        <CardDescription>As it was when the customer made the request.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <address className="not-italic text-ink">
          {formatAddressLines(address).map((line) => (
            <span key={line} className="block break-words">
              {line}
            </span>
          ))}
        </address>
        {address.accessNotes ? (
          <p className="text-ink-secondary">
            <span className="font-medium text-ink">Access notes:</span>{" "}
            <span className="whitespace-pre-line break-words">{address.accessNotes}</span>
          </p>
        ) : (
          <p className="text-ink-secondary">No access notes.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Who the job is for and how to reach them, with the links back to where it came from. */
export function JobCustomerCard({ job }: Pick<CardProps, "job">) {
  const { customer } = job;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Customer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="break-words text-base font-semibold text-ink">{customer.name}</p>
          <a
            href={`mailto:${customer.email}`}
            className="inline-flex min-h-6 items-center gap-2 break-all text-sm font-medium text-brand underline-offset-4 hover:underline"
          >
            <Mail aria-hidden="true" className="size-4 shrink-0" />
            {customer.email}
          </a>
          {customer.phone ? (
            <a
              href={`tel:${customer.phone}`}
              className="inline-flex min-h-6 items-center gap-2 text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              <Phone aria-hidden="true" className="size-4 shrink-0" />
              {customer.phone}
            </a>
          ) : (
            <p className="text-sm text-ink-secondary">No phone number given.</p>
          )}
        </div>
        <Link
          href={adminCustomerPath(customer.id)}
          className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          View full customer history
          <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      </CardContent>
    </Card>
  );
}

/** The records this job came from. */
export function JobLinksCard({ job }: Pick<CardProps, "job">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Where it came from</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-secondary">Request</span>
            <Link
              href={adminRequestPath(job.request.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              <ReferenceText reference={job.request.reference} />
            </Link>
          </li>
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-secondary">Quotation</span>
            <Link
              href={adminQuotationPath(job.quotation.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              <ReferenceText reference={job.quotation.reference} />
            </Link>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** The job's history with the staff who acted and the internal wording; the customer sees a shorter one. */
export function JobHistoryCard({ job, timeZone }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
        <CardDescription>Everything that happened to this job, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="admin"
          events={job.timeline}
          timeZone={timeZone}
          label="Job history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}

/** The job's status as a badge, for places that need one beside text. */
export function JobStatus({ status }: { status: AdminWorkOrderDto["status"] }) {
  return <StatusBadge kind="workOrder" status={status} />;
}
