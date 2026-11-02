import type { AdminTechnicianListResponse } from "@fixflow/shared";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { FilterBar, FilterBarField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TechnicianSheet } from "@/features/admin/components/technician-sheet";
import { TechniciansEmpty } from "@/features/admin/components/technicians-empty";
import { TechniciansTable } from "@/features/admin/components/technicians-table";
import {
  DEFAULT_ACTIVE_FILTER,
  hasActiveSearch,
  parseTechniciansQuery,
  TECHNICIANS_PATH,
  techniciansSortHref,
  techniciansTabHref,
  toTechniciansApiQueryString,
} from "@/features/admin/lib/technicians";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Technicians" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The technicians (IA-A10, FR-060): the people the business schedules for jobs, who is active and
 * who is not, and what each has coming up. They are records, not users: they cannot sign in. The tab,
 * search and order live in the address (D-40). A row opens the technician's page.
 */
export default function TechniciansPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TechniciansContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TechniciansContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseTechniciansQuery(params);

  let list: AdminTechnicianListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminTechnicianListResponse>(
        `/admin/technicians?${toTechniciansApiQueryString(query)}`,
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the technicians",
      retryHref: buildHref(TECHNICIANS_PATH, params),
    });
  }

  const { counts, suggestedColor } = list.meta;
  const tab = (label: string, active: typeof query.active, count: number) => ({
    label,
    count,
    href: techniciansTabHref(params, active),
    current: query.active === active,
  });

  const searching = hasActiveSearch(query);
  const addTechnician = (
    <TechnicianSheet
      mode="create"
      suggestedColor={suggestedColor}
      trigger={
        <Button>
          <Plus aria-hidden="true" />
          Add technician
        </Button>
      }
    />
  );

  return (
    <>
      <PageHeader
        title="Technicians"
        description="The people you schedule for jobs. They are records for your team, not accounts: technicians don't sign in."
        actions={addTechnician}
      />

      <LinkTabs
        label="Filter technicians by state"
        items={[
          tab("Active", "true", counts.active),
          tab("Inactive", "false", counts.inactive),
          tab("All", "all", counts.all),
        ]}
      />

      {/* The form submits to the tab's own address, so "Clear filters" keeps the tab. */}
      <FilterBar
        action={techniciansTabHref({}, query.active)}
        label="Search technicians"
        submitLabel="Search"
        preserve={{
          active: query.active === DEFAULT_ACTIVE_FILTER ? undefined : query.active,
          order: query.order === "desc" ? "desc" : undefined,
        }}
        hasActiveFilters={searching}
      >
        <FilterBarField id="technician-search" label="Search" grow>
          <Input
            id="technician-search"
            name="q"
            type="search"
            defaultValue={query.q ?? ""}
            placeholder="Name, specialty, email or phone"
            autoComplete="off"
            maxLength={100}
          />
        </FilterBarField>
      </FilterBar>

      {list.data.length === 0 ? (
        <TechniciansEmpty
          searching={searching}
          active={query.active}
          counts={counts}
          pastLastPage={list.pagination.totalItems > 0}
          firstPageHref={buildHref(TECHNICIANS_PATH, params, { page: null })}
          clearSearchHref={techniciansTabHref({}, query.active)}
          addTechnician={addTechnician}
        />
      ) : (
        <>
          <TechniciansTable
            technicians={list.data}
            timeZone={timeZone}
            sort={{ field: "name", order: query.order }}
            getSortHref={() => techniciansSortHref(params, query)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={TECHNICIANS_PATH}
            searchParams={params}
            itemLabel="technicians"
          />
        </>
      )}
    </>
  );
}
