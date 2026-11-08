import type { InvoiceStatus } from "@fixflow/shared";
import { FileSearch, Receipt, SearchX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

import { INVOICES_PATH } from "../lib/invoices";
import { jobsTabHref } from "../lib/jobs";

export interface InvoicesEmptyProps {
  /** A search or a date filter is applied, so an empty list means "no match", not "none yet". */
  filtered: boolean;
  /** The status chip that is open, if any. */
  status: InvoiceStatus | undefined;
  /** There are invoices for these filters, but the page asked for is past the last one. */
  pastLastPage: boolean;
  /** The first page of the same filters. */
  firstPageHref: string;
  /** The list without the search and the dates, keeping the status. */
  clearFiltersHref: string;
}

function link(href: string, label: string): ReactNode {
  return (
    <Link href={href} className={buttonVariants({ variant: "outline" })}>
      {label}
    </Link>
  );
}

const STATUS_EMPTY: Readonly<Record<InvoiceStatus, { title: string; description: string }>> = {
  DRAFT: {
    title: "No draft invoices",
    description: "A draft is started from a completed job and stays here until you issue it.",
  },
  ISSUED: {
    title: "No invoices waiting to be paid",
    description: "An invoice is listed here from the moment it is issued until payment arrives.",
  },
  PARTIALLY_PAID: {
    title: "No partly paid invoices",
    description: "An invoice that has received part of its total is listed here.",
  },
  OVERDUE: {
    title: "Nothing is overdue",
    description: "An invoice moves here once its due date has passed and a balance is still owed.",
  },
  PAID: {
    title: "No paid invoices yet",
    description: "An invoice is listed here once it has been paid in full.",
  },
  VOID: {
    title: "No voided invoices",
    description: "A voided invoice stays in the history and is listed here.",
  },
};

/**
 * What the invoice list says when it has no rows, which depends on why (FR-083): a page past the end,
 * a search that found nothing, a status with nothing in it, or a business that has not invoiced
 * anything yet. Each names the situation and offers the step that gets out of it.
 */
export function InvoicesEmpty({
  filtered,
  status,
  pastLastPage,
  firstPageHref,
  clearFiltersHref,
}: InvoicesEmptyProps) {
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
        title="No invoices match"
        description="Nothing fits this search or these dates. Try a different word, or widen the due dates."
        action={link(clearFiltersHref, "Clear search and filters")}
      />
    );
  }
  if (status !== undefined) {
    const { title, description } = STATUS_EMPTY[status];
    return (
      <EmptyState
        icon={Receipt}
        title={title}
        description={description}
        action={link(INVOICES_PATH, "See all invoices")}
      />
    );
  }
  return (
    <EmptyState
      icon={Receipt}
      title="No invoices yet"
      description="An invoice is created from a completed job. Completed jobs waiting for one are under Ready to invoice."
      action={link(jobsTabHref({}, "ready-to-invoice"), "See jobs ready to invoice")}
    />
  );
}
