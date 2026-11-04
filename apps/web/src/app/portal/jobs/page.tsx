import type { CustomerWorkOrderListResponse } from "@fixflow/shared";
import { Briefcase } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { JobList } from "@/features/portal/components/job-cards";
import { JOBS_PATH, parsePastPage, pastQuery, upcomingQuery } from "@/features/portal/lib/jobs";
import { REQUESTS_PATH } from "@/features/portal/lib/requests-list";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Jobs" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The customer's own jobs (IA-C04, FR-056): what is coming up and what is behind them, each with its
 * date and time on the business's clocks, its status and the technician's first name. The API shows
 * a customer only their own jobs.
 */
export default function PortalJobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function JobsContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const page = parsePastPage(params);

  let upcoming: CustomerWorkOrderListResponse;
  let past: CustomerWorkOrderListResponse;
  let timeZone: string;
  try {
    [upcoming, past, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<CustomerWorkOrderListResponse>(`/work-orders/me?${upcomingQuery()}`),
      serverApiGetEnvelope<CustomerWorkOrderListResponse>(`/work-orders/me?${pastQuery(page)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load your jobs",
      retryHref: buildHref(JOBS_PATH, params),
    });
  }

  const none = upcoming.pagination.totalItems === 0 && past.pagination.totalItems === 0;

  return (
    <>
      <PageHeader
        title="Your jobs"
        description="The work you have agreed to: when it is booked, how it is going and what was done."
      />

      {none ? (
        <EmptyState
          icon={Briefcase}
          title="You don't have a job yet"
          description="We set up a job when you accept a quotation. Until then, you can follow your requests and quotations."
          action={
            <Link href={REQUESTS_PATH} className={buttonVariants({ variant: "outline" })}>
              View your requests
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="upcoming-jobs-heading" className="flex flex-col gap-3">
            <h2 id="upcoming-jobs-heading" className="font-display text-xl font-semibold text-ink">
              Upcoming
            </h2>
            {upcoming.data.length === 0 ? (
              <p className="text-sm text-ink-secondary">
                Nothing is booked at the moment. When we schedule a visit it will appear here.
              </p>
            ) : (
              <JobList jobs={upcoming.data} timeZone={timeZone} label="Upcoming jobs" />
            )}
          </section>

          <section aria-labelledby="past-jobs-heading" className="flex flex-col gap-3">
            <h2 id="past-jobs-heading" className="font-display text-xl font-semibold text-ink">
              Past jobs
            </h2>
            {past.data.length === 0 ? (
              <p className="text-sm text-ink-secondary">
                {past.pagination.totalItems > 0
                  ? "There are no jobs on this page. Go back to the first page to see them."
                  : "Finished and cancelled jobs will be listed here."}
              </p>
            ) : (
              <>
                <JobList jobs={past.data} timeZone={timeZone} label="Past jobs" />
                <Pagination
                  page={page}
                  pageSize={past.pagination.pageSize}
                  totalItems={past.pagination.totalItems}
                  basePath={JOBS_PATH}
                  searchParams={params}
                  itemLabel="past jobs"
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
