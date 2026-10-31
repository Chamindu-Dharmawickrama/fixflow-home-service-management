import type { AdminQuotationDto } from "@fixflow/shared";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateTimeText } from "@/components/ui/date-time-text";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminCustomerPath } from "../lib/customers";
import { adminRequestPath, QUEUE_PATH } from "../lib/requests-queue";

/**
 * The top of a quotation's page, for the editor and the read-only view alike: where it sits
 * (Requests › the request › the quotation), its reference and status, who it is for, and the actions
 * the caller decides on (the server's `availableActions`, D-43).
 */
export function QuotationPageHeader({
  quotation,
  timeZone,
  actions,
}: {
  quotation: Pick<
    AdminQuotationDto,
    | "reference"
    | "status"
    | "requestId"
    | "requestReference"
    | "serviceName"
    | "customer"
    | "createdAt"
  >;
  timeZone: string;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={`Quotation ${quotation.reference}`}
      status={<StatusBadge kind="quotation" status={quotation.status} />}
      breadcrumbs={[
        { label: "Requests", href: QUEUE_PATH },
        { label: quotation.requestReference, href: adminRequestPath(quotation.requestId) },
        { label: quotation.reference },
      ]}
      meta={
        <>
          <span>{quotation.serviceName}</span>
          <Link
            href={adminCustomerPath(quotation.customer.id)}
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            {quotation.customer.name}
          </Link>
          <span>
            Started <DateTimeText value={quotation.createdAt} timeZone={timeZone} display="date" />
          </span>
        </>
      }
      actions={actions}
      className="print:hidden"
    />
  );
}
