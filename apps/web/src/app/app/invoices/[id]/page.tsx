import { type AdminInvoiceDto, InvoiceStatus } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { InvoiceActions } from "@/features/admin/components/invoice-actions";
import { InvoiceDocument } from "@/features/admin/components/invoice-document";
import { InvoiceEditor } from "@/features/admin/components/invoice-editor";
import { InvoicePageHeader } from "@/features/admin/components/invoice-page-header";
import {
  InvoiceDetailsCard,
  InvoiceHistoryCard,
  InvoicePaymentsCard,
  InvoiceStatusBanner,
} from "@/features/admin/components/invoice-readonly-cards";
import { INVOICES_PATH } from "@/features/admin/lib/invoices";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Invoice" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface InvoicePageProps {
  params: Promise<{ id: string }>;
}

/**
 * One invoice in the business's view (IA-A12, FR-070 to FR-077): the draft editor while it is a
 * draft, and the print-ready document with its status, the payments panel and the history once it
 * is not. The server decides what may be done to it (`availableActions`); this page offers exactly
 * that and decides nothing.
 */
export default function AdminInvoicePage({ params }: InvoicePageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoiceContent params={params} />
    </Suspense>
  );
}

async function InvoiceContent({ params }: InvoicePageProps) {
  const { id } = await params;

  let invoice: AdminInvoiceDto;
  let timeZone: string;
  try {
    [invoice, { timeZone }] = await Promise.all([
      serverApiGet<AdminInvoiceDto>(`/admin/invoices/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that invoice"
          description="The link may be wrong, or the invoice may no longer exist. You can find every invoice in the list."
          action={
            <Link href={INVOICES_PATH} className={buttonVariants({ variant: "outline" })}>
              Back to the invoices
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this invoice",
      retryHref: `${INVOICES_PATH}/${encodeURIComponent(id)}`,
    });
  }

  if (invoice.status === InvoiceStatus.DRAFT) {
    return <InvoiceEditor invoice={invoice} timeZone={timeZone} />;
  }

  return (
    <>
      <InvoicePageHeader
        invoice={invoice}
        customerName={invoice.customer.name}
        timeZone={timeZone}
        actions={<InvoiceActions invoice={invoice} />}
      />
      <InvoiceStatusBanner invoice={invoice} timeZone={timeZone} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start print:block">
        <div className="min-w-0">
          <InvoiceDocument invoice={invoice} timeZone={timeZone} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <InvoicePaymentsCard invoice={invoice} timeZone={timeZone} />
          <InvoiceDetailsCard invoice={invoice} timeZone={timeZone} />
          <InvoiceHistoryCard invoice={invoice} timeZone={timeZone} />
        </div>
      </div>
    </>
  );
}
