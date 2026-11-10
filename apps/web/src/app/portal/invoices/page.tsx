import type { CustomerInvoiceListResponse } from "@fixflow/shared";
import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { InvoiceList } from "@/features/portal/components/invoice-cards";
import {
  INVOICE_FILTER_LABELS,
  INVOICE_FILTERS,
  type InvoiceFilter,
  invoicesApiQuery,
  invoicesFilterHref,
  parseInvoicesQuery,
  PORTAL_INVOICES_PATH,
} from "@/features/portal/lib/invoices";
import { JOBS_PATH } from "@/features/portal/lib/jobs";
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
 * The customer's own invoices (IA-C05, FR-072, workflow 7.7): every invoice the business has issued
 * them, newest first, with what is owed and by when. The API shows a customer only their own, and
 * never a draft.
 */
export default function PortalInvoicesPage({
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

const EMPTY_COPY: Record<InvoiceFilter, { title: string; description: string }> = {
  all: {
    title: "You don't have an invoice yet",
    description:
      "We send an invoice once your job is finished. It will appear here, and we will let you know.",
  },
  outstanding: {
    title: "Nothing to pay right now",
    description:
      "You have no invoice with a balance to pay. Show all your invoices to see the rest.",
  },
  paid: {
    title: "No paid invoices yet",
    description: "Invoices you have paid in full will be listed here.",
  },
};

async function InvoicesContent({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const params = await searchParams;
  const query = parseInvoicesQuery(params);

  let list: CustomerInvoiceListResponse;
  let timeZone: string;
  try {
    [list, { timeZone }] = await Promise.all([
      serverApiGetEnvelope<CustomerInvoiceListResponse>(`/invoices/me?${invoicesApiQuery(query)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    return loadErrorState({
      error,
      title: "We couldn't load your invoices",
      retryHref: buildHref(PORTAL_INVOICES_PATH, params),
    });
  }

  const empty = EMPTY_COPY[query.filter];

  return (
    <>
      <PageHeader
        title="Your invoices"
        description="What you have been billed, what has been paid and what is still owed, newest first."
      />

      <LinkTabs
        label="Filter invoices"
        items={INVOICE_FILTERS.map((filter) => ({
          label: INVOICE_FILTER_LABELS[filter],
          href: invoicesFilterHref(filter),
          current: filter === query.filter,
        }))}
      />

      {list.data.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={empty.title}
          description={
            list.pagination.totalItems > 0
              ? "There are no invoices on this page. Go back to the first page to see them."
              : empty.description
          }
          action={
            query.filter === "all" ? (
              <Link href={JOBS_PATH} className={buttonVariants({ variant: "outline" })}>
                View your jobs
              </Link>
            ) : (
              <Link
                href={invoicesFilterHref("all")}
                className={buttonVariants({ variant: "outline" })}
              >
                Show all invoices
              </Link>
            )
          }
        />
      ) : (
        <>
          <InvoiceList invoices={list.data} timeZone={timeZone} label="Your invoices" />
          <Pagination
            page={query.page}
            pageSize={list.pagination.pageSize}
            totalItems={list.pagination.totalItems}
            basePath={PORTAL_INVOICES_PATH}
            searchParams={params}
            itemLabel="invoices"
          />
        </>
      )}
    </>
  );
}
