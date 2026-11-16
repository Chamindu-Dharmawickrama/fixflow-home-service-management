import type { AdminRequestCancellationDto, AdminRequestDto } from "@fixflow/shared";
import { ArrowRight, Mail, Phone } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { formatPreferredTime } from "@/features/portal/components/request-details";
import { formatAddressLines } from "@/features/portal/lib/format-address";

import { adminCustomerPath } from "../lib/customers";
import { adminRequestPath } from "../lib/requests-queue";

interface CardProps {
  request: AdminRequestDto;
  timeZone: string;
}

/** The request as the customer made it: service, problem, address and the time they asked for. */
export function AdminRequestDetailsCard({ request, timeZone }: CardProps) {
  const { address } = request;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Request details</CardTitle>
        <CardDescription>Exactly what the customer sent.</CardDescription>
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
            <span className="mt-1 block text-ink-secondary">
              A preference, not a booking: confirm the exact time with the customer first.
            </span>
          </DescriptionItem>
          <DescriptionItem term="Submitted">
            <DateTimeText value={request.submittedAt} timeZone={timeZone} />
          </DescriptionItem>
          <DescriptionItem term="Last updated">
            <DateTimeText value={request.updatedAt} timeZone={timeZone} />
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** Who sent the request and how to reach them, with what else they have asked for. */
export function RequestCustomerCard({ request, timeZone }: CardProps) {
  const { customer } = request;
  const others = customer.totalRequests - 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Customer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
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

        <p className="text-sm text-ink-secondary">
          {others === 0
            ? "This is their first request."
            : `${others} other ${others === 1 ? "request" : "requests"} from this customer.`}{" "}
          {customer.workOrderCount} {customer.workOrderCount === 1 ? "job" : "jobs"},{" "}
          {customer.invoiceCount} {customer.invoiceCount === 1 ? "invoice" : "invoices"}.
        </p>

        <Link
          href={adminCustomerPath(customer.id)}
          className="inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          View full customer history
          <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>

        {customer.previousRequests.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Earlier requests</h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {customer.previousRequests.map((previous) => (
                <li key={previous.id} className="relative flex flex-col gap-1 p-3 text-sm">
                  <Link
                    href={adminRequestPath(previous.id)}
                    className="font-medium text-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    <ReferenceText reference={previous.reference} />{" "}
                    <span className="sr-only">for {previous.serviceName}</span>
                  </Link>
                  <span className="text-ink-secondary">{previous.serviceName}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge kind="request" status={previous.status} />
                    <span className="text-xs text-ink-muted">
                      <DateTimeText
                        value={previous.submittedAt}
                        timeZone={timeZone}
                        display="date"
                      />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Why and by whom a request was cancelled, and what the customer was told. */
export function RequestCancellationCard({
  cancellation,
  timeZone,
}: {
  cancellation: AdminRequestCancellationDto;
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Cancellation</CardTitle>
        <CardDescription>This request was closed and cannot be reopened.</CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="Cancelled">
            <DateTimeText value={cancellation.cancelledAt} timeZone={timeZone} />
            {cancellation.cancelledBy ? ` by ${cancellation.cancelledBy.name}` : null}
          </DescriptionItem>
          <DescriptionItem term="Reason (internal)">
            <span className="whitespace-pre-line break-words">{cancellation.reason}</span>
          </DescriptionItem>
          <DescriptionItem term="Message to the customer">
            {cancellation.customerMessage ? (
              <span className="whitespace-pre-line break-words">
                {cancellation.customerMessage}
              </span>
            ) : (
              <span className="text-ink-secondary">
                None written. The customer saw the standard wording.
              </span>
            )}
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** The history with the staff who acted and the internal wording; the customer sees a shorter one. */
export function AdminRequestHistoryCard({ request, timeZone }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
        <CardDescription>Everything that happened, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="admin"
          events={request.timeline}
          timeZone={timeZone}
          label="Request history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}
