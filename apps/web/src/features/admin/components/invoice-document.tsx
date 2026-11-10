import {
  type AdminInvoiceDto,
  type CustomerInvoicePaymentDto,
  InvoiceStatus,
} from "@fixflow/shared";

import { DateTimeText } from "@/components/ui/date-time-text";
import { DocumentLines, DocumentTotals } from "@/components/ui/document";
import { MoneyText } from "@/components/ui/money-text";
import { BusinessLogo } from "@/features/catalogue/components/business-logo";
import { formatAddressLines } from "@/features/portal/lib/format-address";
import { paidDirectlyNote } from "@/features/portal/lib/invoices";
import { documentTotalRows } from "@/lib/formatting/document-totals";
import { isZeroAmount } from "@/lib/formatting/money";
import { cn } from "@/lib/utils";

import { overdueSentence } from "../lib/invoices";

export type InvoiceDocumentSource = Pick<
  AdminInvoiceDto,
  | "id"
  | "invoiceNumber"
  | "status"
  | "statusLabel"
  | "currencyCode"
  | "taxRate"
  | "lines"
  | "subtotal"
  | "discountAmount"
  | "taxAmount"
  | "totalAmount"
  | "amountPaid"
  | "balanceDue"
  | "issueDate"
  | "dueDate"
  | "daysOverdue"
  | "customerNote"
  | "business"
  | "customer"
  | "paymentInstructions"
  | "footer"
  | "serviceName"
  | "job"
>;

export interface InvoiceDocumentProps {
  invoice: InvoiceDocumentSource;
  /** The business time zone, from the settings. */
  timeZone: string;
  /** Names the document for screen readers when two are on a page (the preview over the editor). */
  idPrefix?: string | undefined;
  /**
   * The payments that stand, to print as the document's "Payments received" (the customer's page and
   * the PDF carry them). Left out, the section is not drawn: the business's page has its own panel.
   */
  payments?: readonly CustomerInvoicePaymentDto[] | undefined;
}

/**
 * The invoice as a document (FR-072, UX-QB-INV): who it is from and for, its number and dates, the
 * lines, the totals the server worked out, what has been paid and what is still owed, and how to pay.
 * Once issued every detail comes from the snapshot taken at issue, so it reads the same whatever the
 * business settings say now. Printing shows the document alone, on white, and it fits A4 and Letter:
 * the layout is a single column of block content, with no fixed widths, and tables and sections do not
 * break across pages. Every amount is a decimal string and every date is shown in the business time
 * zone.
 *
 * "Amount paid" is what the invoice records as received; this task does not record payments, so it
 * reads zero until they do.
 */
