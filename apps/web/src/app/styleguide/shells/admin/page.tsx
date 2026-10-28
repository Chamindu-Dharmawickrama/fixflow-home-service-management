import { Banknote, CalendarCheck, FileText, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { PageHeader } from "@/components/ui/page-header";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { formatDate, formatTimeRange } from "@/lib/formatting/datetime";

import {
  BUSINESS_TIME_ZONE,
  CURRENCY_CODE,
  SAMPLE_NOW,
  TIMELINE_EVENTS,
} from "../../_lib/fixtures";
import { requireStyleguide } from "../../_lib/guard";
import { ADMIN_EXAMPLE_HOME } from "../../_lib/shell-nav";

export const metadata: Metadata = { title: "Dashboard" };

const ACTIVITY: TimelineEvent[] = TIMELINE_EVENTS.map((event) => ({ ...event }));

export default function AdminDashboardExample() {
  requireStyleguide();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Today, ${formatDate(SAMPLE_NOW, BUSINESS_TIME_ZONE)}. Start with what needs you.`}
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="New requests"
          value="7"
          context="2 waiting more than a day"
          icon={Inbox}
          href={`${ADMIN_EXAMPLE_HOME}/requests`}
        />
        <StatCard
          label="Quotations awaiting reply"
          value="4"
          context="1 expires this week"
          icon={FileText}
          href={`${ADMIN_EXAMPLE_HOME}/quotations`}
          tone="attention"
        />
        <StatCard
          label="Jobs this week"
          value="12"
          context="3 still to be scheduled"
          icon={CalendarCheck}
          href={`${ADMIN_EXAMPLE_HOME}/jobs`}
        />
        <StatCard
          label="Outstanding balance"
          value={<MoneyText amount="3416.30" currencyCode={CURRENCY_CODE} />}
          context="2 invoices overdue"
          icon={Banknote}
          href={`${ADMIN_EXAMPLE_HOME}/invoices`}
          tone="danger"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Needs attention</CardTitle>
              <CardDescription>
                Oldest first. Each one links to where you can act on it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-ink">
                      <ReferenceText reference="FF-2026-00125" /> · Morgan Reyes
                    </p>
                    <p className="text-sm text-ink-secondary">
                      New request waiting 1 hour for review
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge kind="request" status="SUBMITTED" />
                    <Button size="sm" asChild>
                      <Link href={`${ADMIN_EXAMPLE_HOME}/requests/detail`}>Review</Link>
                    </Button>
                  </div>
                </li>
                <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-ink">
                      <ReferenceText reference="QT-2026-00039" /> · Priya Shah
                    </p>
                    <p className="text-sm text-ink-secondary">
                      Accepted today; the job is not scheduled yet
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge kind="quotation" status="ACCEPTED" />
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${ADMIN_EXAMPLE_HOME}/quotations`}>Schedule</Link>
                    </Button>
                  </div>
                </li>
                <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-ink">
                      <ReferenceText reference="JOB-2026-00028" /> · Hannah Weiss
                    </p>
                    <p className="text-sm text-ink-secondary">
                      The customer asked for a different day
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge kind="workOrder" status="NEEDS_RESCHEDULING" />
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${ADMIN_EXAMPLE_HOME}/jobs`}>Reschedule</Link>
                    </Button>
                  </div>
                </li>
                <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-ink">
                      <ReferenceText reference="INV-2026-00007" /> · Daniel Okafor
                    </p>
                    <p className="text-sm text-ink-secondary">
                      <MoneyText amount="412.75" currencyCode={CURRENCY_CODE} /> overdue by 6 days
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge kind="invoice" status="OVERDUE" />
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${ADMIN_EXAMPLE_HOME}/invoices`}>Open invoice</Link>
                    </Button>
                  </div>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Upcoming jobs</CardTitle>
              <CardDescription>The next three appointments, in business time.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {[
                  [
                    "JOB-2026-00031",
                    "AC Routine Maintenance",
                    "Morgan Reyes",
                    "Jordan Lee",
                    "2026-10-29T13:00:00Z",
                    "2026-10-29T15:00:00Z",
                  ],
                  [
                    "JOB-2026-00032",
                    "Washing Machine Repair",
                    "Sofia Lindqvist",
                    "Priya Raman",
                    "2026-10-29T17:30:00Z",
                    "2026-10-29T19:00:00Z",
                  ],
                  [
                    "JOB-2026-00033",
                    "Home Deep Cleaning",
                    "Marcus Bell",
                    "Jordan Lee",
                    "2026-10-30T14:00:00Z",
                    "2026-10-30T18:00:00Z",
                  ],
                ].map(([reference, service, customer, technician, start, end]) => (
                  <li
                    key={reference}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5 text-sm">
                      <p className="font-medium text-ink tabular-nums">
                        {formatDate(start ?? "", BUSINESS_TIME_ZONE)} ·{" "}
                        {formatTimeRange(start ?? "", end ?? "", BUSINESS_TIME_ZONE)}
                      </p>
                      <p className="text-ink-secondary">
                        {service} · {customer} · {technician}
                      </p>
                    </div>
                    <StatusBadge kind="workOrder" status="SCHEDULED" />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle as="h2">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline events={ACTIVITY} timeZone={BUSINESS_TIME_ZONE} label="Recent activity" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
