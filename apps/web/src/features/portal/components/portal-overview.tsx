import type { CustomerOverviewDto, CustomerProfileDto } from "@fixflow/shared";
import { Plus, Wrench } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";

import { AwaitingDecision } from "./awaiting-decision";
import { OutstandingInvoices } from "./outstanding-invoices";
import { ProfileSummaryCard } from "./profile-summary-card";
import { RecentRequests } from "./recent-requests";
import { UpcomingVisits } from "./upcoming-visits";

export interface PortalOverviewProps {
  name: string;
  overview: CustomerOverviewDto;
  profile: Pick<CustomerProfileDto, "name" | "email" | "phone" | "addresses">;
  timeZone: string;
  /** When the page is drawn: how many days a quotation has left is measured from it. */
  now: Date;
}

/**
 * The customer's overview (IA-C01, spec §9.3): the way to ask for a service, what needs the customer
 * now (quotations to answer and invoices to pay, under "Action required"), the visits to come, the
 * latest requests and a summary of their profile. A customer with no requests yet gets a welcome and
 * the first step in place of empty lists. Everything comes from `GET /customers/me/overview`, so it
 * is the customer's own records in the customer's shapes (D-41).
 */
export function PortalOverview({ name, overview, profile, timeZone, now }: PortalOverviewProps) {
  const { actionRequired, upcomingVisits, recentRequests, counts } = overview;
  const isNew = counts.requests === 0 && counts.actionRequired === 0;

  return (
    <>
      <PageHeader
        title={`Hello, ${name}`}
        description="Send a service request, follow its progress and keep your details up to date."
        actions={
          <Link
            href={REQUEST_SERVICE_PATH}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Plus aria-hidden="true" />
            Request a service
          </Link>
        }
      />

      {counts.actionRequired > 0 ? (
        <section aria-labelledby="action-required-heading" className="flex flex-col gap-4">
          <h2 id="action-required-heading" className="text-xl font-semibold text-ink">
            Action required
          </h2>
          <AwaitingDecision
            quotations={actionRequired.quotations.items}
            timeZone={timeZone}
            now={now}
            headingAs="h3"
          />
          <OutstandingInvoices
            invoices={actionRequired.invoices.items}
            totalItems={actionRequired.invoices.totalItems}
            timeZone={timeZone}
            headingAs="h3"
          />
        </section>
      ) : null}

      {isNew ? (
        <EmptyState
          icon={Wrench}
          title="Welcome — let's get your first job started"
          description="Tell us what needs fixing and when suits you. We'll review it and send you a written quotation to accept or decline. Nothing is booked until you say yes."
          action={
            <Link href={REQUEST_SERVICE_PATH} className={buttonVariants({ variant: "primary" })}>
              <Plus aria-hidden="true" />
              Request a service
            </Link>
          }
        />
      ) : (
        <>
          <UpcomingVisits
            jobs={upcomingVisits.items}
            totalItems={upcomingVisits.totalItems}
            timeZone={timeZone}
          />
          <RecentRequests
            requests={recentRequests.items}
            totalItems={recentRequests.totalItems}
            timeZone={timeZone}
          />
        </>
      )}

      <ProfileSummaryCard profile={profile} />
    </>
  );
}
