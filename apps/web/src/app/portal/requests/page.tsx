import {
  type CustomerRequestListResponse,
  REQUEST_STATUS_LABELS,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterBarField } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";
import { RequestsTable } from "@/features/portal/components/requests-table";
import {
  hasActiveFilters,
  parseRequestsQuery,
  REQUESTS_PATH,
  toApiQueryString,
} from "@/features/portal/lib/requests-list";
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

/** The customer's own service requests (IA-C02, FR-022), newest first. */
export default function PortalRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequestsContent searchParams={searchParams} />
    </Suspense>
  );
}

const STATUS_OPTIONS = Object.values(ServiceRequestStatus);

async function RequestsContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseRequestsQuery(params);

  let list: CustomerRequestListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<CustomerRequestListResponse>(`/requests/me?${toApiQueryString(query)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load your requests",
      retryHref: buildHref(REQUESTS_PATH, params),
    });
  }

  const filtered = hasActiveFilters(query);
  const requestAction = (
    <Link href={REQUEST_SERVICE_PATH} className={buttonVariants({ variant: "primary" })}>
      <Plus aria-hidden="true" />
      Request a service
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Your requests"
        description="Every service request you have sent, newest first, and what happens next with each."
        actions={requestAction}
      />

      {list.pagination.totalItems > 0 || filtered ? (
        <FilterBar
          action={REQUESTS_PATH}
          label="Filter requests"
          hasActiveFilters={filtered}
          submitLabel="Apply filter"
        >
          <FilterBarField id="request-status" label="Status">
            <Select id="request-status" name="status" defaultValue={query.status ?? ""}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {REQUEST_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </FilterBarField>
        </FilterBar>
      ) : null}

      {list.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests match"
            description="You have no requests with this status. Show every request to see them all."
            action={
              <Link href={REQUESTS_PATH} className={buttonVariants({ variant: "outline" })}>
                Show all requests
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="You haven't sent a request yet"
            description="Tell us what needs doing and when. We'll review it and send you a written quotation before any work starts."
            action={requestAction}
          />
        )
      ) : (
        <>
          <RequestsTable requests={list.data} timeZone={timeZone} />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={REQUESTS_PATH}
            searchParams={params}
            itemLabel="requests"
          />
        </>
      )}
    </>
  );
}
