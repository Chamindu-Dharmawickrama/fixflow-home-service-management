import type { AdminCustomerDto, CustomerHistoryResponse } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  CustomerAddressesCard,
  CustomerContactLinks,
  CustomerSummary,
} from "@/features/admin/components/customer-detail-cards";
import {
  type CustomerHistoryPage,
  CustomerHistoryPanel,
  CustomerHistoryTabs,
} from "@/features/admin/components/customer-history";
import { CustomerNotesPanel } from "@/features/admin/components/customer-notes-panel";
import {
  adminCustomerPath,
  CUSTOMERS_PATH,
  parseCustomerTab,
  toHistoryApiQueryString,
} from "@/features/admin/lib/customers";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { isApiError } from "@/lib/api";
import { serverApiGet, serverApiGetEnvelope } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";
import { buildHref, type SearchParamsInput } from "@/lib/url";

export const metadata: Metadata = { title: "Customer" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface CustomerPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsInput>;
}

/**
 * One customer in the business's view (IA-A09, FR-030, FR-031, FR-033): how to reach them, where
 * they are, what they have asked for and what they owe, their history a kind of record at a time,
 * and the team's private notes. Nothing on this page is ever served to the customer; their own
 * pages are in the portal.
 */
export default function AdminCustomerPage({ params, searchParams }: CustomerPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomerContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CustomerContent({ params, searchParams }: CustomerPageProps) {
  const { id } = await params;
  const query = await searchParams;

  let customer: AdminCustomerDto;
  let timeZone: string;
  try {
    [customer, { timeZone }] = await Promise.all([
      serverApiGet<AdminCustomerDto>(`/admin/customers/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that customer"
          description="The link may be wrong, or the customer may no longer exist. You can find everyone in the customer list."
          action={
            <Link href={CUSTOMERS_PATH} className={buttonVariants({ variant: "outline" })}>
              Back to the customers
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this customer",
      retryHref: buildHref(adminCustomerPath(id), query),
    });
  }

  return (
    <>
      <PageHeader
        title={customer.name}
        breadcrumbs={[{ label: "Customers", href: CUSTOMERS_PATH }, { label: customer.name }]}
        meta={
          <>
            <span>
              Customer since{" "}
              <DateTimeText value={customer.customerSince} timeZone={timeZone} display="date" />
            </span>
            <CustomerContactLinks email={customer.email} phone={customer.phone} />
          </>
        }
      />

      <CustomerSummary customerId={customer.id} summary={customer.summary} />

      <CustomerAddressesCard addresses={customer.addresses} />

      <section aria-labelledby="customer-history" className="flex min-w-0 flex-col gap-4">
        <h2 id="customer-history" className="text-lg font-semibold text-ink">
          History
        </h2>
        <CustomerHistoryTabs
          customerId={customer.id}
          summary={customer.summary}
          tab={parseCustomerTab(query).tab}
          params={query}
        />
        {/* Its own boundary: the tab's records stream in, and a failure here leaves the rest of the page. */}
        <Suspense fallback={<TableSkeleton label="Loading history" columns={5} rows={5} />}>
          <HistoryContent
            customerId={customer.id}
            customerName={customer.name}
            timeZone={timeZone}
            query={query}
          />
        </Suspense>
      </section>

      <CustomerNotesPanel
        customerId={customer.id}
        notes={customer.notes}
        noteCount={customer.noteCount}
        timeZone={timeZone}
      />
    </>
  );
}

async function HistoryContent({
  customerId,
  customerName,
  timeZone,
  query,
}: {
  customerId: string;
  customerName: string;
  timeZone: string;
  query: SearchParamsInput;
}) {
  const open = parseCustomerTab(query);

  let page: CustomerHistoryPage;
  try {
    const response = await serverApiGetEnvelope<CustomerHistoryResponse>(
      `/admin/customers/${encodeURIComponent(customerId)}/history?${toHistoryApiQueryString(open)}`,
    );
    // The API answered with the kind that was asked for; the type of the union is narrowed here once.
    page = { tab: open.tab, response } as CustomerHistoryPage;
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load this history",
      retryHref: buildHref(adminCustomerPath(customerId), query),
    });
  }

  return (
    <CustomerHistoryPanel
      customerId={customerId}
      customerName={customerName}
      tab={open.tab}
      page={page}
      timeZone={timeZone}
      params={query}
    />
  );
}
