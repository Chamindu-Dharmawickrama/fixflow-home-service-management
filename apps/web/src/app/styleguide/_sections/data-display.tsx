import type { AdminTimelineEventDto, CustomerTimelineEventDto } from "@fixflow/shared";
import { CalendarCheck, FileText, Inbox, TriangleAlert } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateTimeText } from "@/components/ui/date-time-text";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { MoneyText } from "@/components/ui/money-text";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { ActivityTimeline } from "@/features/activity/components/activity-timeline";
import { formatRelative } from "@/lib/formatting/datetime";

import { BUSINESS_TIME_ZONE, CURRENCY_CODE, SAMPLE_NOW, TIMELINE_EVENTS } from "../_lib/fixtures";
import { Section, Specimen } from "../_lib/section";

const EVENTS: TimelineEvent[] = TIMELINE_EVENTS.map((event, index) => ({
  ...event,
  icon: [FileText, Inbox, Inbox, CalendarCheck][index],
}));

/** What the API returns to staff for one request: one internal entry among the customer-visible ones. */
const ADMIN_ACTIVITY: AdminTimelineEventDto[] = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    action: "request.submitted",
    entityType: "SERVICE_REQUEST",
    entityId: "b1000000-0000-4000-8000-000000000001",
    fromStatus: null,
    toStatus: "SUBMITTED",
    summary: "Alex Morgan submitted request FF-2026-00125.",
    publicSummary: "You sent your request FF-2026-00125.",
    customerVisible: true,
    metadata: { requestReference: "FF-2026-00125" },
    actor: { name: "Alex Morgan", role: "CUSTOMER" },
    createdAt: "2026-10-26T14:05:00.000Z",
  },
  {
    id: "a1000000-0000-4000-8000-000000000002",
    action: "request.note_added",
    entityType: "SERVICE_REQUEST",
    entityId: "b1000000-0000-4000-8000-000000000001",
    fromStatus: null,
    toStatus: null,
    summary: "Morgan Reyes added an internal note about parts availability.",
    publicSummary: null,
    customerVisible: false,
    metadata: { visibility: "INTERNAL" },
    actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    createdAt: "2026-10-26T15:20:00.000Z",
  },
  {
    id: "a1000000-0000-4000-8000-000000000003",
    action: "quotation.sent",
    entityType: "QUOTATION",
    entityId: "c1000000-0000-4000-8000-000000000001",
    fromStatus: "DRAFT",
    toStatus: "SENT",
    summary: "Morgan Reyes sent quotation QT-2026-00054 to Alex Morgan.",
    publicSummary: "We sent you quotation QT-2026-00054.",
    customerVisible: true,
    metadata: { quotationReference: "QT-2026-00054", totalAmount: "284.40", currencyCode: "USD" },
    actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    createdAt: "2026-10-27T13:10:00.000Z",
  },
  {
    id: "a1000000-0000-4000-8000-000000000004",
    action: "quotation.expired",
    entityType: "QUOTATION",
    entityId: "c1000000-0000-4000-8000-000000000001",
    fromStatus: "SENT",
    toStatus: "EXPIRED",
    summary: "The system expired quotation QT-2026-00054 because its valid-until date passed.",
    publicSummary: "We marked quotation QT-2026-00054 as expired.",
    customerVisible: true,
    metadata: { quotationReference: "QT-2026-00054" },
    actor: null,
    createdAt: "2026-10-28T05:00:00.000Z",
  },
];

/** The same request as its customer sees it: no internal entry, no staff names, no metadata. */
const CUSTOMER_ACTIVITY: CustomerTimelineEventDto[] = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    publicSummary: "You sent your request FF-2026-00125.",
    toStatus: "SUBMITTED",
    actor: "You",
    createdAt: "2026-10-26T14:05:00.000Z",
  },
  {
    id: "a1000000-0000-4000-8000-000000000003",
    publicSummary: "We sent you quotation QT-2026-00054.",
    toStatus: "SENT",
    actor: "CoolBreeze Home Services",
    createdAt: "2026-10-27T13:10:00.000Z",
  },
  {
    id: "a1000000-0000-4000-8000-000000000004",
    publicSummary: "We marked quotation QT-2026-00054 as expired.",
    toStatus: "EXPIRED",
    actor: "CoolBreeze Home Services",
    createdAt: "2026-10-28T05:00:00.000Z",
  },
];

