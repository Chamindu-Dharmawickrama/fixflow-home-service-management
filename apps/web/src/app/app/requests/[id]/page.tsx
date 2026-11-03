import { type AdminRequestDto, QuotationStatus } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { RequestActions } from "@/features/admin/components/request-actions";
import {
  AdminRequestDetailsCard,
  AdminRequestHistoryCard,
  RequestCancellationCard,
  RequestCustomerCard,
} from "@/features/admin/components/request-detail-cards";
import { RequestNotesPanel } from "@/features/admin/components/request-notes-panel";
import { RequestQuotationsCard } from "@/features/admin/components/request-quotations-card";
import { adminRequestPath, QUEUE_PATH } from "@/features/admin/lib/requests-queue";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Request" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface RequestPageProps {
  params: Promise<{ id: string }>;
}

/**
 * One request in the business's view (IA-A03, FR-024, FR-025): the customer and what they asked
 * for, the actions the server allows, the notes (internal and shared) and the full history. What
 * the customer sees of all this is on their own page; nothing here is ever served to them.
 */
export default function AdminRequestPage({ params }: RequestPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequestContent params={params} />
    </Suspense>
  );
}

async function RequestContent({ params }: RequestPageProps) {
  const { id } = await params;

  let request: AdminRequestDto;
  let timeZone: string;
  try {
    [request, { timeZone }] = await Promise.all([
      serverApiGet<AdminRequestDto>(`/admin/requests/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that request"
          description="The link may be wrong, or the request may no longer exist. You can find every request in the queue."
          action={
            <Link href={QUEUE_PATH} className={buttonVariants({ variant: "outline" })}>
              Back to the queue
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this request",
      retryHref: adminRequestPath(id),
    });
  }

  return (
    <>
      <PageHeader
        title={request.reference}
        status={<StatusBadge kind="request" status={request.status} />}
        breadcrumbs={[{ label: "Requests", href: QUEUE_PATH }, { label: request.reference }]}
        meta={
          <>
            <span>{request.serviceName}</span>
            <span>{request.customer.name}</span>
            <span>
              Submitted{" "}
              <DateTimeText value={request.submittedAt} timeZone={timeZone} display="date" />
            </span>
          </>
        }
        actions={
          <RequestActions
            requestId={request.id}
            reference={request.reference}
            customerName={request.customer.name}
            status={request.status}
            actions={request.availableActions}
            acceptedQuotationId={
              request.quotations.find((quotation) => quotation.status === QuotationStatus.ACCEPTED)
                ?.id ?? null
            }
          />
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <AdminRequestDetailsCard request={request} timeZone={timeZone} />
          <RequestQuotationsCard request={request} timeZone={timeZone} />
          {request.cancellation ? (
            <RequestCancellationCard cancellation={request.cancellation} timeZone={timeZone} />
          ) : null}
          <RequestNotesPanel requestId={request.id} notes={request.notes} timeZone={timeZone} />
        </div>
        <div className="flex flex-col gap-6">
          <RequestCustomerCard request={request} timeZone={timeZone} />
          <AdminRequestHistoryCard request={request} timeZone={timeZone} />
        </div>
      </div>
    </>
  );
}
