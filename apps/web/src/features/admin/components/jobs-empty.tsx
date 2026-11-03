import type { WorkOrderView } from "@fixflow/shared";
import { Briefcase, CalendarCheck, FileSearch, Hammer, SearchX, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

import { jobsTabHref } from "../lib/jobs";
import { QUEUE_PATH } from "../lib/requests-queue";

export interface JobsEmptyProps {
  /** A search or a filter is applied, so an empty list means "no match", not "none yet". */
  filtered: boolean;
  /** The tab that is open. */
  view: WorkOrderView;
  /** There are jobs for this tab and filters, but the page asked for is past the last one. */
  pastLastPage: boolean;
  /** The first page of the same tab and filters. */
  firstPageHref: string;
  /** The tab without the search and filters. */
  clearFiltersHref: string;
}

function link(href: string, label: string): ReactNode {
  return (
    <Link href={href} className={buttonVariants({ variant: "outline" })}>
      {label}
    </Link>
  );
}

/**
 * What the jobs list says when it has no rows, which depends on why (FR-083): a page past the end,
 * a search that found nothing, or a tab with nothing in it. Each names the situation and offers the
 * step that gets out of it.
 */
export function JobsEmpty({
  filtered,
  view,
  pastLastPage,
  firstPageHref,
  clearFiltersHref,
}: JobsEmptyProps) {
  if (pastLastPage) {
    return (
      <EmptyState
        icon={FileSearch}
        title="There is nothing on this page"
        description="The list is shorter than this page number. Go back to the first page to see it."
        action={link(firstPageHref, "Go to the first page")}
      />
    );
  }
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title="No jobs match"
        description="Nothing fits this search or these filters. Try a different word or technician, or widen the dates."
        action={link(clearFiltersHref, "Clear search and filters")}
      />
    );
  }
  switch (view) {
    case "needs-scheduling":
      return (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing is waiting for a time"
          description="Every job has an appointment. When a customer accepts a quotation, create a job from it and it appears here until you schedule it."
          action={link(jobsTabHref({}, "upcoming"), "See upcoming jobs")}
        />
      );
    case "upcoming":
      return (
        <EmptyState
          icon={CalendarCheck}
          title="No upcoming visits"
          description="Scheduled jobs are listed here until they start. Jobs waiting for a time are under Needs scheduling."
          action={link(jobsTabHref({}, "needs-scheduling"), "See jobs that need scheduling")}
        />
      );
    case "in-progress":
      return (
        <EmptyState
          icon={Hammer}
          title="No jobs in progress"
          description="A job is listed here from the moment work starts until it is completed."
        />
      );
    case "completed":
      return (
        <EmptyState
          icon={Wrench}
          title="No completed jobs yet"
          description="Finished jobs are kept here, ready to be invoiced."
        />
      );
    case "all":
      return (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          description="A job is created from a quotation the customer has accepted. Open an accepted request to create one."
          action={link(QUEUE_PATH, "Go to the requests")}
        />
      );
  }
}
