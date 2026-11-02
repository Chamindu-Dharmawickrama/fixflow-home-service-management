import { type CustomerQuotationSummaryDto, QuotationStatus } from "@fixflow/shared";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";

import { daysUntilValidUntil, portalQuotationPath, remainingDaysText } from "../lib/quotations";

export interface RequestQuotationsCardProps {
  /** The quotations the customer was sent for this request, newest first. */
  quotations: readonly CustomerQuotationSummaryDto[];
  timeZone: string;
  /** When the page is drawn: how many days are left is measured from it. */
  now: Date;
}

/** What the current quotation needs from the customer, or tells them, in one sentence. */
function currentSentence(
  quotation: CustomerQuotationSummaryDto,
  timeZone: string,
  now: Date,
): ReactNode {
  const validUntil = <DateTimeText value={quotation.validUntil} timeZone={timeZone} />;
  switch (quotation.status) {
    case QuotationStatus.SENT:
      return (
        <>
          Waiting for your answer —{" "}
          {remainingDaysText(daysUntilValidUntil(quotation.validUntil, now, timeZone))}.
        </>
      );
    case QuotationStatus.ACCEPTED:
      return (
        <>
          You accepted it
          {quotation.respondedAt === null ? null : (
            <>
              {" "}
              on <DateTimeText value={quotation.respondedAt} timeZone={timeZone} display="date" />
            </>
          )}
          . We&apos;ll contact you to schedule the work.
        </>
      );
    case QuotationStatus.DECLINED:
      return (
        <>
          You declined it
          {quotation.respondedAt === null ? null : (
            <>
              {" "}
              on <DateTimeText value={quotation.respondedAt} timeZone={timeZone} display="date" />
            </>
          )}
          . No work will be scheduled from it.
        </>
      );
    case QuotationStatus.EXPIRED:
      return <>It expired after {validUntil}. Contact us for an updated quote.</>;
    case QuotationStatus.VOID:
      return <>We withdrew it. It can no longer be accepted.</>;
    default:
      return null;
  }
}

/**
 * The request's quotation (FR-044, IA-C02): the current one with its status, total and how long the
 * customer has, and the way to open it; the earlier versions beneath, each pointing to the one that
 * replaced it. Nothing is drawn when the customer has not been sent one (a draft is not theirs yet);
 * "What happens next" says what they are waiting for.
 */
export function RequestQuotationsCard({ quotations, timeZone, now }: RequestQuotationsCardProps) {
  const [current, ...earlier] = quotations;
  if (current === undefined) {
    return null;
  }
  const open = current.status === QuotationStatus.SENT;

  return (
    <Card aria-labelledby="request-quotation-heading" role="region">
      <CardHeader>
        <CardTitle as="h2" id="request-quotation-heading">
          {earlier.length === 0 ? "Quotation" : "Current quotation"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3" data-testid="current-quotation">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ReferenceText reference={current.reference} className="text-base text-ink" />
            <StatusBadge kind="quotation" status={current.status} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-secondary">Total</dt>
            <dd className="font-semibold text-ink">
              <MoneyText amount={current.totalAmount} currencyCode={current.currencyCode} />
            </dd>
            <dt className="text-ink-secondary">Valid until</dt>
            <dd className="text-ink">
              <DateTimeText value={current.validUntil} timeZone={timeZone} />
            </dd>
          </dl>
          <p className="text-sm text-ink-secondary">{currentSentence(current, timeZone, now)}</p>
          <div>
            <Link
              href={portalQuotationPath(current.id)}
              className={buttonVariants({ variant: open ? "primary" : "outline" })}
            >
              Review quotation
              {/* The space sits outside the hidden span, which would otherwise trim it away. */}{" "}
              <span className="sr-only">{current.reference}</span>
            </Link>
          </div>
        </div>

        {earlier.length === 0 ? null : (
          <section aria-labelledby="earlier-quotations-heading" className="flex flex-col gap-2">
            <h3 id="earlier-quotations-heading" className="text-sm font-semibold text-ink">
              Earlier versions
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {earlier.map((quotation) => (
                <li key={quotation.id} className="flex flex-col gap-1 p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={portalQuotationPath(quotation.id)}
                      className="font-medium text-brand underline-offset-4 hover:underline"
                    >
                      <ReferenceText reference={quotation.reference} />
                    </Link>
                    <StatusBadge kind="quotation" status={quotation.status} />
                  </span>
                  {quotation.replacedBy === null ? null : (
                    <span className="text-ink-secondary">
                      Replaced by{" "}
                      <Link
                        href={portalQuotationPath(quotation.replacedBy.id)}
                        className="font-medium text-brand underline-offset-4 hover:underline"
                      >
                        {quotation.replacedBy.reference}
                      </Link>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
