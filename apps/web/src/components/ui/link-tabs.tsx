import Link from "next/link";

import { cn } from "@/lib/utils";

export interface LinkTabItem {
  label: string;
  /** Where the tab goes: the list's own path with the filter in the query string. */
  href: string;
  /** How many records the tab holds, shown beside its name. */
  count?: number | undefined;
  /** The tab for the filter that is applied now. */
  current: boolean;
}

export interface LinkTabsProps {
  /** Names the group for screen readers: "Filter services by status". */
  label: string;
  items: readonly LinkTabItem[];
  className?: string | undefined;
}

/**
 * Filter tabs that live in the URL (D-40). Each tab is a real link to the same list with another
 * filter, so the choice survives a reload, can be bookmarked and works before any JavaScript loads.
 * Use `Tabs` instead when the panels are all on the page and switching them changes nothing else.
 * The current tab is marked with `aria-current="page"`; the strip scrolls sideways on a narrow screen.
 */
export function LinkTabs({ label, items, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "relative inline-flex h-11 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium",
                "transition-colors duration-150 ease-standard",
                "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full",
                item.current ? "text-brand after:bg-brand" : "text-ink-secondary hover:text-ink",
              )}
            >
              {item.label}
              {/* A flex container ignores this space visually; it keeps the name "Published 3". */}{" "}
              {item.count === undefined ? null : (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs tabular-nums",
                    item.current
                      ? "bg-brand-soft text-brand"
                      : "bg-surface-muted text-ink-secondary",
                  )}
                >
                  {item.count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
