import type { AdminDashboardSummaryDto } from "@fixflow/shared";
import { Inbox } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateWithWeekday } from "@/lib/formatting";

import { firstName, greetingFor } from "../lib/dashboard";
import { AttentionQueue } from "./attention-queue";
import { KpiCards } from "./kpi-cards";
import { RangeSelector } from "./range-selector";
import { RecentActivity } from "./recent-activity";
import { UpcomingSchedule } from "./upcoming-schedule";

/** The public page that lists the services: what a business with no requests yet should share. */
export const PUBLIC_SERVICES_PATH = "/services";

export interface DashboardViewProps {
  summary: AdminDashboardSummaryDto;
  /** The signed-in admin's name, for the greeting. */
  userName: string | null | undefined;
}

/**
 * The dashboard (IA-A01, FR-080 to FR-085, UX-QB-DASH): a greeting for the business's time of day and
 * today's date, the period selector, five figures, the needs-attention queue, the next visits and the
 * latest activity. The queue leads the page on a narrow screen and the schedule and activity follow;
 * from the large breakpoint up the queue takes the wide column. A business with no requests at all
 * gets guidance in place of three empty panels.
 */
export function DashboardView({ summary, userName }: DashboardViewProps) {
  const { timeZone } = summary;

  return (
    <>
      <PageHeader
        title={`${greetingFor(summary.generatedAt, timeZone)}, ${firstName(userName)}`}
        description={formatDateWithWeekday(summary.generatedAt, timeZone)}
        actions={<RangeSelector current={summary.period.range} />}
      />

      <KpiCards summary={summary} />

      {summary.isFresh ? (
        <EmptyState
          icon={Inbox}
          title="No requests yet"
          description="When a customer asks for a service, it appears here with what to do next. Share your services page so people can find you and send the first one."
          action={
            <Link href={PUBLIC_SERVICES_PATH} className={buttonVariants({ variant: "primary" })}>
              Open your services page
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <AttentionQueue attention={summary.needsAttention} />
          <div className="flex min-w-0 flex-col gap-6">
            <UpcomingSchedule
              jobs={summary.upcomingSchedule}
              timeZone={timeZone}
              today={summary.today}
            />
            <RecentActivity events={summary.recentActivity} timeZone={timeZone} />
          </div>
        </div>
      )}
    </>
  );
}
