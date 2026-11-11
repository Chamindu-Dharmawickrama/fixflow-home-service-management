import { type CustomerInvoiceListItemDto } from "@fixflow/shared";
import { Receipt } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { invoicesFilterHref } from "../lib/invoices";
import { InvoiceList } from "./invoice-cards";

export interface OutstandingInvoicesProps {
  /** The first few invoices that still owe money, the soonest due first. */
  invoices: readonly CustomerInvoiceListItemDto[];
  /** All the customer owes on, so the link can say there are more. */
  totalItems: number;
  timeZone: string;
  /** The heading level of the card's title: `h3` when a section heading sits above it. */
  headingAs?: "h2" | "h3";
}

/**
 * "Outstanding invoices" on the portal overview (IA-C01, FR-072): what is owed and by when, each card
 * opening its invoice. It sits after the quotations awaiting a decision and before the visits, because an
 * unpaid bill is something the customer may need to act on. With nothing owed nothing is drawn: a
 * box that says "nothing to pay" would only add noise (the invoices page has the full history).
 */
export function OutstandingInvoices({
  invoices,
  totalItems,
  timeZone,
  headingAs = "h2",
}: OutstandingInvoicesProps) {
  if (invoices.length === 0) {
    return null;
  }
  return (
    <Card aria-labelledby="outstanding-invoices-heading" role="region">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle
            as={headingAs}
            id="outstanding-invoices-heading"
            className="flex items-center gap-2"
          >
            <Receipt aria-hidden="true" className="size-5 shrink-0 text-brand" />
            Outstanding invoices
          </CardTitle>
          <CardDescription>
            {totalItems === 1
              ? "You have an invoice that still has a balance to pay."
              : `You have ${totalItems} invoices that still have a balance to pay.`}
          </CardDescription>
        </div>
        <Link
          href={invoicesFilterHref("all")}
          className="rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          View all invoices
        </Link>
      </CardHeader>
      <CardContent>
        <InvoiceList invoices={invoices} timeZone={timeZone} label="Outstanding invoices" />
      </CardContent>
    </Card>
  );
}
