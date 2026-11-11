import type { CustomerOverviewDto, CustomerProfileDto } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { PortalOverview } from "@/features/portal/components/portal-overview";
import { serverApiGet } from "@/lib/api/server";
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
 * The customer's home (IA-C01, T05, T10, T11, T15, T18, T22, T23): the way to send a request, what
 * needs the customer (quotations to answer, invoices to pay), their upcoming visits, the latest
 * requests and a summary of their profile. The overview is one call, `GET /customers/me/overview`.
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
  let overview: CustomerOverviewDto;
  let timeZone: string;
  try {
    [profile, overview, { timeZone }] = await Promise.all([
      serverApiGet<CustomerProfileDto>("/customers/me"),
      serverApiGet<CustomerOverviewDto>("/customers/me/overview"),
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
    <PortalOverview
      name={me.user.name}
      overview={overview}
      profile={profile}
      timeZone={timeZone}
      now={new Date()}
    />
  );
}
