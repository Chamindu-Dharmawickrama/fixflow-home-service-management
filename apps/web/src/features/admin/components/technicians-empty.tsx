import type { AdminTechnicianListMeta, TechnicianActiveFilter } from "@fixflow/shared";
import { FileSearch, SearchX, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/empty-state";

import { techniciansTabHref } from "../lib/technicians";

export interface TechniciansEmptyProps {
  /** A search is applied, so an empty list means "no match", not "none yet". */
  searching: boolean;
  /** The tab that is open. */
  active: TechnicianActiveFilter;
  /** What each tab holds, ignoring the search. */
  counts: AdminTechnicianListMeta["counts"];
  /** There are technicians for this tab and search, but the page asked for is past the last one. */
  pastLastPage: boolean;
  /** The first page of the same tab and search. */
  firstPageHref: string;
  /** The tab without the search. */
  clearSearchHref: string;
  /** The "Add technician" button, which opens the sheet. */
  addTechnician: ReactNode;
}

/**
 * What the technician list says when it has no rows, which depends on why (FR-083): a search that
 * found nobody, a page past the end, no technicians at all, nobody inactive, or everybody inactive.
 * Each names the situation and offers the step that gets out of it.
 */
export function TechniciansEmpty({
  searching,
  active,
  counts,
  pastLastPage,
  firstPageHref,
  clearSearchHref,
  addTechnician,
}: TechniciansEmptyProps) {
  if (pastLastPage) {
    return (
      <EmptyState
        icon={FileSearch}
        title="There is nothing on this page"
        description="The list is shorter than this page number. Go back to the first page to see it."
        action={
          <Link href={firstPageHref} className={buttonVariants({ variant: "outline" })}>
            Go to the first page
          </Link>
        }
      />
    );
  }
  if (searching) {
    return (
      <EmptyState
        icon={SearchX}
        title="No technicians match"
        description="Nobody fits this search. Check the spelling, try part of the name, or search by a specialty, an email address or a phone number instead."
        action={
          <Link href={clearSearchHref} className={buttonVariants({ variant: "outline" })}>
            Clear search
          </Link>
        }
      />
    );
  }
  if (counts.all === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No technicians yet"
        description="Add the people who do the work. Once they are here you can give them jobs and see what each has coming up."
        action={addTechnician}
      />
    );
  }
  if (active === "false") {
    return (
      <EmptyState
        icon={Wrench}
        title="No inactive technicians"
        description="When you deactivate a technician, they are listed here. Their jobs stay assigned and you can reactivate them at any time."
        action={
          <Link
            href={techniciansTabHref({}, "true")}
            className={buttonVariants({ variant: "outline" })}
          >
            Show active technicians
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Wrench}
      title="No active technicians"
      description="Everyone is inactive, so nobody can be given a new job. Reactivate a technician, or add someone new."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={techniciansTabHref({}, "false")}
            className={buttonVariants({ variant: "outline" })}
          >
            Show inactive technicians
          </Link>
          {addTechnician}
        </div>
      }
    />
  );
}
