import type { AdminDashboardSummaryDto } from "@fixflow/shared";
import { CalendarClock, ClipboardCheck, FileClock, Inbox, Wallet } from "lucide-react";
import Link from "next/link";

import { MoneyText } from "@/components/ui/money-text";
import { StatCard } from "@/components/ui/stat-card";

import { PERIOD_CONTEXT } from "../lib/dashboard";
import { MetricInfo } from "./metric-info";

const LINK =
  "relative z-10 rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover";

/** "Current" or the period, so a reader knows which figures follow the range selector (FR-085). */
function scopeLabel(summary: AdminDashboardSummaryDto, scope: "range" | "current"): string {
  return scope === "range" ? PERIOD_CONTEXT[summary.period.range] : "Current";
}

/**
 * The five figures (FR-080, UX-QB-DASH): few enough to read at a glance, each a link to the list it
 * counts and each with its definition one tap away. Only "New requests" follows the range selector;
 * the others are the state of the business right now and say "Current". The grid is five across on a
 * wide screen, then three, two and one as the screen narrows.
 */
export function KpiCards({ summary }: { summary: AdminDashboardSummaryDto }) {
  const { kpis, currencyCode } = summary;
  const info = (kpi: { label: string; definition: string; scope: "range" | "current" }) => (
    <MetricInfo
      label={kpi.label}
      definition={kpi.definition}
      scopeText={
        kpi.scope === "range"
          ? `Follows the selected period: ${scopeLabel(summary, kpi.scope).toLowerCase()}`
          : "Current: not affected by the selected period"
      }
    />
  );
  const { jobs, unpaidBalance } = kpis;

  return (
    <section aria-label="Key figures">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <li className="contents">
          <StatCard
            label={kpis.newRequests.label}
            value={kpis.newRequests.value}
            context={scopeLabel(summary, kpis.newRequests.scope)}
            href={kpis.newRequests.link}
            icon={Inbox}
            info={info(kpis.newRequests)}
          />
        </li>
        <li className="contents">
          <StatCard
            label={kpis.requestsNeedingAction.label}
            value={kpis.requestsNeedingAction.value}
            context="Current · waiting on you"
            href={kpis.requestsNeedingAction.link}
            icon={ClipboardCheck}
            info={info(kpis.requestsNeedingAction)}
            tone={kpis.requestsNeedingAction.value > 0 ? "attention" : "default"}
          />
        </li>
        <li className="contents">
          <StatCard
            label={jobs.label}
            value={jobs.value}
            context={`Current · ${jobs.upcomingCount} more in the next ${jobs.upcomingDays} days`}
            href={jobs.link}
            icon={CalendarClock}
            info={info(jobs)}
          />
        </li>
        <li className="contents">
          <StatCard
            label={kpis.awaitingInvoice.label}
            value={kpis.awaitingInvoice.value}
            context="Current · ready to invoice"
            href={kpis.awaitingInvoice.link}
            icon={FileClock}
            info={info(kpis.awaitingInvoice)}
            tone={kpis.awaitingInvoice.value > 0 ? "attention" : "default"}
          />
        </li>
        <li className="contents">
          <StatCard
            label={unpaidBalance.label}
            value={<MoneyText amount={unpaidBalance.value} currencyCode={currencyCode} />}
            context={
              <>
                Current ·{" "}
                {unpaidBalance.overdueCount > 0 ? (
                  <Link href={unpaidBalance.overdueLink} className={LINK}>
                    {unpaidBalance.overdueCount} overdue (
                    <MoneyText amount={unpaidBalance.overdueAmount} currencyCode={currencyCode} />)
                  </Link>
                ) : (
                  "none overdue"
                )}
              </>
            }
            href={unpaidBalance.link}
            icon={Wallet}
            info={info(unpaidBalance)}
            tone={unpaidBalance.overdueCount > 0 ? "danger" : "default"}
          />
        </li>
      </ul>
    </section>
  );
}
