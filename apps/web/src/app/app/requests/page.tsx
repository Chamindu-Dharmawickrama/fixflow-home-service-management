import type { AdminRequestListResponse, AdminServiceListResponse } from "@fixflow/shared";
import { Inbox, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ExportCsvButton } from "@/features/admin/components/export-csv-button";
import { RequestQueueFilters } from "@/features/admin/components/request-queue-filters";
import { RequestStatusChips } from "@/features/admin/components/request-status-chips";
import { RequestsQueueTable } from "@/features/admin/components/requests-queue-table";
import {
  formCarryOver,
  hasActiveFilters,
  hasFormFilters,
  parseQueueQuery,
  QUEUE_PATH,
  sortHref,
  toApiQueryString,
} from "@/features/admin/lib/requests-queue";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Requests" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The queue of service requests (IA-A02, FR-023): what customers have sent, newest first, with the
 * status chips, search and filters in the URL (D-40). A row opens the request to review.
 */
export default function RequestQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QueueContent searchParams={searchParams} />
    </Suspense>
  );
}

async function QueueContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseQueueQuery(params);

  let list: AdminRequestListResponse;
  let services: AdminServiceListResponse;
  let timeZone: string;
  try {
    [list, services, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminRequestListResponse>(`/admin/requests?${toApiQueryString(query)}`),
      // Every service, whatever its state: a request can be for one that has since been archived.
      serverApiGetEnvelope<AdminServiceListResponse>(
        "/admin/services?pageSize=100&sort=name&order=asc",
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the requests",
      retryHref: buildHref(QUEUE_PATH, params),
    });
  }

  const filtered = hasActiveFilters(query);

  return (
    <>
      <PageHeader
        title="Service requests"
        description="What customers have sent. Open a request to review it, add notes and decide what happens next."
        actions={<ExportCsvButton kind="requests" query={toApiQueryString(query)} />}
      />

      <RequestStatusChips
        selected={query.status}
        counts={list.meta.statusCounts}
        total={list.meta.totalForFilters}
        params={params}
      />

      <RequestQueueFilters
        q={query.q}
        serviceId={query.serviceId}
        submittedFrom={query.submittedFrom}
        submittedTo={query.submittedTo}
        services={services.data.map(({ id, name }) => ({ id, name }))}
        preserve={formCarryOver(query)}
        canClear={hasFormFilters(query)}
      />

      {list.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No requests match"
            description="Nothing fits this search or these filters. Try a different word, widen the dates, or show every request."
            action={
              <Link href={QUEUE_PATH} className={buttonVariants({ variant: "outline" })}>
                Show all requests
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No requests yet"
            description="When a customer sends a service request it appears here, ready for you to review."
          />
        )
      ) : (
        <>
          <RequestsQueueTable
            requests={list.data}
            timeZone={timeZone}
            sort={{ field: query.sort, order: query.order }}
            getSortHref={(field) => sortHref(params, query, field)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={QUEUE_PATH}
            searchParams={params}
            itemLabel="requests"
          />
        </>
      )}
    </>
  );
}
