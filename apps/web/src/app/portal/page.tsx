import type { CustomerProfileDto, CustomerRequestListResponse } from "@fixflow/shared";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";
import { ProfileSummaryCard } from "@/features/portal/components/profile-summary-card";
import { RecentRequests } from "@/features/portal/components/recent-requests";
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
 * The customer's home (T05, T10, T11): a greeting, the way to send a request, the latest requests
 * and a summary of their profile. Quotations, jobs and invoices are added as they are built;
 * nothing here pretends otherwise.
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
  let timeZone: string;
  try {
    [profile, recent, { timeZone }] = await Promise.all([
      serverApiGet<CustomerProfileDto>("/customers/me"),
      serverApiGetEnvelope<CustomerRequestListResponse>(
        `/requests/me?${toApiQueryString({ status: undefined, page: 1 }, RECENT_REQUESTS_COUNT)}`,
      ),
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
      <RecentRequests
        requests={recent.data}
        totalItems={recent.pagination.totalItems}
        timeZone={timeZone}
      />
      <ProfileSummaryCard profile={profile} />
    </>
  );
}