export function InvoiceDocument({
  invoice,
  timeZone,
  idPrefix = "",
  payments,
}: InvoiceDocumentProps) {
  const { business, customer } = invoice;
  const titleId = `${idPrefix}invoice-document-title`;
  const isDraft = invoice.status === InvoiceStatus.DRAFT;
  const isVoid = invoice.status === InvoiceStatus.VOID;
  const totalRows = documentTotalRows(invoice, invoice.taxRate);
  // Between the total and the balance: what has been received, never more than the server says.
  const rows = [
    ...totalRows,
    {
      label: "Amount paid",
      amount: isZeroAmount(invoice.amountPaid) ? invoice.amountPaid : `-${invoice.amountPaid}`,
    },
    { label: "Balance due", amount: invoice.balanceDue, strong: true },
  ];

  return (
    <article
      aria-labelledby={titleId}
      data-testid="invoice-document"
      className="relative flex flex-col gap-6 rounded-2xl border border-border bg-surface p-5 sm:p-8 print:gap-5 print:rounded-none print:border-0 print:p-0"
    >
      {isVoid ? (
        <p
          data-testid="invoice-void-mark"
          className="self-start rounded-md border-2 border-danger-edge px-3 py-1 text-sm font-bold tracking-widest text-danger uppercase"
        >
          Void
        </p>
      ) : null}
      {isDraft ? (
        <p
          data-testid="invoice-draft-mark"
          className="self-start rounded-md border-2 border-border-strong px-3 py-1 text-sm font-bold tracking-widest text-ink-secondary uppercase"
        >
          Draft: not issued yet
        </p>
      ) : null}

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <BusinessLogo
            businessName={business.name}
            logoKey={business.logoKey}
            logoUrl={business.logoUrl}
          />
          <address className="flex flex-col gap-0.5 text-sm not-italic text-ink-secondary">
            {formatAddressLines(business.address).map((line) => (
              <span key={line} className="break-words">
                {line}
              </span>
            ))}
            <span>{business.phone}</span>
            <span className="break-all">{business.email}</span>
          </address>
        </div>
        <div className="flex min-w-0 flex-col gap-1 sm:items-end sm:text-right">
          <p className="text-sm font-medium tracking-wide text-ink-secondary uppercase">Invoice</p>
          <h2
            id={titleId}
            className="font-display text-2xl font-semibold break-all text-ink sm:text-3xl"
          >
            {invoice.invoiceNumber ?? "Not numbered yet"}
          </h2>
          <p className="text-sm text-ink-secondary">
            {invoice.issueDate === null ? (
              "Issue date: the day it is issued"
            ) : (
              <>
                Issued <DateTimeText value={invoice.issueDate} timeZone={timeZone} />
              </>
            )}
          </p>
          <p className="text-sm font-medium text-ink">
            {invoice.dueDate === null ? null : (
              <>
                Due <DateTimeText value={invoice.dueDate} timeZone={timeZone} />
              </>
            )}
          </p>
          {invoice.status === InvoiceStatus.OVERDUE ? (
            <p className="text-sm font-semibold text-danger">
              {overdueSentence(invoice.daysOverdue)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 border-y border-border py-5 sm:grid-cols-2">
        <section aria-label="Billed to" className="flex min-w-0 flex-col gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-ink-secondary uppercase">
            Billed to
          </h3>
          <p className="text-base font-semibold break-words text-ink">{customer.name}</p>
          <address className="flex flex-col text-sm not-italic text-ink-secondary">
            {formatAddressLines(customer.address).map((line) => (
              <span key={line} className="break-words">
                {line}
              </span>
            ))}
            <span className="break-all">{customer.email}</span>
          </address>
        </section>
        <section aria-label="Service" className="flex min-w-0 flex-col gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-ink-secondary uppercase">
            Service
          </h3>
          <p className="text-base font-semibold break-words text-ink">{invoice.serviceName}</p>
          <p className="text-sm text-ink-secondary">For job {invoice.job.reference}</p>
        </section>
      </div>

      <DocumentLines
        caption={`Lines of invoice ${invoice.invoiceNumber ?? "draft"}`}
        currencyCode={invoice.currencyCode}
        className="print:break-inside-avoid"
        lines={invoice.lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          taxable: line.taxable,
        }))}
      />

      <DocumentTotals
        currencyCode={invoice.currencyCode}
        rows={rows}
        className="print:break-inside-avoid"
      />

      {invoice.customerNote ? (
        <section aria-label="Note" className="flex flex-col gap-1 print:break-inside-avoid">
          <h3 className="text-sm font-semibold text-ink">Note from {business.name}</h3>
          <p className="text-sm break-words whitespace-pre-line text-ink-secondary">
            {invoice.customerNote}
          </p>
        </section>
      ) : null}

      {payments === undefined || isDraft ? null : (
        <section
          aria-labelledby={`${idPrefix}invoice-payments-heading`}
          data-testid="invoice-document-payments"
          className="flex flex-col gap-2 print:break-inside-avoid"
        >
          <h3
            id={`${idPrefix}invoice-payments-heading`}
            className="text-xs font-semibold tracking-wide text-ink-secondary uppercase"
          >
            Payments received
          </h3>
          {payments.length === 0 ? (
            <p className="text-sm text-ink-secondary">No payments have been recorded yet.</p>
          ) : (
            <ul
              aria-label="Payments received"
              className="flex flex-col divide-y divide-border text-sm"
            >
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                >
                  <span className="min-w-0 text-ink">
                    <DateTimeText value={payment.paymentDate} timeZone={timeZone} />
                    <span className="text-ink-secondary"> · {payment.methodLabel}</span>
                  </span>
                  <MoneyText
                    amount={payment.amount}
                    currencyCode={invoice.currencyCode}
                    className="font-medium text-ink"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {invoice.paymentInstructions && !isVoid ? (
        <section
          aria-label="How to pay"
          className={cn(
            "flex flex-col gap-1 rounded-xl bg-surface-muted p-4",
            "print:break-inside-avoid print:border print:border-border print:bg-transparent",
          )}
        >
          <h3 className="text-sm font-semibold text-ink">How to pay</h3>
          <p className="text-sm break-words whitespace-pre-line text-ink-secondary">
            {invoice.paymentInstructions}
          </p>
          {invoice.invoiceNumber === null ? null : (
            <p className="text-sm font-medium text-ink">
              Please quote {invoice.invoiceNumber} with your payment.
            </p>
          )}
          <p className="text-xs text-ink-secondary">{paidDirectlyNote(business.name)}</p>
        </section>
      ) : null}

      {invoice.footer ? (
        <footer className="border-t border-border pt-4 text-center text-xs break-words whitespace-pre-line text-ink-secondary print:break-inside-avoid">
          {invoice.footer}
        </footer>
      ) : null}
    </article>
  );
}
