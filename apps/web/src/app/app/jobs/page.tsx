import type { AdminTechnicianListResponse, AdminWorkOrderListResponse } from "@fixflow/shared";
import { WORK_ORDER_VIEWS } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { JobsEmpty } from "@/features/admin/components/jobs-empty";
import { JobsFilters } from "@/features/admin/components/jobs-filters";
import { JobsTable } from "@/features/admin/components/jobs-table";
import {
  hasActiveJobFilters,
  JOBS_PATH,
  jobsFormCarryOver,
  jobsSortHref,
  jobsTabHref,
  parseJobsQuery,
  toJobsApiQueryString,
  VIEW_LABELS,
} from "@/features/admin/lib/jobs";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
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
 * The jobs (IA-A05, FR-052): what has been agreed with customers and now has to be scheduled, done
 * and invoiced. The tab, search, filters, sort and page live in the address (D-40). A row opens the
 * job, where it is scheduled.
 */
export default function JobsPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function JobsContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseJobsQuery(params);

  let list: AdminWorkOrderListResponse;
  let technicians: AdminTechnicianListResponse;
  let timeZone: string;
  try {
    [list, technicians, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminWorkOrderListResponse>(
        `/admin/work-orders?${toJobsApiQueryString(query)}`,
      ),
      // Everyone, whatever their state: a job can still belong to a technician who is now inactive.
      serverApiGetEnvelope<AdminTechnicianListResponse>(
        "/admin/technicians?active=all&pageSize=100&sort=name&order=asc",
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the jobs",
      retryHref: buildHref(JOBS_PATH, params),
    });
  }

  const filtered = hasActiveJobFilters(query);
  const { viewCounts } = list.meta;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="The work customers have agreed to. Schedule each job with a technician, then follow it through to completion."
      />

      <LinkTabs
        label="Filter jobs by stage"
        items={WORK_ORDER_VIEWS.map((view) => ({
          label: VIEW_LABELS[view],
          count: viewCounts[view],
          href: jobsTabHref(params, view),
          current: query.view === view,
        }))}
      />

      <JobsFilters
        q={query.q}
        technicianId={query.technicianId}
        scheduledFrom={query.scheduledFrom}
        scheduledTo={query.scheduledTo}
        technicians={technicians.data.map(({ id, name, isActive }) => ({ id, name, isActive }))}
        preserve={jobsFormCarryOver(query)}
        canClear={filtered}
      />

      {list.data.length === 0 ? (
        <JobsEmpty
          filtered={filtered}
          view={query.view}
          pastLastPage={list.pagination.totalItems > 0}
          firstPageHref={buildHref(JOBS_PATH, params, { page: null })}
          clearFiltersHref={jobsTabHref({}, query.view)}
        />
      ) : (
        <>
          <JobsTable
            jobs={list.data}
            timeZone={timeZone}
            view={query.view}
            sort={{ field: query.sort, order: query.order }}
            getSortHref={(field) => jobsSortHref(params, query, field)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={JOBS_PATH}
            searchParams={params}
            itemLabel="jobs"
          />
        </>
      )}
    </>
  );
}
