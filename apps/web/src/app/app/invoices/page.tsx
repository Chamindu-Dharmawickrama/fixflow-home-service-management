import type { AdminInvoiceListResponse } from "@fixflow/shared";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { InvoiceStatusChips } from "@/features/admin/components/invoice-status-chips";
import { InvoicesEmpty } from "@/features/admin/components/invoices-empty";
import { InvoicesFilters } from "@/features/admin/components/invoices-filters";
import { InvoicesTable } from "@/features/admin/components/invoices-table";
import {
  hasActiveInvoiceFilters,
  INVOICES_PATH,
  invoicesFormCarryOver,
  invoicesSortHref,
  invoicesStatusHref,
  parseInvoicesQuery,
  toInvoicesApiQueryString,
} from "@/features/admin/lib/invoices";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Invoices" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The invoices (IA-A11, FR-074): what has been billed, what is still owed and what is overdue. The
 * status, search, due dates, sort and page live in the address (D-40). A row opens the invoice, where
 * a draft is finished and issued.
 */
export default function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoicesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function InvoicesContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseInvoicesQuery(params);

  let list: AdminInvoiceListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminInvoiceListResponse>(
        `/admin/invoices?${toInvoicesApiQueryString(query)}`,
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the invoices",
      retryHref: buildHref(INVOICES_PATH, params),
    });
  }

  const filtered = hasActiveInvoiceFilters(query);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="What has been billed and what is still owed. Create an invoice from a completed job, check it, then issue it to the customer."
      />

      <InvoiceStatusChips selected={query.status} counts={list.meta.counts} params={params} />

      <InvoicesFilters
        q={query.q}
        dueFrom={query.dueFrom}
        dueTo={query.dueTo}
        preserve={invoicesFormCarryOver(query)}
        canClear={filtered}
      />

      {list.data.length === 0 ? (
        <InvoicesEmpty
          filtered={filtered}
          status={query.status}
          pastLastPage={list.pagination.totalItems > 0}
          firstPageHref={buildHref(INVOICES_PATH, params, { page: null })}
          clearFiltersHref={invoicesStatusHref({}, query.status)}
        />
      ) : (
        <>
          <InvoicesTable
            invoices={list.data}
            timeZone={timeZone}
            sort={{ field: query.sort, order: query.order }}
            getSortHref={(field) => invoicesSortHref(params, query, field)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={INVOICES_PATH}
            searchParams={params}
            itemLabel="invoices"
          />
        </>
      )}
    </>
  );
}
