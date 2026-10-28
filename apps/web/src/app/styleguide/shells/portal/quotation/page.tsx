import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DocumentLines, DocumentTotals } from "@/components/ui/document";
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
import { DecisionActions } from "./decision-actions";

export const metadata: Metadata = { title: "Quotation QT-2026-00042" };

export default function PortalQuotationExample() {
  requireStyleguide();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Overview", href: PORTAL_EXAMPLE_HOME }, { label: "QT-2026-00042" }]}
        title="Quotation for AC Diagnostic Visit"
        status={<StatusBadge kind="quotation" status="SENT" />}
        meta={
          <>
            <ReferenceText reference="QT-2026-00042" />
            <span>
              Valid until <DateTimeText value="2026-11-11" timeZone={BUSINESS_TIME_ZONE} />
            </span>
          </>
        }
        description={getStatusMeta("quotation", "SENT").description}
      />

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle as="h2">{BUSINESS_NAME}</CardTitle>
            <CardDescription>48 Harbor Point Road, Unit 3, Harbor City, NY 10999</CardDescription>
            <CardDescription>hello@coolbreeze.test · (212) 555-0142</CardDescription>
          </div>
          <div className="text-sm sm:text-right">
            <p className="text-ink-secondary">Prepared for</p>
            <p className="font-medium text-ink">Morgan Reyes</p>
            <p className="text-ink-secondary">48 Maple Court, Harbor City</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DocumentLines
            lines={DOCUMENT_LINES}
            currencyCode={CURRENCY_CODE}
            caption="Quotation lines"
          />
          <DocumentTotals
            currencyCode={CURRENCY_CODE}
            rows={[
              { label: "Subtotal", amount: DOCUMENT_TOTALS.subtotal },
              { label: `Tax (${DOCUMENT_TOTALS.taxRate}%)`, amount: DOCUMENT_TOTALS.tax },
              { label: "Total", amount: DOCUMENT_TOTALS.total, strong: true },
            ]}
          />
          <div className="rounded-lg bg-surface-muted p-4 text-sm text-ink-secondary">
            <p className="font-medium text-ink">Terms</p>
            <p className="mt-1">
              Prices are based on the information in your request and are valid until the date
              shown. Any extra work found on site is quoted and agreed with you before it starts.
              Workmanship is guaranteed for 30 days.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Your decision</CardTitle>
          <CardDescription>Nothing is scheduled until you accept.</CardDescription>
        </CardHeader>
        <CardContent>
          <DecisionActions />
        </CardContent>
      </Card>
    </>
  );
}