export function DataDisplaySection() {
  return (
    <Section
      id="data-display"
      title="Data display"
      description="Money, dates and references are rendered only through these components, which format through lib/formatting: money from decimal strings with an explicit currency, and dates in the business time zone, never the browser's."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Money, dates and references">
          <DescriptionList>
            <DescriptionItem term="Money">
              <MoneyText amount="1284.50" currencyCode={CURRENCY_CODE} className="font-medium" />
            </DescriptionItem>
            <DescriptionItem term="Negative (credit)">
              <MoneyText amount="-45.00" currencyCode={CURRENCY_CODE} />
            </DescriptionItem>
            <DescriptionItem term="Zero">
              <MoneyText amount="0.00" currencyCode={CURRENCY_CODE} />
            </DescriptionItem>
            <DescriptionItem term="Another currency">
              <MoneyText amount="1284.50" currencyCode="EUR" />
            </DescriptionItem>
            <DescriptionItem term="Date and time">
              <DateTimeText value="2026-10-28T15:30:00Z" timeZone={BUSINESS_TIME_ZONE} />
            </DescriptionItem>
            <DescriptionItem term="Date only">
              <DateTimeText value="2026-11-11" timeZone={BUSINESS_TIME_ZONE} />
            </DescriptionItem>
            <DescriptionItem term="Time only">
              <DateTimeText
                value="2026-10-28T13:00:00Z"
                timeZone={BUSINESS_TIME_ZONE}
                display="time"
              />
            </DescriptionItem>
            <DescriptionItem term="Relative">
              {formatRelative("2026-10-28T14:12:00Z", SAMPLE_NOW, BUSINESS_TIME_ZONE)}
            </DescriptionItem>
            <DescriptionItem term="Reference">
              <ReferenceText reference="FF-2026-00125" />
            </DescriptionItem>
          </DescriptionList>
        </Specimen>

        <Specimen title="Description list">
          <DescriptionList>
            <DescriptionItem term="Customer">Morgan Reyes</DescriptionItem>
            <DescriptionItem term="Email">morgan.reyes@demo.fixflow.test</DescriptionItem>
            <DescriptionItem term="Service address">
              48 Maple Court, Harbor City, NY 10999
            </DescriptionItem>
            <DescriptionItem term="Preferred time">Tuesday morning (8 AM – 12 PM)</DescriptionItem>
            <DescriptionItem term="Status">
              <StatusBadge kind="request" status="UNDER_REVIEW" />
            </DescriptionItem>
          </DescriptionList>
        </Specimen>
      </div>

      <Specimen title="KPI cards (four or five, each a way into the list behind it)">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="New requests"
            value="7"
            context="2 waiting more than a day"
            icon={Inbox}
            href="#data-display"
          />
          <StatCard
            label="Quotations awaiting reply"
            value="4"
            context="1 expires this week"
            icon={FileText}
            href="#data-display"
            tone="attention"
          />
          <StatCard
            label="Jobs this week"
            value="12"
            context="3 still to be scheduled"
            icon={CalendarCheck}
            href="#data-display"
          />
          <StatCard
            label="Outstanding balance"
            value={<MoneyText amount="3416.30" currencyCode={CURRENCY_CODE} />}
            context="2 invoices overdue"
            icon={TriangleAlert}
            href="#data-display"
            tone="danger"
          />
        </div>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Timeline (newest first)">
          <Timeline events={EVENTS} timeZone={BUSINESS_TIME_ZONE} label="Request history" />
        </Specimen>

        <Specimen title="Card with header, content and footer; avatars">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming job</CardTitle>
              <CardDescription>JOB-2026-00031 · AC Routine Maintenance</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Avatar name="Jordan Lee" size="lg" />
              <div className="text-sm">
                <p className="font-medium text-ink">Jordan Lee</p>
                <p className="text-ink-secondary">Tomorrow, 9:00 – 11:00 AM</p>
              </div>
            </CardContent>
            <CardFooter>
              <StatusBadge kind="workOrder" status="SCHEDULED" />
              <span className="text-sm text-ink-secondary">Confirmed with the customer</span>
            </CardFooter>
          </Card>
          <div className="mt-4 flex items-center gap-3">
            <Avatar name="Morgan Reyes" size="sm" />
            <Avatar name="Priya Shah" size="md" />
            <Avatar name="Alex Morgan" size="lg" />
            <Avatar name="Priya" size="md" />
          </div>
        </Specimen>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Activity timeline: staff view (internal entries are marked)">
          <ActivityTimeline
            variant="admin"
            events={ADMIN_ACTIVITY}
            timeZone={BUSINESS_TIME_ZONE}
            label="Staff activity history"
          />
        </Specimen>

        <Specimen title="Activity timeline: customer view (only what the customer may see)">
          <ActivityTimeline
            variant="customer"
            events={CUSTOMER_ACTIVITY}
            timeZone={BUSINESS_TIME_ZONE}
            label="Customer request history"
          />
        </Specimen>
      </div>
    </Section>
  );
}
