import { type CustomerInvoiceDto } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/components/ui/print-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { InvoiceDocument } from "@/features/admin/components/invoice-document";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { DownloadInvoicePdfButton } from "@/features/portal/components/download-invoice-pdf-button";
import { InvoiceBanner } from "@/features/portal/components/invoice-banner";
import {
  paidDirectlyNote,
  PORTAL_INVOICES_PATH,
  portalInvoicePath,
} from "@/features/portal/lib/invoices";
import { jobPath } from "@/features/portal/lib/jobs";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";

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
 * One invoice as the customer reads it (IA-C05, FR-072, workflow 7.7): where it stands and what is
 * owed, the document itself with the payments received, and how to pay. It can be downloaded as a PDF
 * or printed, and both say what the page says. The API shows a customer only their own invoice, and
 * never a draft, so someone else's id (or a draft's) looks exactly like one that does not exist.
 */
export default function PortalInvoicePage({ params }: InvoicePageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoiceContent params={params} />
    </Suspense>
  );
}

async function InvoiceContent({ params }: InvoicePageProps) {
  const { id } = await params;

  let invoice: CustomerInvoiceDto;
  try {
    invoice = await serverApiGet<CustomerInvoiceDto>(`/invoices/${encodeURIComponent(id)}`);
  } catch (error) {
    // 404 (not there, not yours, or not issued) and 422 (not an id) both mean there is nothing to
    // show, in the same words, so an id cannot be probed.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that invoice"
          description="The link may be wrong, or the invoice may not be on your account. You can find your invoices in the list."
          action={
            <Link href={PORTAL_INVOICES_PATH} className={buttonVariants({ variant: "outline" })}>
              View your invoices
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this invoice",
      retryHref: portalInvoicePath(id),
    });
  }

  const { timeZone } = invoice;

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        status={<StatusBadge kind="invoice" status={invoice.status} />}
        breadcrumbs={[
          { label: "Invoices", href: PORTAL_INVOICES_PATH },
          { label: invoice.invoiceNumber },
        ]}
        meta={
          <>
            <span className="min-w-0 [overflow-wrap:anywhere]">{invoice.serviceName}</span>
            <Link
              href={jobPath(invoice.job.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              {invoice.job.reference}
            </Link>
          </>
        }
        actions={
          <>
            <DownloadInvoicePdfButton
              invoiceId={invoice.id}
              label={invoice.invoiceNumber}
              variant="primary"
            />
            <PrintButton>Print invoice</PrintButton>
          </>
        }
        className="print:hidden"
      />
      <InvoiceBanner invoice={invoice} />
      <InvoiceDocument invoice={invoice} timeZone={timeZone} payments={invoice.payments} />
      {invoice.paymentInstructions ? null : (
        <p className="text-sm text-ink-secondary print:hidden">
          {paidDirectlyNote(invoice.business.name)}
        </p>
      )}
    </>
  );
}
