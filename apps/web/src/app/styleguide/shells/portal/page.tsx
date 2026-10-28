import { CalendarCheck, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { PageHeader } from "@/components/ui/page-header";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatTimeRange } from "@/lib/formatting/datetime";
import { getStatusMeta } from "@/lib/formatting/status";

import { BUSINESS_TIME_ZONE, CURRENCY_CODE } from "../../_lib/fixtures";
import { requireStyleguide } from "../../_lib/guard";
import { PORTAL_EXAMPLE_HOME } from "../../_lib/shell-nav";

export const metadata: Metadata = { title: "Overview" };

export default function PortalOverviewExample() {
  requireStyleguide();

  return (
    <>
      <PageHeader
        title="Hello, Morgan"
        description="Here is where your requests, appointments and invoices stand."
      />

      <Card className="border-attention-edge">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle as="h2">A quotation is waiting for your answer</CardTitle>
            <StatusBadge kind="quotation" status="SENT" />
          </div>
          <CardDescription>
            <ReferenceText reference="QT-2026-00042" /> · AC Diagnostic Visit
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">
            <MoneyText
              amount="360.18"
              currencyCode={CURRENCY_CODE}
              className="text-lg font-semibold text-ink"
            />
            <span className="block">
              Valid until <DateTimeText value="2026-11-11" timeZone={BUSINESS_TIME_ZONE} />
            </span>
          </p>
          <Button size="lg" asChild>
            <Link href={`${PORTAL_EXAMPLE_HOME}/quotation`}>Review quotation</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle as="h2">Upcoming appointment</CardTitle>
              <StatusBadge kind="workOrder" status="SCHEDULED" />
            </div>
            <CardDescription>
              <ReferenceText reference="JOB-2026-00031" /> · AC Routine Maintenance
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-ink">
              <CalendarCheck aria-hidden="true" className="size-4 text-accent" />
              {formatDate("2026-10-29T13:00:00Z", BUSINESS_TIME_ZONE)} ·{" "}
              {formatTimeRange("2026-10-29T13:00:00Z", "2026-10-29T15:00:00Z", BUSINESS_TIME_ZONE)}
            </p>
            <p className="flex items-center gap-2 text-ink-secondary">
              <MapPin aria-hidden="true" className="size-4 text-ink-muted" />
              48 Maple Court, Harbor City
            </p>
            <p className="text-ink-secondary">
              {getStatusMeta("workOrder", "SCHEDULED").description}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle as="h2">Invoice balance</CardTitle>
              <StatusBadge kind="invoice" status="PARTIALLY_PAID" />
            </div>
            <CardDescription>
              <ReferenceText reference="INV-2026-00007" /> · Home Deep Cleaning
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-secondary">
              <MoneyText
                amount="260.18"
                currencyCode={CURRENCY_CODE}
                className="text-2xl font-semibold text-ink"
              />
              <span className="block">
                still due by <DateTimeText value="2026-11-11" timeZone={BUSINESS_TIME_ZONE} />
              </span>
            </p>
            <Button variant="outline" className="self-start" asChild>
              <Link href={`${PORTAL_EXAMPLE_HOME}/invoice`}>View invoice</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Your recent requests</CardTitle>
          <CardDescription>Each status says what happens next.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {(
              [
                ["FF-2026-00125", "AC Diagnostic Visit", "QUOTED"],
                ["FF-2026-00098", "AC Routine Maintenance", "CONVERTED_TO_JOB"],
                ["FF-2026-00071", "Home Deep Cleaning", "CONVERTED_TO_JOB"],
              ] as const
            ).map(([reference, service, status]) => (
              <li
                key={reference}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5 text-sm">
                  <p className="font-medium text-ink">
                    <ReferenceText reference={reference} /> · {service}
                  </p>
                  <p className="text-ink-secondary">
                    {getStatusMeta("request", status).description}
                  </p>
                </div>
                <StatusBadge kind="request" status={status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
