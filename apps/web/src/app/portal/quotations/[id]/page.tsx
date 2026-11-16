import { type CustomerQuotationDto } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { DateTimeText } from "@/components/ui/date-time-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PrintButton } from "@/components/ui/print-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { QuotationDocument } from "@/features/admin/components/quotation-document";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
import { QuotationBanner } from "@/features/portal/components/quotation-banner";
import { QuotationDecision } from "@/features/portal/components/quotation-decision";
import { portalQuotationPath } from "@/features/portal/lib/quotations";
import { requestPath, REQUESTS_PATH } from "@/features/portal/lib/requests-list";
import { isApiError } from "@/lib/api";
import { serverApiGet } from "@/lib/api/server";
import { getPublicSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Quotation" };

/**
 * Opted out of instant-navigation validation: the area layout redirects a request that has no
 * session, and the validator renders without one, so it is turned away before it reaches this page
 * and can never inspect it. The page still reads its data behind its own `<Suspense>` boundary.
 */
export const instant = false;

interface QuotationPageProps {
  params: Promise<{ id: string }>;
}

/**
 * One quotation as the customer reads it (IA-C03, FR-044, FR-045, workflow 7.3): a clear document, how
 * long they have to answer, and, while it is open, the way to accept or decline it. The API shows a
 * customer only their own quotation, and never a draft, so someone else's id (or a draft's) looks
 * exactly like one that does not exist. The same document prints on its own.
 */
export default function PortalQuotationPage({ params }: QuotationPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuotationContent params={params} />
    </Suspense>
  );
}

async function QuotationContent({ params }: QuotationPageProps) {
  const { id } = await params;

  let quotation: CustomerQuotationDto;
  let timeZone: string;
  try {
    [quotation, { timeZone }] = await Promise.all([
      serverApiGet<CustomerQuotationDto>(`/quotations/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there, not yours, or not sent) and 422 (not an id) both mean there is nothing to
    // show, in the same words, so an id cannot be probed.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that quotation"
          description="The link may be wrong, or the quotation may not be on your account. You can find your quotations from your requests."
          action={
            <Link href={REQUESTS_PATH} className={buttonVariants({ variant: "outline" })}>
              View your requests
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this quotation",
      retryHref: portalQuotationPath(id),
    });
  }

  // After the data has been read: how many days are left is measured from the moment of this request.
  const now = new Date();

  return (
    <>
      <PageHeader
        title={
          <>
            Quotation <span className="whitespace-nowrap">{quotation.reference}</span>
          </>
        }
        status={<StatusBadge kind="quotation" status={quotation.status} />}
        breadcrumbs={[
          { label: "Requests", href: REQUESTS_PATH },
          { label: quotation.requestReference, href: requestPath(quotation.requestId) },
          { label: quotation.reference },
        ]}
        meta={
          <>
            <span className="min-w-0 [overflow-wrap:anywhere]">{quotation.serviceName}</span>
            <span>
              Valid until <DateTimeText value={quotation.validUntil} timeZone={timeZone} />
            </span>
          </>
        }
        actions={<PrintButton>Print quotation</PrintButton>}
        className="print:hidden"
      />
      <QuotationBanner quotation={quotation} timeZone={timeZone} now={now} />
      <QuotationDocument quotation={quotation} timeZone={timeZone} />
      <QuotationDecision quotation={quotation} businessName={quotation.business.name} />
    </>
  );
}
