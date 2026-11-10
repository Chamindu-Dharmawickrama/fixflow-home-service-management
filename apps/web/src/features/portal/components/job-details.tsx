import { type CustomerWorkOrderDto, WorkOrderStatus } from "@fixflow/shared";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { formatTimeZoneName } from "@/lib/formatting";

import { formatAddressLines } from "../lib/format-address";
import { portalInvoicePath } from "../lib/invoices";
import { portalQuotationPath } from "../lib/quotations";
import { requestPath } from "../lib/requests-list";
import { VisitWindow } from "./job-cards";

interface CardProps {
  job: CustomerWorkOrderDto;
}

/**
 * "Where things stand": the status, what it means in plain words, and the facts that go with it. Only
 * what was recorded is said: a job is "started" only once the business recorded the start, and the
 * old time of a job that needs a new one is labelled as history, not as a booking.
 */
export function JobStatusCard({ job }: CardProps) {
  const { timeZone } = job;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Where things stand</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-base text-ink">{job.statusExplanation}</p>

        {job.startedAt !== null && job.status === WorkOrderStatus.IN_PROGRESS ? (
          <p className="text-sm text-ink-secondary">
            Work started <DateTimeText value={job.startedAt} timeZone={timeZone} />{" "}
            {formatTimeZoneName(job.startedAt, timeZone)}.
          </p>
        ) : null}
        {job.completedAt !== null && job.status === WorkOrderStatus.COMPLETED ? (
          <p className="text-sm text-ink-secondary">
            Completed <DateTimeText value={job.completedAt} timeZone={timeZone} />{" "}
            {formatTimeZoneName(job.completedAt, timeZone)}.
          </p>
        ) : null}
        {job.cancelledAt !== null && job.status === WorkOrderStatus.CANCELLED ? (
          <p className="text-sm text-ink-secondary">
            Cancelled <DateTimeText value={job.cancelledAt} timeZone={timeZone} />{" "}
            {formatTimeZoneName(job.cancelledAt, timeZone)}.
          </p>
        ) : null}
        {job.previouslyScheduled === null ? null : (
          <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
            <p className="font-medium text-ink">Previously booked</p>
            <p className="mt-1 text-ink-secondary">
              <VisitWindow
                start={job.previouslyScheduled.start}
                end={job.previouslyScheduled.end}
                timeZone={timeZone}
              />
            </p>
            <p className="mt-1 text-ink-secondary">
              {job.status === WorkOrderStatus.NEEDS_RESCHEDULING
                ? "That time no longer applies."
                : "That visit will not take place."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The visit in four plain questions: what, when, where, and who. */
export function JobVisitCard({ job }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Your visit</CardTitle>
        <CardDescription>Times are shown on {job.timeZone} clocks.</CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="What">
            <span className="flex flex-col gap-2">
              <span className="font-medium">{job.serviceName}</span>
              <span className="whitespace-pre-line break-words text-ink-secondary">
                {job.scopeDescription}
              </span>
            </span>
          </DescriptionItem>
          <DescriptionItem term="When">
            {job.scheduledStart !== null && job.scheduledEnd !== null ? (
              <VisitWindow
                start={job.scheduledStart}
                end={job.scheduledEnd}
                timeZone={job.timeZone}
              />
            ) : (
              <span className="text-ink-secondary">
                {job.status === WorkOrderStatus.CANCELLED
                  ? "No visit will take place."
                  : "No time is booked yet."}
              </span>
            )}
          </DescriptionItem>
          <DescriptionItem term="Where">
            <address className="not-italic">
              {formatAddressLines(job.address).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            {job.address.accessNotes ? (
              <p className="mt-2 text-ink-secondary">
                <span className="font-medium text-ink">Access notes:</span>{" "}
                <span className="whitespace-pre-line">{job.address.accessNotes}</span>
              </p>
            ) : null}
          </DescriptionItem>
          <DescriptionItem term="Who">
            {job.technician === null ? (
              <span className="text-ink-secondary">
                We will tell you who is coming once your visit is booked.
              </span>
            ) : (
              job.technician.displayName
            )}
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** What was done, in the words the business wrote for the customer. Only a completed job has one. */
export function JobCompletionCard({ job }: CardProps) {
  if (job.status !== WorkOrderStatus.COMPLETED) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">What we did</CardTitle>
      </CardHeader>
      <CardContent>
        {job.completionNote === null ? (
          <p className="text-sm text-ink-secondary">
            The work is finished. No further details were written.
          </p>
        ) : (
          <p className="whitespace-pre-line break-words text-sm text-ink">{job.completionNote}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Everything that happened to the job, in the customer's words. */
export function JobHistoryCard({ job }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="customer"
          events={job.timeline}
          timeZone={job.timeZone}
          label="Job history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}

const LINK_CLASS =
  "inline-flex min-h-6 items-center gap-1.5 font-medium text-brand underline-offset-4 hover:underline";

/** Where the job came from, so the customer can go back to the request and the quotation they accepted. */
export function JobLinksCard({ job }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Where it came from</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-secondary">Request</span>
            <Link href={requestPath(job.request.id)} className={LINK_CLASS}>
              <ReferenceText reference={job.request.reference} />
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </li>
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-secondary">Quotation</span>
            <Link href={portalQuotationPath(job.quotation.id)} className={LINK_CLASS}>
              <ReferenceText reference={job.quotation.reference} />
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </li>
          {job.invoice === null ? null : (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-ink-secondary">Invoice</span>
              <Link href={portalInvoicePath(job.invoice.id)} className={LINK_CLASS}>
                <ReferenceText reference={job.invoice.invoiceNumber} />
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
              <StatusBadge kind="invoice" status={job.invoice.status} />
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
