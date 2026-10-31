import {
  type AdminRequestDto,
  type QuotationSummaryDto,
  ServiceRequestStatus,
} from "@fixflow/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminQuotationPath } from "../lib/quotations";

const NOTHING = <span className="text-ink-muted">—</span>;

function emptyGuidance(status: ServiceRequestStatus): string {
  switch (status) {
    case ServiceRequestStatus.SUBMITTED:
      return "No quotations yet. Start the review, then you can prepare one.";
    case ServiceRequestStatus.UNDER_REVIEW:
      return "No quotations yet. Use “Create quotation” above to prepare one.";
    default:
      return "No quotation was prepared for this request.";
  }
}

function columns(timeZone: string): DataTableColumn<QuotationSummaryDto>[] {
  return [
    {
      id: "reference",
      header: "Quotation",
      primary: true,
      cell: (quotation) => (
        <>
          {quotation.reference}
          {quotation.replacesReference === null ? null : (
            <span className="block text-xs font-normal text-ink-secondary">
              Replaces {quotation.replacesReference}
            </span>
          )}
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (quotation) => <StatusBadge kind="quotation" status={quotation.status} />,
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (quotation) => (
        <MoneyText amount={quotation.totalAmount} currencyCode={quotation.currencyCode} />
      ),
    },
    {
      id: "sentAt",
      header: "Sent",
      cell: (quotation) =>
        quotation.sentAt === null ? (
          NOTHING
        ) : (
          <DateTimeText value={quotation.sentAt} timeZone={timeZone} display="date" />
        ),
    },
    {
      id: "validUntil",
      header: "Valid until",
      cell: (quotation) => <DateTimeText value={quotation.validUntil} timeZone={timeZone} />,
    },
  ];
}

/**
 * Every version of the request's quotation, newest first (FR-040, FR-046, UX-QB-QUO): a draft being
 * prepared, the sent one the customer is looking at, and the ones that were replaced, answered,
 * expired or voided. Each row opens the quotation. Creating one is the request's main action (above),
 * so this card never offers a second button for it.
 */
export function RequestQuotationsCard({
  request,
  timeZone,
}: {
  request: AdminRequestDto;
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Quotations</CardTitle>
        <CardDescription>
          Every version, newest first. A sent quotation is never edited: a change is a new version
          that replaces it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {request.quotations.length === 0 ? (
          <p className="text-sm text-ink-secondary">{emptyGuidance(request.status)}</p>
        ) : (
          <DataTable<QuotationSummaryDto>
            caption="Quotations for this request"
            rows={request.quotations}
            getRowId={(quotation) => quotation.id}
            rowHref={(quotation) => adminQuotationPath(quotation.id)}
            columns={columns(timeZone)}
            breakpoint="lg"
          />
        )}
      </CardContent>
    </Card>
  );
}
