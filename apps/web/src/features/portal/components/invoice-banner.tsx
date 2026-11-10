import { type CustomerInvoiceDto, InvoiceStatus } from "@fixflow/shared";
import type { ReactNode } from "react";

import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { cn } from "@/lib/utils";

import { balanceHeadline, overdueByText } from "../lib/invoices";

const TONES = {
  neutral: "border-border bg-surface-muted text-ink",
  success: "border-success-edge bg-success-soft text-success",
  danger: "border-danger-edge bg-danger-soft text-danger",
} as const;

function tone(status: InvoiceStatus): keyof typeof TONES {
  switch (status) {
    case InvoiceStatus.PAID:
      return "success";
    case InvoiceStatus.OVERDUE:
    case InvoiceStatus.VOID:
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Where the invoice stands, in the customer's words (WF-7.7, UX-QB-INV): "Balance due $120.00 by Nov 15,
 * 2026", "Paid in full on Nov 3, 2026", "Overdue: ...". The status and the balance are the server's
 * figures; the line under the headline says what has been received, so a part payment is never a
 * surprise. It is hidden when printing, as the document is what prints.
 */
export function InvoiceBanner({ invoice }: { invoice: CustomerInvoiceDto }) {
  const { timeZone, currencyCode } = invoice;
  let detail: ReactNode = null;
  switch (invoice.status) {
    case InvoiceStatus.OVERDUE:
      detail = (
        <>
          {overdueByText(invoice.daysOverdue)}.{" "}
          {invoice.payments.length > 0 ? (
            <>
              <MoneyText amount={invoice.amountPaid} currencyCode={currencyCode} /> of{" "}
              <MoneyText amount={invoice.totalAmount} currencyCode={currencyCode} /> has been
              received.
            </>
          ) : (
            "Please pay as soon as you can."
          )}
        </>
      );
      break;
    case InvoiceStatus.PARTIALLY_PAID:
      detail = (
        <>
          <MoneyText amount={invoice.amountPaid} currencyCode={currencyCode} /> of{" "}
          <MoneyText amount={invoice.totalAmount} currencyCode={currencyCode} /> has been received.
        </>
      );
      break;
    case InvoiceStatus.PAID:
      detail = "Nothing is owed on this invoice. Thank you.";
      break;
    case InvoiceStatus.VOID:
      detail = (
        <>
          {invoice.voidedAt === null ? (
            "The business withdrew this invoice."
          ) : (
            <>
              The business withdrew this invoice on{" "}
              <DateTimeText value={invoice.voidedAt} timeZone={timeZone} display="date" />.
            </>
          )}{" "}
          Nothing is owed on it.
        </>
      );
      break;
    default:
      detail = (
        <>
          Issued <DateTimeText value={invoice.issueDate} timeZone={timeZone} />.
        </>
      );
  }

  return (
    <div
      role="status"
      data-testid="portal-invoice-banner"
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4 print:hidden",
        TONES[tone(invoice.status)],
      )}
    >
      <p className="min-w-0 font-display text-xl font-semibold [overflow-wrap:anywhere]">
        {balanceHeadline(invoice, timeZone, invoice.paidOn)}
      </p>
      <p className="min-w-0 text-sm [overflow-wrap:anywhere]">{detail}</p>
    </div>
  );
}
