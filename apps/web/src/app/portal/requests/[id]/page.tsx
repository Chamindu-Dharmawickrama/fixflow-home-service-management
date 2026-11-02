import type { CustomerRequestDto } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";
import { RequestConfirmation } from "@/features/portal/components/request-confirmation";
import {
  NextStepCard,
  RequestDetailsCard,
  RequestHistoryCard,
  RequestNotesCard,
} from "@/features/portal/components/request-details";
import { RequestQuotationsCard } from "@/features/portal/components/request-quotations-card";
import { requestPath, REQUESTS_PATH } from "@/features/portal/lib/requests-list";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import type { SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Request" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface RequestPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}

/**
 * One request in the customer's words (IA-C02, FR-022): its status and what happens next, its
 * quotation (T15), the details as sent, the notes the business chose to share, and the history.
 * Right after sending,
 * `?submitted=1` adds the confirmation. The API shows a customer only their own requests, so
 * someone else's id looks exactly like one that does not exist.
 */
export default function PortalRequestPage({ params, searchParams }: RequestPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequestContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RequestContent({ params, searchParams }: RequestPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const justSent = query.submitted === "1";

  let request: CustomerRequestDto;
  let timeZone: string;
  try {
    [request, { timeZone }] = await Promise.all([
      serverApiGet<CustomerRequestDto>(`/requests/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there, or not yours) and 422 (not an id) both mean there is nothing to show; the
    // answer is the same for both so an id cannot be probed.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that request"
          description="The link may be wrong, or the request may not be on your account. You can see every request you have sent in your list."
          action={
            <Link href={REQUESTS_PATH} className={buttonVariants({ variant: "outline" })}>
              View your requests
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this request",
      retryHref: requestPath(id),
    });
  }

  // Right after sending, the confirmation offers "Request another service" itself.
  const showConfirmation = justSent && request.status === "SUBMITTED";

  return (
    <>
      <PageHeader
        title={request.reference}
        status={<StatusBadge kind="request" status={request.status} />}
        breadcrumbs={[{ label: "Requests", href: REQUESTS_PATH }, { label: request.reference }]}
        meta={
          <>
            <span>{request.serviceName}</span>
            <span>
              Sent <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />
            </span>
          </>
        }
        actions={
          showConfirmation ? undefined : (
            <Link href={REQUEST_SERVICE_PATH} className={buttonVariants({ variant: "outline" })}>
              Request another service
            </Link>
          )
        }
      />

      {showConfirmation ? <RequestConfirmation reference={request.reference} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <NextStepCard request={request} />
          <RequestQuotationsCard
            quotations={request.quotations}
            timeZone={timeZone}
            now={new Date()}
          />
          <RequestDetailsCard request={request} timeZone={timeZone} />
          <RequestNotesCard request={request} timeZone={timeZone} />
        </div>
        <RequestHistoryCard request={request} timeZone={timeZone} />
      </div>
    </>
  );
}
