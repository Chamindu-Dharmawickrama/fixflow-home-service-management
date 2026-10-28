import { CalendarClock, ClipboardList, Lock } from "lucide-react";
import type { Metadata } from "next";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { PageHeader } from "@/components/ui/page-header";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";

import { BUSINESS_TIME_ZONE } from "../../../../_lib/fixtures";
import { requireStyleguide } from "../../../../_lib/guard";
import { ADMIN_EXAMPLE_HOME } from "../../../../_lib/shell-nav";
import { RequestActions } from "./request-actions";

export const metadata: Metadata = { title: "FF-2026-00125" };

const HISTORY: TimelineEvent[] = [
  {
    id: "h2",
    title: "Request submitted",
    description: "Sent from the website by Morgan Reyes.",
    timestamp: "2026-10-28T13:42:00Z",
    actor: "Morgan Reyes",
    icon: ClipboardList,
    tone: "success",
  },
];

export default function RequestDetailExample() {
  requireStyleguide();

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Requests", href: `${ADMIN_EXAMPLE_HOME}/requests` },
          { label: "FF-2026-00125" },
        ]}
        title="AC Diagnostic Visit"
        status={<StatusBadge kind="request" status="SUBMITTED" />}
        meta={
          <>
            <ReferenceText reference="FF-2026-00125" />
            <span>
              Submitted <DateTimeText value="2026-10-28T13:42:00Z" timeZone={BUSINESS_TIME_ZONE} />
            </span>
          </>
        }
        actions={<RequestActions />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Request details</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionItem term="Service">
                  AC Diagnostic Visit · about 60 minutes
                </DescriptionItem>
                <DescriptionItem term="Problem">
                  The upstairs unit is blowing warm air and the drain line drips onto the landing.
                  It started during the heatwave last week and has got worse each day.
                </DescriptionItem>
                <DescriptionItem term="Service address">
                  48 Maple Court, Harbor City, NY 10999
                </DescriptionItem>
                <DescriptionItem term="Preferred time">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock aria-hidden="true" className="size-4 text-ink-muted" />
                    Tuesday morning (8 AM – 12 PM)
                  </span>
                </DescriptionItem>
              </DescriptionList>
            </CardContent>
          </Card>

          <Tabs defaultValue="history">
            <TabsList aria-label="Request activity">
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="notes">
                <Lock aria-hidden="true" className="size-3.5" />
                Internal notes
              </TabsTrigger>
            </TabsList>
            <TabsContent value="history">
              <Card>
                <CardContent className="pt-5 sm:pt-6">
                  <Timeline
                    events={HISTORY}
                    timeZone={BUSINESS_TIME_ZONE}
                    label="Request history"
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="notes">
              <Card>
                <CardHeader>
                  <CardTitle as="h2" className="flex items-center gap-2">
                    Internal notes
                    <Badge tone="attention">Only the business sees these</Badge>
                  </CardTitle>
                  <CardDescription>
                    Customers never see internal notes, here or in their portal.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-ink-secondary">No internal notes yet.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle as="h2">Customer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar name="Morgan Reyes" size="lg" />
              <div className="text-sm">
                <p className="font-medium text-ink">Morgan Reyes</p>
                <p className="text-ink-secondary">Customer since Oct 2026</p>
              </div>
            </div>
            <DescriptionList>
              <DescriptionItem term="Email" className="sm:block">
                morgan.reyes@demo.fixflow.test
              </DescriptionItem>
              <DescriptionItem term="Phone" className="sm:block">
                (212) 555-0114
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
