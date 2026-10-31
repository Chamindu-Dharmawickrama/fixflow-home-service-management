import type { QuotationDocumentDto } from "@fixflow/shared";

import { DateTimeText } from "@/components/ui/date-time-text";
import { DocumentLines, DocumentTotals } from "@/components/ui/document";
import { BusinessLogo } from "@/features/catalogue/components/business-logo";
import { formatAddressLines } from "@/features/portal/lib/format-address";
import { documentTotalRows } from "@/lib/formatting/document-totals";

export interface QuotationDocumentProps {
  quotation: QuotationDocumentDto;
  /** The business time zone, from the settings. */
  timeZone: string;
  /** Names the document for screen readers when two are on a page (the preview over the editor). */
  idPrefix?: string | undefined;
}

/**
 * The quotation as a document (FR-043, UX-QB-QUO): who it is from and for, the lines, the totals the
 * server worked out, the note and the terms, and the last day it is valid. The business's read-only
 * view, the preview a draft is checked with and (T15) the customer's page all draw this, so what an
 * admin previews is what the customer reads. It takes {@link QuotationDocumentDto}, which has nothing
 * internal in it. Every amount is a decimal string and every date is shown in the business time
 * zone. Printing shows the document alone, on white.
 */
export function QuotationDocument({ quotation, timeZone, idPrefix = "" }: QuotationDocumentProps) {
  const { business, address } = quotation;
  const titleId = `${idPrefix}quotation-document-title`;

  return (
    <article
      aria-labelledby={titleId}
      data-testid="quotation-document"
      className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-5 sm:p-8 print:rounded-none print:border-0 print:p-0"
    >
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
        <div className="flex flex-col gap-1 sm:items-end sm:text-right">
          <p className="text-sm font-medium tracking-wide text-ink-secondary uppercase">
            Quotation
          </p>
          <h2
            id={titleId}
            className="font-display text-2xl font-semibold break-all text-ink sm:text-3xl"
          >
            {quotation.reference}
          </h2>
          <p className="text-sm text-ink-secondary">
            {quotation.sentAt === null ? (
              "Not sent yet"
            ) : (
              <>
                Sent <DateTimeText value={quotation.sentAt} timeZone={timeZone} display="date" />
              </>
            )}
          </p>
          <p className="text-sm font-medium text-ink">
            Valid until <DateTimeText value={quotation.validUntil} timeZone={timeZone} />
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 border-y border-border py-5 sm:grid-cols-2">
        <section aria-label="Prepared for" className="flex min-w-0 flex-col gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-ink-secondary uppercase">
            Prepared for
          </h3>
          <p className="text-base font-semibold break-words text-ink">{quotation.customerName}</p>
          <address className="flex flex-col text-sm not-italic text-ink-secondary">
            {formatAddressLines(address).map((line) => (
              <span key={line} className="break-words">
                {line}
              </span>
            ))}
          </address>
        </section>
        <section aria-label="Service" className="flex min-w-0 flex-col gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-ink-secondary uppercase">
            Service
          </h3>
          <p className="text-base font-semibold break-words text-ink">{quotation.serviceName}</p>
          <p className="text-sm text-ink-secondary">For request {quotation.requestReference}</p>
        </section>
      </div>

      <DocumentLines
        caption={`Lines of quotation ${quotation.reference}`}
        currencyCode={quotation.currencyCode}
        lines={quotation.lines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          taxable: line.taxable,
        }))}
      />

      <DocumentTotals
        currencyCode={quotation.currencyCode}
        rows={documentTotalRows(quotation, quotation.taxRate)}
      />

      {quotation.customerNote ? (
        <section aria-label="Note" className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink">Note from {business.name}</h3>
          <p className="text-sm break-words whitespace-pre-line text-ink-secondary">
            {quotation.customerNote}
          </p>
        </section>
      ) : null}

      {quotation.terms ? (
        <section
          aria-label="Terms"
          className="flex flex-col gap-1 rounded-xl bg-surface-muted p-4 print:border print:border-border print:bg-transparent"
        >
          <h3 className="text-sm font-semibold text-ink">Terms</h3>
          <p className="text-sm break-words whitespace-pre-line text-ink-secondary">
            {quotation.terms}
          </p>
        </section>
      ) : null}
    </article>
  );
}
