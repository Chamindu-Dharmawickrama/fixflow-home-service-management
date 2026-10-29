import Link from "next/link";

import { cn } from "@/lib/utils";

import { servicesPath } from "../lib/services-view";

export interface CategoryOption {
  label: string;
  count: number;
}

export interface CategoryFilterProps {
  categories: readonly CategoryOption[];
  total: number;
  /** The category currently applied (as written in the URL), or `undefined` for all services. */
  selected: string | undefined;
}

const PILL =
  "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors duration-150 ease-standard sm:h-10";

/**
 * Filter chips for the service list. Each chip is a link to `/services?category=…`, so the filter
 * lives in the URL (it can be shared and the Back button works), needs no client JavaScript, and is
 * operable with Tab and Enter. The chip in force carries `aria-current`, not just a colour.
 */
export function CategoryFilter({ categories, total, selected }: CategoryFilterProps) {
  const wanted = selected?.trim().toLowerCase();
  const anyMatch = categories.some((option) => option.label.toLowerCase() === wanted);
  const allActive = wanted === undefined || !anyMatch;

  const chip = (active: boolean) =>
    cn(
      PILL,
      active
        ? "border-brand bg-brand text-surface"
        : "border-border-strong bg-surface text-ink hover:bg-surface-muted",
    );

  return (
    <nav aria-label="Filter services by category">
      <p className="mb-2 text-sm font-medium text-ink-secondary">Category</p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            href={servicesPath()}
            aria-current={allActive ? "true" : undefined}
            className={chip(allActive)}
          >
            All <span className="tabular-nums opacity-80">({total})</span>
          </Link>
        </li>
        {categories.map((option) => {
          const active = option.label.toLowerCase() === wanted;
          return (
            <li key={option.label}>
              <Link
                href={servicesPath(option.label)}
                aria-current={active ? "true" : undefined}
                className={chip(active)}
              >
                {option.label} <span className="tabular-nums opacity-80">({option.count})</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
