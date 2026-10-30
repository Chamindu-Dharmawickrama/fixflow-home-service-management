import type { CustomerProfileDto } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { ProfileSummaryCard } from "@/features/portal/components/profile-summary-card";
import { serverApiGet } from "@/lib/api/server";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The interim customer home (T05, T10): a greeting and a summary of the customer's profile with
 * the way to edit it. Requests, quotations, jobs and invoices are added as they are built; nothing
 * here pretends otherwise.
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
  try {
    profile = await serverApiGet<CustomerProfileDto>("/customers/me");
  } catch (error) {
    return (
      <>
        <PageHeader title={`Hello, ${me.user.name}`} />
        {loadErrorState({
          error,
          title: "We couldn't load your profile",
          retryHref: "/portal",
        })}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Hello, ${me.user.name}`}
        description="This is your customer account. Your service requests, quotations and invoices will appear here as soon as those features are ready."
      />
      <ProfileSummaryCard profile={profile} />
    </>
  );
}
