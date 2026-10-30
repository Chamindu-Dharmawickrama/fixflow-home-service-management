import type { AdminCustomerListResponse } from "@fixflow/shared";
import { SearchX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { CustomerSearch } from "@/features/admin/components/customer-search";
import { CustomersTable } from "@/features/admin/components/customers-table";
import {
  CUSTOMERS_PATH,
  customersSortHref,
  hasActiveSearch,
  parseCustomersQuery,
  toCustomersApiQueryString,
} from "@/features/admin/lib/customers";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Customers" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

/**
 * The customer directory (IA-A08, FR-031): everyone who has an account, found by name, email or
 * phone, with what they have asked for and what they owe. The search and sort live in the address
 * (D-40). A row opens the customer's page.
 */
export default function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CustomersContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseCustomersQuery(params);

  let list: AdminCustomerListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<AdminCustomerListResponse>(
        `/admin/customers?${toCustomersApiQueryString(query)}`,
      ),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load the customers",
      retryHref: buildHref(CUSTOMERS_PATH, params),
    });
  }

  const searching = hasActiveSearch(query);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has an account with you. Open a customer to see their addresses, their requests, quotations, jobs and invoices, and the notes your team keeps."
      />

      <CustomerSearch q={query.q} sort={query.sort} order={query.order} canClear={searching} />

      {list.data.length === 0 ? (
        searching ? (
          <EmptyState
            icon={SearchX}
            title="No customers match"
            description="Nobody fits this search. Check the spelling, try part of the name, or search by the email or phone number instead."
            action={
              <Link
                href={buildHref(CUSTOMERS_PATH, params, { q: null, page: null })}
                className={buttonVariants({ variant: "outline" })}
              >
                Show all customers
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="When someone creates an account, they appear here, with everything they go on to request."
          />
        )
      ) : (
        <>
          <CustomersTable
            customers={list.data}
            timeZone={timeZone}
            sort={{ field: query.sort, order: query.order }}
            getSortHref={(field) => customersSortHref(params, query, field)}
          />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={CUSTOMERS_PATH}
            searchParams={params}
            itemLabel="customers"
          />
        </>
      )}
    </>
  );
}
