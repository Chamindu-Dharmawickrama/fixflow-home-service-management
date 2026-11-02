import { type CustomerQuotationListItemDto, QuotationStatus } from "@fixflow/shared";
import { FileCheck } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { cn } from "@/lib/utils";

import {
  daysUntilValidUntil,
  isRunningOut,
  portalQuotationPath,
  remainingDaysText,
} from "../lib/quotations";

export interface AwaitingDecisionProps {
  /** Quotations still open to an answer, soonest to run out first. */
  quotations: readonly CustomerQuotationListItemDto[];
  timeZone: string;
  /** When the page is drawn: how many days are left is measured from it. */
  now: Date;
}

/**
 * "Awaiting your decision" on the portal home (IA-C01, FR-044): the quotations the customer has been
 * sent and not yet answered, with the total and how long they have, each opening its page. It leads
 * the page, in the brand's colour, because it is the one thing the business is waiting on them for.
 * With none waiting nothing is drawn: an empty "awaiting" box would only add noise.
 */
export function AwaitingDecision({ quotations, timeZone, now }: AwaitingDecisionProps) {
  // The list is of the stored status; one that has just run out is not waiting for an answer.
  const open = quotations.filter((quotation) => quotation.status === QuotationStatus.SENT);
  if (open.length === 0) {
    return null;
  }

  return (
    <Card
      role="region"
      aria-labelledby="awaiting-decision-heading"
      data-testid="awaiting-decision"
      className="border-brand/30 bg-brand-soft"
    >
      <CardHeader>
        <CardTitle as="h2" id="awaiting-decision-heading" className="flex items-center gap-2">
          <FileCheck aria-hidden="true" className="size-5 shrink-0 text-brand" />
          Awaiting your decision
        </CardTitle>
        <CardDescription>
          {open.length === 1
            ? "We sent you a quotation. Nothing is scheduled until you accept it."
            : `We sent you ${open.length} quotations. Nothing is scheduled until you accept.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {open.map((quotation) => {
            const days = daysUntilValidUntil(quotation.validUntil, now, timeZone);
            return (
              <li
                key={quotation.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ReferenceText reference={quotation.reference} className="text-base text-ink" />
                    <span className="text-sm break-words text-ink-secondary">
                      {quotation.serviceName}
                    </span>
                  </p>
                  <p className="text-sm text-ink-secondary">
                    Total{" "}
                    <MoneyText
                      amount={quotation.totalAmount}
                      currencyCode={quotation.currencyCode}
                      className="font-semibold text-ink"
                    />
                    . Valid until <DateTimeText value={quotation.validUntil} timeZone={timeZone} />{" "}
                    <span className={cn(isRunningOut(days) && "font-semibold text-attention")}>
                      — {remainingDaysText(days)}
                    </span>
                    .
                  </p>
                </div>
                <Link
                  href={portalQuotationPath(quotation.id)}
                  className={cn(buttonVariants(), "shrink-0")}
                >
                  Review quotation
                  {/* The space sits outside the hidden span, which would otherwise trim it away. */}{" "}
                  <span className="sr-only">{quotation.reference}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
