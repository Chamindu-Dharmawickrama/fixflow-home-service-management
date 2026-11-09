import { type AdminInvoiceDto, InvoiceStatus } from "@fixflow/shared";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { cn } from "@/lib/utils";

import { overdueSentence } from "../lib/invoices";
import { adminJobPath } from "../lib/jobs";
import { adminQuotationPath } from "../lib/quotations";
import { adminRequestPath } from "../lib/requests-queue";

interface CardProps {
  invoice: AdminInvoiceDto;
  timeZone: string;
}

const BANNER_TONES = {
  info: "border-border bg-surface-muted text-ink",
  success: "border-success-edge bg-success-soft text-success",
  danger: "border-danger-edge bg-danger-soft text-danger",
  neutral: "border-border bg-surface-muted text-ink",
} as const;

function Banner({
  tone,
  headline,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  headline: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid="invoice-banner"
      className={cn("flex flex-col gap-1 rounded-xl border p-4 print:hidden", BANNER_TONES[tone])}
    >
      <p className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{headline}</p>
      {children === undefined ? null : (
        <div className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</div>
      )}
    </div>
  );
}

/**
 * Where an invoice that is no longer a draft stands, in a sentence (UX-QB-INV): "Issued Mar 2, 2026 ·
 * due Mar 16, 2026", "Overdue by 4 days", "Voided: the reason". The reason is the team's own words and
 * is labelled as internal; nothing here is ever served to a customer. A draft has no banner: the
 * editor says what it is.
 */
export function InvoiceStatusBanner({ invoice, timeZone }: CardProps) {
  const due =
    invoice.dueDate === null ? null : <DateTimeText value={invoice.dueDate} timeZone={timeZone} />;
  const issued =
    invoice.issuedAt === null ? null : (
      <DateTimeText value={invoice.issuedAt} timeZone={timeZone} display="date" />
    );

  switch (invoice.status) {
    case InvoiceStatus.ISSUED:
      return (
        <Banner
          tone="info"
          headline={
            <>
              Issued {issued} · due {due}
            </>
          }
        >
          {invoice.customer.name} was told in their portal and by email. The contents are locked: to
          correct anything, void this invoice and start a new one.
        </Banner>
      );
    case InvoiceStatus.OVERDUE:
      return (
        <Banner tone="danger" headline={overdueSentence(invoice.daysOverdue)}>
          It was due {due}. The balance is still unpaid. Contact {invoice.customer.name} about
          payment.
        </Banner>
      );
    case InvoiceStatus.PARTIALLY_PAID:
      return (
        <Banner tone="info" headline={<>Partly paid · due {due}</>}>
          Part of the invoice has been paid; the rest is still owed.
        </Banner>
      );
    case InvoiceStatus.PAID:
      return (
        <Banner tone="success" headline="Paid in full">
          Nothing is owed on this invoice.
        </Banner>
      );
    case InvoiceStatus.VOID:
      return (
        <Banner
          tone="danger"
          headline={
            <>
              Voided
              {invoice.voided === null ? null : (
                <>
                  {" "}
                  <DateTimeText value={invoice.voided.at} timeZone={timeZone} display="date" />
                  {`: ${invoice.voided.reason}`}
                </>
              )}
            </>
          }
        >
          The reason is internal: only your team sees it.{" "}
          {invoice.invoiceNumber === null
            ? "The customer never saw this draft."
            : "The customer was told it was voided. The job can be invoiced again."}
        </Banner>
      );
    default:
      return null;
  }
}

/** Who did what and when, for the team, and where the invoice came from. */
export function InvoiceDetailsCard({ invoice, timeZone }: CardProps) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">Details</CardTitle>
        <CardDescription>For your team. The customer does not see this card.</CardDescription>
      </CardHeader>
      <CardContent>
        <DescriptionList>
          <DescriptionItem term="Started by">
            {invoice.createdBy.name}, <DateTimeText value={invoice.createdAt} timeZone={timeZone} />
          </DescriptionItem>
          {invoice.issuedAt !== null && invoice.issuedBy !== null ? (
            <DescriptionItem term="Issued by">
              {invoice.issuedBy.name}, <DateTimeText value={invoice.issuedAt} timeZone={timeZone} />
            </DescriptionItem>
          ) : null}
          {invoice.voided !== null ? (
            <DescriptionItem term="Voided by">
              {invoice.voided.by?.name ?? "The system"},{" "}
              <DateTimeText value={invoice.voided.at} timeZone={timeZone} />
              <span className="mt-1 block text-ink-secondary">
                Reason (internal):{" "}
                <span className="whitespace-pre-line [overflow-wrap:anywhere]">
                  {invoice.voided.reason}
                </span>
              </span>
            </DescriptionItem>
          ) : null}
          <DescriptionItem term="Job">
            <Link
              href={adminJobPath(invoice.job.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              {invoice.job.reference}
            </Link>
          </DescriptionItem>
          <DescriptionItem term="Request">
            <Link
              href={adminRequestPath(invoice.request.id)}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              {invoice.request.reference}
            </Link>
          </DescriptionItem>
          {invoice.quotation === null ? null : (
            <DescriptionItem term="Quotation">
              <Link
                href={adminQuotationPath(invoice.quotation.id)}
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                {invoice.quotation.reference}
              </Link>
            </DescriptionItem>
          )}
        </DescriptionList>
      </CardContent>
    </Card>
  );
}

/** Everything that happened to this invoice, oldest first, with what the customer was shown. */
export function InvoiceHistoryCard({ invoice, timeZone }: CardProps) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle as="h2">History</CardTitle>
        <CardDescription>Everything that happened, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline
          variant="admin"
          events={invoice.timeline}
          timeZone={timeZone}
          label="Invoice history"
          emptyMessage="Nothing has happened yet."
        />
      </CardContent>
    </Card>
  );
}
