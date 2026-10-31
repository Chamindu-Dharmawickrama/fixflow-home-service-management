import { type AdminQuotationDto, QuotationStatus } from "@fixflow/shared";
import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { QuotationActions } from "@/features/admin/components/quotation-actions";
import { QuotationDocument } from "@/features/admin/components/quotation-document";
import { QuotationEditor } from "@/features/admin/components/quotation-editor";
import { QuotationPageHeader } from "@/features/admin/components/quotation-page-header";
import {
  QuotationChainCard,
  QuotationDetailsCard,
  QuotationHistoryCard,
  QuotationStatusBanner,
} from "@/features/admin/components/quotation-readonly-cards";
import { QUEUE_PATH } from "@/features/admin/lib/requests-queue";
import { PageSkeleton } from "@/features/auth/components/area-skeleton";
import { loadErrorState } from "@/features/catalogue/components/load-error";
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
 * One quotation in the business's view (IA-A04, FR-040 to FR-047): the draft editor while it is a
 * draft, and the document with its status, chain and history once it is not. The server decides
 * what may be done to it (`availableActions`); this page offers exactly that and decides nothing.
 */
export default function AdminQuotationPage({ params }: QuotationPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuotationContent params={params} />
    </Suspense>
  );
}

async function QuotationContent({ params }: QuotationPageProps) {
  const { id } = await params;

  let quotation: AdminQuotationDto;
  let timeZone: string;
  try {
    [quotation, { timeZone }] = await Promise.all([
      serverApiGet<AdminQuotationDto>(`/admin/quotations/${encodeURIComponent(id)}`),
      getPublicSettings(),
    ]);
  } catch (error) {
    // 404 (not there) and 422 (not an id) both mean there is nothing to show.
    if (isApiError(error) && (error.status === 404 || error.status === 422)) {
      return (
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title="We couldn't find that quotation"
          description="The link may be wrong, or the quotation may no longer exist. Quotations are found from the request they belong to."
          action={
            <Link href={QUEUE_PATH} className={buttonVariants({ variant: "outline" })}>
              Go to the requests
            </Link>
          }
        />
      );
    }
    return loadErrorState({
      error,
      title: "We couldn't load this quotation",
      retryHref: `/app/quotations/${encodeURIComponent(id)}`,
    });
  }

  if (quotation.status === QuotationStatus.DRAFT) {
    return <QuotationEditor quotation={quotation} timeZone={timeZone} />;
  }

  return (
    <>
      <QuotationPageHeader
        quotation={quotation}
        timeZone={timeZone}
        actions={<QuotationActions quotation={quotation} />}
      />
      <QuotationStatusBanner quotation={quotation} timeZone={timeZone} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start print:block">
        <div className="min-w-0">
          <QuotationDocument quotation={quotation} timeZone={timeZone} />
        </div>
        <div className="flex flex-col gap-6">
          <QuotationChainCard quotation={quotation} />
          <QuotationDetailsCard quotation={quotation} timeZone={timeZone} />
          <QuotationHistoryCard quotation={quotation} timeZone={timeZone} />
        </div>
      </div>
    </>
  );
}
