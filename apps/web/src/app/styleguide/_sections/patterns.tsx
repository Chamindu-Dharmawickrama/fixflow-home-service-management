import { Download, Pencil, Send } from "lucide-react";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { DateTimeText } from "@/components/ui/date-time-text";
import { PageHeader } from "@/components/ui/page-header";
import { ReferenceText } from "@/components/ui/reference-text";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SearchParamsInput } from "@/lib/url";

import { BUSINESS_TIME_ZONE } from "../_lib/fixtures";
import { Section, Specimen } from "../_lib/section";
import { RequestQueue } from "./request-queue";

const SHELL_REQUEST_DETAIL = "/styleguide/shells/admin/requests/detail";

async function RequestQueueFromUrl({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <RequestQueue
      basePath="/styleguide"
      searchParams={await searchParams}
      rowHref={SHELL_REQUEST_DETAIL}
    />
  );
}

export function PatternsSection({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <Section
      id="patterns"
      title="Patterns"
      description="Page headers, breadcrumbs, and the list pattern: filters, sortable table, pagination. Filters, sort and page live in the URL, so every state can be bookmarked, shared and reloaded."
    >
      <Specimen title="Detail page header: title, status, reference, one primary action first">
        <PageHeader
          breadcrumbs={[
            { label: "Requests", href: "/styleguide#patterns" },
            { label: "FF-2026-00125" },
          ]}
          title="AC Diagnostic Visit"
          status={<StatusBadge kind="request" status="UNDER_REVIEW" />}
          meta={
            <>
              <ReferenceText reference="FF-2026-00125" />
              <span>
                Submitted{" "}
                <DateTimeText value="2026-10-28T13:42:00Z" timeZone={BUSINESS_TIME_ZONE} />
              </span>
              <span>Morgan Reyes</span>
            </>
          }
          description="The upstairs unit is blowing warm air and the drain line drips onto the landing."
          actions={
            <>
              <Button>
                <Send aria-hidden="true" />
                Create quotation
              </Button>
              <Button variant="outline">
                <Pencil aria-hidden="true" />
                Edit details
              </Button>
              <Button variant="ghost">
                <Download aria-hidden="true" />
                Export
              </Button>
            </>
          }
        />
      </Specimen>

      <Specimen title="Breadcrumbs (the last item is the current page)">
        <Breadcrumbs
          items={[
            { label: "Customers", href: "/styleguide#patterns" },
            { label: "Morgan Reyes", href: "/styleguide#patterns" },
            { label: "Quotation QT-2026-00042" },
          ]}
        />
      </Specimen>

      <Specimen title="List pattern: filter bar, data table (cards below 768 px), pagination">
        <Suspense fallback={<TableSkeleton rows={8} columns={6} label="Loading requests" />}>
          <RequestQueueFromUrl searchParams={searchParams} />
        </Suspense>
      </Specimen>
    </Section>
  );
}
