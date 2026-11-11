import type { DashboardRange } from "@fixflow/shared";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { RANGE_OPTIONS, rangeHref } from "../lib/dashboard";

/**
 * Today, 7 days or 30 days (FR-080): links, so the choice lives in the address, survives a reload and
 * works before any script loads (D-40). It changes the period-dependent figure only. The current one
 * is marked with `aria-current` and with its fill, not by colour alone.
 */
export function RangeSelector({ current }: { current: DashboardRange }) {
  return (
    <nav aria-label="Period for new requests">
      <ul className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
        {RANGE_OPTIONS.map(({ range, label }) => {
          const selected = range === current;
          return (
            <li key={range}>
              <Link
                href={rangeHref(range)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150 ease-standard",
                  selected
                    ? "bg-brand-soft text-brand"
                    : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
