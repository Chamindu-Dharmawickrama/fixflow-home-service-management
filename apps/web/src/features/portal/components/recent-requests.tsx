import type { CustomerRequestListItemDto } from "@fixflow/shared";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";

import { requestPath, REQUESTS_PATH } from "../lib/requests-list";

export interface RecentRequestsProps {
  /** The latest few, newest first. */
  requests: readonly CustomerRequestListItemDto[];
  /** All the customer has, so the link can say there are more. */
  totalItems: number;
  timeZone: string;
}

/**
 * "Your requests" on the portal overview: the latest few with their status and what happens next,
 * a link to the whole list, and the way to send a new one. With none yet it says so and offers the
 * first one.
 */
export function RecentRequests({ requests, totalItems, timeZone }: RecentRequestsProps) {
  return (
    <Card aria-labelledby="recent-requests-heading" role="region">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle as="h2" id="recent-requests-heading">
          Your requests
        </CardTitle>
        {totalItems > 0 ? (
          <Link
            href={REQUESTS_PATH}
            className="rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            View all requests ({totalItems})
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {requests.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="flex items-start gap-2 text-sm text-ink-secondary">
              <ClipboardList aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              You haven&apos;t sent a request yet. Tell us what needs doing and we&apos;ll send you
              a written quotation.
            </p>
            <Link href={REQUEST_SERVICE_PATH} className={buttonVariants()}>
              <Plus aria-hidden="true" />
              Request a service
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id} className="relative flex flex-col gap-1 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={requestPath(request.id)}
                    className="font-medium text-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    <ReferenceText reference={request.reference} />{" "}
                    <span className="sr-only">for {request.serviceName}</span>
                  </Link>
                  <StatusBadge kind="request" status={request.status} />
                </div>
                <p className="text-sm text-ink">{request.serviceName}</p>
                <p className="text-sm text-ink-secondary">
                  Sent{" "}
                  <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />.{" "}
                  {request.nextStep}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
