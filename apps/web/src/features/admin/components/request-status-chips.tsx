import type { RequestStatusCounts, ServiceRequestStatus } from "@fixflow/shared";
import Link from "next/link";

import { statusLabel } from "@/lib/formatting";
import type { SearchParamsInput } from "@/lib/url";
import { cn } from "@/lib/utils";

import { allStatusesHref, QUEUE_STATUS_ORDER, statusChipHref } from "../lib/requests-queue";

export interface RequestStatusChipsProps {
  /** The statuses in the filter now (several can be chosen). */
  selected: readonly ServiceRequestStatus[];
  /** Per status, for the search and filters in force but ignoring the status filter. */
  counts: RequestStatusCounts;
  total: number;
  /** The page's `searchParams`, so every chip keeps the search, filters and sort. */
  params: SearchParamsInput;
}

const CHIP =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ease-standard";

function Count({ children, selected }: { children: number; selected: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs tabular-nums",
        selected ? "bg-surface text-brand" : "bg-surface-muted text-ink-secondary",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The status filter of the queue: "All" and one chip for each status, with how many requests each
 * would show (FR-023). The chips are links, so the choice lives in the URL and works before any
 * JavaScript loads (D-40); pressing a chip adds its status to the filter or takes it out, so several
 * can be combined, and "All" clears them. A selected chip is marked with `aria-current` and with its
 * colour; the count is part of the link's name ("Submitted 3").
 */
export function RequestStatusChips({ selected, counts, total, params }: RequestStatusChipsProps) {
  const noneSelected = selected.length === 0;

  return (
    <nav aria-label="Filter requests by status">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        <li className="shrink-0">
          <Link
            href={allStatusesHref(params)}
            aria-current={noneSelected ? "true" : undefined}
            className={cn(
              CHIP,
              noneSelected
                ? "border-brand bg-brand-soft text-brand"
                : "border-border bg-surface text-ink-secondary hover:border-border-strong hover:text-ink",
            )}
          >
            All <Count selected={noneSelected}>{total}</Count>
          </Link>
        </li>
        {QUEUE_STATUS_ORDER.map((status) => {
          const isSelected = selected.includes(status);
          return (
            <li key={status} className="shrink-0">
              <Link
                href={statusChipHref(params, selected, status)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  CHIP,
                  isSelected
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border bg-surface text-ink-secondary hover:border-border-strong hover:text-ink",
                )}
              >
                {statusLabel("request", status)}{" "}
                <Count selected={isSelected}>{counts[status]}</Count>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
