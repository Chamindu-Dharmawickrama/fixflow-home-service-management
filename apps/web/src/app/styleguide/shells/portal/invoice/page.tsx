import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DocumentLines, DocumentTotals } from "@/components/ui/document";
import { MoneyText } from "@/components/ui/money-text";
import { PageHeader } from "@/components/ui/page-header";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusMeta } from "@/lib/formatting/status";

import {
  BUSINESS_NAME,
  BUSINESS_TIME_ZONE,
  CURRENCY_CODE,
  DOCUMENT_LINES,
  DOCUMENT_TOTALS,
} from "../../../_lib/fixtures";
import { requireStyleguide } from "../../../_lib/guard";
import { PORTAL_EXAMPLE_HOME } from "../../../_lib/shell-nav";

export const metadata: Metadata = { title: "Invoice INV-2026-00007" };

export default function PortalInvoiceExample() {
  requireStyleguide();

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Overview", href: PORTAL_EXAMPLE_HOME },
          { label: "INV-2026-00007" },
        ]}
        title="Invoice for AC Diagnostic Visit"
        status={<StatusBadge kind="invoice" status="PARTIALLY_PAID" />}
        meta={
          <>
            <ReferenceText reference="INV-2026-00007" />
            <span>
              Issued <DateTimeText value="2026-10-28" timeZone={BUSINESS_TIME_ZONE} />
            </span>
            <span>
              Due <DateTimeText value="2026-11-11" timeZone={BUSINESS_TIME_ZONE} />
            </span>
          </>
        }
        description={getStatusMeta("invoice", "PARTIALLY_PAID").description}
      />

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle as="h2">{BUSINESS_NAME}</CardTitle>
            <CardDescription>48 Harbor Point Road, Unit 3, Harbor City, NY 10999</CardDescription>
            <CardDescription>hello@coolbreeze.test · (212) 555-0142</CardDescription>
          </div>
          <div className="text-sm sm:text-right">
            <p className="text-ink-secondary">Billed to</p>
            <p className="font-medium text-ink">Morgan Reyes</p>
            <p className="text-ink-secondary">48 Maple Court, Harbor City</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DocumentLines
            lines={DOCUMENT_LINES}
            currencyCode={CURRENCY_CODE}
            caption="Invoice lines"
          />
          <DocumentTotals
            currencyCode={CURRENCY_CODE}
            rows={[
              { label: "Subtotal", amount: DOCUMENT_TOTALS.subtotal },
              { label: `Tax (${DOCUMENT_TOTALS.taxRate}%)`, amount: DOCUMENT_TOTALS.tax },
              { label: "Invoice total", amount: DOCUMENT_TOTALS.total },
              { label: "Payments recorded", amount: DOCUMENT_TOTALS.amountPaid },
              { label: "Balance due", amount: DOCUMENT_TOTALS.balance, strong: true },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Payments recorded</CardTitle>
            <CardDescription>The business records payments it receives.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              <li className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-0.5">
                  <MoneyText
                    amount="100.00"
                    currencyCode={CURRENCY_CODE}
                    className="font-medium text-ink"
                  />
                  <span className="text-ink-secondary">
                    Bank transfer ·{" "}
                    <DateTimeText value="2026-10-28" timeZone={BUSINESS_TIME_ZONE} />
                  </span>
                </div>
                <StatusBadge kind="payment" status="RECORDED" />
              </li>
              <li className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-0.5">
                  <MoneyText
                    amount="50.00"
                    currencyCode={CURRENCY_CODE}
                    className="font-medium text-ink-muted line-through"
                  />
                  <span className="text-ink-secondary">
                    Cash · <DateTimeText value="2026-10-28" timeZone={BUSINESS_TIME_ZONE} /> ·
                    entered twice
                  </span>
                </div>
                <StatusBadge kind="payment" status="VOID" />
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">How to pay</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-ink-secondary">
            <p>
              Pay by bank transfer, cheque or in person at our office, quoting the invoice number as
              your payment reference. We never ask for card details by phone or email. Bank details
              are provided on request.
            </p>
            <p>
              Payments appear here once the business has recorded them. FixFlow does not take
              payments online.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
