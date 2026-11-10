import type {
  CustomerInvoiceListResponse,
  CustomerProfileDto,
  CustomerQuotationListResponse,
  CustomerRequestListResponse,
  CustomerWorkOrderListResponse,
} from "@fixflow/shared";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";
import { AwaitingDecision } from "@/features/portal/components/awaiting-decision";
import { OutstandingInvoices } from "@/features/portal/components/outstanding-invoices";
import { ProfileSummaryCard } from "@/features/portal/components/profile-summary-card";
import { RecentRequests } from "@/features/portal/components/recent-requests";
import { UpcomingVisits } from "@/features/portal/components/upcoming-visits";
import { outstandingApiQuery } from "@/features/portal/lib/invoices";
import { homeUpcomingQuery } from "@/features/portal/lib/jobs";
import { AWAITING_DECISION_COUNT } from "@/features/portal/lib/quotations";
import { RECENT_REQUESTS_COUNT, toApiQueryString } from "@/features/portal/lib/requests-list";
import { serverApiGet, serverApiGetEnvelope } from "@/lib/api/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getPublicSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Overview" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The customer's home (T05, T10, T11, T15, T18): a greeting, the way to send a request, the
 * quotations awaiting their decision, the invoices they still owe on (T22), their upcoming visits,
 * the latest requests and a summary of their profile.
 */
export default function PortalHomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PortalHomeContent />
    </Suspense>
  );
}

async function PortalHomeContent() {
  const me = await getCurrentUser();
  if (me === null) {
    return null; // The layout has already redirected a visitor without a session.
  }

  let profile: CustomerProfileDto;
  let recent: CustomerRequestListResponse;
  let awaiting: CustomerQuotationListResponse;
  let upcoming: CustomerWorkOrderListResponse;
  let outstanding: CustomerInvoiceListResponse;
  let timeZone: string;
  try {
    [profile, recent, awaiting, upcoming, outstanding, { timeZone }] = await Promise.all([
      serverApiGet<CustomerProfileDto>("/customers/me"),
      serverApiGetEnvelope<CustomerRequestListResponse>(
        `/requests/me?${toApiQueryString({ status: undefined, page: 1 }, RECENT_REQUESTS_COUNT)}`,
      ),
      // The quotations still open to an answer, the soonest to run out first (T15).
      serverApiGetEnvelope<CustomerQuotationListResponse>(
        `/quotations/me?status=SENT&pageSize=${AWAITING_DECISION_COUNT}`,
      ),
      // The first few jobs with something still to happen: a booked visit, then a job awaiting a time.
      serverApiGetEnvelope<CustomerWorkOrderListResponse>(`/work-orders/me?${homeUpcomingQuery()}`),
      // The invoices that still owe money, the soonest due first (T22).
      serverApiGetEnvelope<CustomerInvoiceListResponse>(`/invoices/me?${outstandingApiQuery()}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title={`Hello, ${me.user.name}`} />
        {loadErrorState({
          error,
          title: "We couldn't load your account",
          retryHref: "/portal",
        })}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Hello, ${me.user.name}`}
        description="Send a service request, follow its progress and keep your details up to date."
        actions={
          <Link href={REQUEST_SERVICE_PATH} className={buttonVariants({ variant: "primary" })}>
            <Plus aria-hidden="true" />
            Request a service
          </Link>
        }
      />
      <AwaitingDecision quotations={awaiting.data} timeZone={timeZone} now={new Date()} />
      <OutstandingInvoices
        invoices={outstanding.data}
        totalItems={outstanding.pagination.totalItems}
        timeZone={timeZone}
      />
      <UpcomingVisits
        jobs={upcoming.data}
        totalItems={upcoming.pagination.totalItems}
        timeZone={timeZone}
      />
      <RecentRequests
        requests={recent.data}
        totalItems={recent.pagination.totalItems}
        timeZone={timeZone}
      />
      <ProfileSummaryCard profile={profile} />
    </>
  );
}
