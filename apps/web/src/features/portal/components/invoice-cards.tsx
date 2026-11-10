import { type CustomerInvoiceListItemDto, InvoiceStatus } from "@fixflow/shared";
import Link from "next/link";

import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { balanceHeadline, overdueByText, portalInvoicePath } from "../lib/invoices";

const HEADLINE_TONES: Partial<Record<InvoiceStatus, string>> = {
  [InvoiceStatus.OVERDUE]: "text-danger",
  [InvoiceStatus.PAID]: "text-success",
  [InvoiceStatus.VOID]: "text-ink-secondary",
};

/**
 * An invoice as a card (IA-C05, UX-QB-INV): its number (the link), its status, the service, when it
 * was issued and is due, the total, and one sentence about the balance, which is what the customer came
 * for. The whole card is the link's target. Every figure is the server's; the status is text as well as
 * colour.
 */
export function InvoiceCard({
  invoice,
  timeZone,
}: {
  invoice: CustomerInvoiceListItemDto;
  timeZone: string;
}) {
  return (
    <li
      data-testid="portal-invoice-card"
      className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 hover:border-border-strong"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={portalInvoicePath(invoice.id)}
          className="font-medium text-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          <ReferenceText reference={invoice.invoiceNumber} />{" "}
          <span className="sr-only">for {invoice.serviceName}</span>
        </Link>
        <StatusBadge kind="invoice" status={invoice.status} />
      </div>
      <p className="min-w-0 text-base font-medium text-ink [overflow-wrap:anywhere]">
        {invoice.serviceName}
      </p>
      <p
        className={cn(
          "min-w-0 text-sm font-semibold [overflow-wrap:anywhere]",
          HEADLINE_TONES[invoice.status] ?? "text-ink",
        )}
      >
        {balanceHeadline(invoice, timeZone)}
        {invoice.status === InvoiceStatus.OVERDUE ? (
          <span className="block font-normal">{overdueByText(invoice.daysOverdue)}</span>
        ) : null}
      </p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-secondary">
        <div className="flex gap-1.5">
          <dt>Issued</dt>
          <dd>
            <DateTimeText value={invoice.issueDate} timeZone={timeZone} />
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Due</dt>
          <dd>
            <DateTimeText value={invoice.dueDate} timeZone={timeZone} />
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Total</dt>
          <dd className="font-medium text-ink">
            <MoneyText amount={invoice.totalAmount} currencyCode={invoice.currencyCode} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** A list of invoice cards. The caller names the list and decides what an empty one says. */
export function InvoiceList({
  invoices,
  timeZone,
  label,
}: {
  invoices: readonly CustomerInvoiceListItemDto[];
  timeZone: string;
  label: string;
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {invoices.map((invoice) => (
        <InvoiceCard key={invoice.id} invoice={invoice} timeZone={timeZone} />
      ))}
    </ul>
  );
}
