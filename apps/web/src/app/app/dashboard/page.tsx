import type { AdminDashboardSummaryDto } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { DashboardSkeleton } from "@/features/admin/dashboard/components/dashboard-skeleton";
import { DashboardView } from "@/features/admin/dashboard/components/dashboard-view";
import { parseDashboardRange, rangeHref } from "@/features/admin/dashboard/lib/dashboard";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGet } from "@/lib/api/server";
import { getCurrentUser } from "@/lib/auth/session";
import type { SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The business's dashboard (IA-A01, FR-080 to FR-085): what needs doing now, the figures behind it,
 * the next visits and the latest activity. Every number comes from `GET /admin/dashboard/summary`,
 * computed on the server in the business's time zone. The period is in the address (`?range=`).
 */
export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const range = parseDashboardRange(await searchParams);

  let summary: AdminDashboardSummaryDto;
  try {
    summary = await serverApiGet<AdminDashboardSummaryDto>(
      `/admin/dashboard/summary?range=${range}`,
    );
  } catch (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        {loadErrorState({
          error,
          title: "We couldn't load the dashboard",
          retryHref: rangeHref(range),
        })}
      </>
    );
  }
  const me = await getCurrentUser();

  return <DashboardView summary={summary} userName={me?.user.name} />;
}
