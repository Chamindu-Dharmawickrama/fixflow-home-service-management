import { type CustomerRequestDto, PREFERRED_WINDOWS } from "@fixflow/shared";
import { MessageSquare } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { formatDate, formatTimeRange, formatTimeZoneName } from "@/lib/formatting";

import { formatAddressLines } from "../lib/format-address";

/**
 * The preferred window as the customer will read it, on the business's clock:
 * `Morning · Mar 10, 2026, 8:00 AM – 12:00 PM EDT`. The stored instants are converted here with the
 * business time zone, never the browser's, so it reads the same wherever the customer is.
 */
export function formatPreferredTime(
  request: Pick<CustomerRequestDto, "preferredStart" | "preferredEnd" | "preferredWindow">,
  timeZone: string,
): string {
  const { preferredStart, preferredEnd, preferredWindow } = request;
  const day = formatDate(preferredStart, timeZone);
  const hours = formatTimeRange(preferredStart, preferredEnd, timeZone);
  const zone = formatTimeZoneName(preferredStart, timeZone);
  return `${PREFERRED_WINDOWS[preferredWindow].label} · ${day}, ${hours} ${zone}`;
}

/** "What happens next": the sentence for the request's status, and what the preferred time means. */
export function NextStepCard({ request }: { request: CustomerRequestDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">What happens next</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-base text-ink">{request.nextStep}</p>
        {request.status === "SUBMITTED" || request.status === "UNDER_REVIEW" ? (
          <p className="text-sm text-ink-secondary">
            The time you asked for is a preference. We&apos;ll confirm the exact time with you
            before any work is scheduled.
          </p>
        ) : null}
        {request.cancellation?.message ? (
          <div className="mt-1 rounded-lg border border-border bg-surface-muted p-3">
            <p className="text-xs font-medium text-ink-secondary">Message from us</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-ink">
              {request.cancellation.message}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The request as it was made: service, problem, address and the time asked for. */
export function RequestDetailsCard({
  request,
  timeZone,
}: {
  request: CustomerRequestDto;
  timeZone: string;
}) {
  const { address } = request;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Request details</CardTitle>
        <CardDescription>Exactly what you sent us.</CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="Service">{request.serviceName}</DescriptionItem>
          <DescriptionItem term="Problem">
            <span className="whitespace-pre-line">{request.description}</span>
          </DescriptionItem>
          <DescriptionItem term="Service address">
            <address className="not-italic">
              {formatAddressLines(address).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            {address.accessNotes ? (
              <p className="mt-2 text-ink-secondary">
                <span className="font-medium text-ink">Access notes:</span>{" "}
                <span className="whitespace-pre-line">{address.accessNotes}</span>
              </p>
            ) : null}
          </DescriptionItem>
          <DescriptionItem term="Preferred time">
            {formatPreferredTime(request, timeZone)}
          </DescriptionItem>
          <DescriptionItem term="Sent">
            <DateTimeText value={request.submittedAt} timeZone={timeZone} />
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** Notes the business chose to show the customer. Internal notes are never in the data. */
export function RequestNotesCard({
  request,
  timeZone,
}: {
  request: CustomerRequestDto;
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Messages from us</CardTitle>
      </CardHeader>
      <CardContent>
        {request.notes.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            No messages yet. If we need anything from you, it will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {request.notes.map((note) => (
              <li key={note.id} className="flex gap-3">
                <MessageSquare aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="whitespace-pre-line break-words text-sm text-ink">{note.body}</p>
                  <p className="text-xs text-ink-muted">
                    {note.author} · <DateTimeText value={note.createdAt} timeZone={timeZone} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The history of the request, written for the customer. */
export function RequestHistoryCard({
  request,
  timeZone,
}: {
  request: CustomerRequestDto;
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="customer"
          events={request.timeline}
          timeZone={timeZone}
          label="Request history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}
