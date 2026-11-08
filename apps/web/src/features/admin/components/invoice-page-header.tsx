import type { AdminInvoiceDto } from "@fixflow/shared";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateTimeText } from "@/components/ui/date-time-text";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

import { adminCustomerPath } from "../lib/customers";
import { INVOICES_PATH, invoiceTitle } from "../lib/invoices";
import { adminJobPath } from "../lib/jobs";

/**
 * The top of an invoice's page, for the editor and the document view alike: where it sits (Invoices ›
 * the invoice), its number or "Draft invoice" and status, the job it bills, who it is for, and the
 * actions the caller decides on (the server's `availableActions`, D-43).
 */
export function InvoicePageHeader({
  invoice,
  customerName,
  timeZone,
  actions,
}: {
  invoice: Pick<
    AdminInvoiceDto,
    "invoiceNumber" | "status" | "job" | "serviceName" | "customerId" | "createdAt"
  >;
  customerName: string;
  timeZone: string;
  actions?: ReactNode;
}) {
  const title = invoiceTitle(invoice);
  return (
    <PageHeader
      title={title}
      status={<StatusBadge kind="invoice" status={invoice.status} />}
      breadcrumbs={[{ label: "Invoices", href: INVOICES_PATH }, { label: title }]}
      meta={
        <>
          <span className="min-w-0 [overflow-wrap:anywhere]">{invoice.serviceName}</span>
          <Link
            href={adminCustomerPath(invoice.customerId)}
            className="min-w-0 font-medium text-brand underline-offset-4 [overflow-wrap:anywhere] hover:underline"
          >
            {customerName}
          </Link>
          <Link
            href={adminJobPath(invoice.job.id)}
            className="font-medium text-brand underline-offset-4 hover:underline"
          >
            {invoice.job.reference}
          </Link>
          <span>
            Started <DateTimeText value={invoice.createdAt} timeZone={timeZone} display="date" />
          </span>
        </>
      }
      actions={actions}
      className="print:hidden"
    />
  );
}
