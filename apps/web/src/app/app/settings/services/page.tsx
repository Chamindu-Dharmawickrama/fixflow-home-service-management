import type { AdminServiceDto, AdminServiceListResponse } from "@fixflow/shared";
import { Layers, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterBarField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { formatServicePrice } from "@/features/catalogue/lib/format";
import {
  hasActiveFilters,
  parseServicesQuery,
  type ServicesListQuery,
  toApiQueryString,
} from "@/features/catalogue/lib/services-list";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Services" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

const BASE_PATH = "/app/settings/services";

/** The service catalogue (FR-101): every service whatever its state, filtered by tab and search. */
export default function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ServicesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ServicesContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseServicesQuery(params);

  let list: AdminServiceListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminServiceListResponse>(`/admin/services?${toApiQueryString(query)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the services",
      retryHref: buildHref(BASE_PATH, params),
    });
  }

  const { counts } = list.meta;
  const tab = (label: string, status: ServicesListQuery["status"], count: number) => ({
    label,
    count,
    href: buildHref(BASE_PATH, params, { status, page: null }),
    current: query.status === status,
  });

  const filtered = hasActiveFilters(query);
  const sortHref = (field: string) =>
    buildHref(BASE_PATH, params, {
      sort: field,
      order: query.sort === field && query.order === "asc" ? "desc" : "asc",
      page: null,
    });

  return (
    <>
      <PageHeader
        title="Services"
        description="What your business offers. Only published services appear on the website and can be requested."
        breadcrumbs={[{ label: "Settings" }, { label: "Services" }]}
        actions={
          <Link href={`${BASE_PATH}/new`} className={buttonVariants({ variant: "primary" })}>
            <Plus aria-hidden="true" />
            New service
          </Link>
        }
      />

      <LinkTabs
        label="Filter services by status"
        items={[
          tab("All", undefined, counts.all),
          tab("Published", "published", counts.published),
          tab("Unpublished", "unpublished", counts.unpublished),
          tab("Archived", "archived", counts.archived),
        ]}
      />

      <FilterBar
        action={BASE_PATH}
        label="Search services"
        submitLabel="Search"
        preserve={{ status: query.status, sort: query.sort, order: query.order }}
        hasActiveFilters={filtered}
      >
        <FilterBarField id="service-search" label="Search" grow>
          <Input
            id="service-search"
            name="search"
            type="search"
            defaultValue={query.search ?? ""}
            placeholder="Name, category or web address"
            autoComplete="off"
          />
        </FilterBarField>
      </FilterBar>

      {list.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Layers}
            title="No services match"
            description="Nothing fits this search or tab. Try a different word, or show every service."
            action={
              <Link href={BASE_PATH} className={buttonVariants({ variant: "outline" })}>
                Show all services
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Layers}
            title="No services yet"
            description="Add the first service your business offers. It stays hidden from the website until you publish it."
            action={
              <Link href={`${BASE_PATH}/new`} className={buttonVariants({ variant: "primary" })}>
                <Plus aria-hidden="true" />
                New service
              </Link>
            }
          />
        )
      ) : (
        <>
          <DataTable<AdminServiceDto>
            caption="Services"
            rows={list.data}
            getRowId={(service) => service.id}
            rowHref={(service) => `${BASE_PATH}/${service.id}`}
            sort={{ field: query.sort, order: query.order }}
            getSortHref={sortHref}
            columns={columnsFor(timeZone)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={BASE_PATH}
            searchParams={params}
            itemLabel="services"
          />
        </>
      )}
    </>
  );
}

function columnsFor(timeZone: string): DataTableColumn<AdminServiceDto>[] {
  return [
    {
      id: "name",
      header: "Service",
      primary: true,
      sortable: true,
      cell: (service) => (
        <span className="flex flex-col">
          <span>{service.name}</span>
          <span className={cn("text-xs font-normal text-ink-secondary")}>
            /services/{service.slug}
          </span>
        </span>
      ),
    },
    { id: "category", header: "Category", sortable: true, cell: (service) => service.category },
    { id: "pricing", header: "Pricing", cell: (service) => formatServicePrice(service) },
    {
      id: "status",
      header: "Status",
      cell: (service) => <StatusBadge kind="service" status={service.status} />,
    },
    {
      id: "sortOrder",
      header: "Order",
      align: "right",
      sortable: true,
      hideOnCard: true,
      cell: (service) => service.sortOrder,
    },
    {
      id: "updatedAt",
      header: "Updated",
      sortable: true,
      cell: (service) => (
        <DateTimeText value={service.updatedAt} timeZone={timeZone} display="date" />
      ),
    },
  ];
}
