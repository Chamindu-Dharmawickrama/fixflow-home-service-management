import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  /** Leave out for the current page, which is shown as text. */
  href?: string | undefined;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  className?: string | undefined;
}

/** Where the current page sits: `Requests › FF-2026-00125`. The last item is the current page. */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-secondary">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            // `min-w-0` lets a crumb with a very long name shrink to the line and wrap, instead of
            // pushing the page sideways.
            <li
              key={`${item.label}-${index}`}
              className="flex min-w-0 max-w-full items-center gap-1.5"
            >
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
              ) : null}
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  className="rounded-sm underline-offset-4 hover:text-brand hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "min-w-0 [overflow-wrap:anywhere]",
                    isCurrent && "font-medium text-ink",
                  )}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
