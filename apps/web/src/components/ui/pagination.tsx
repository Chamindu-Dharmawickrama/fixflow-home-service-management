import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { getPageRange, getPaginationItems } from "@/lib/pagination";
import { buildHref, type SearchParamsInput } from "@/lib/url";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  /** The requested page, 1-based. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** The list's own path, for example `/app/requests`. */
  basePath: string;
  /** The page's current `searchParams`; filters and sort are kept on every link. */
  searchParams: SearchParamsInput;
  /** The name of the page parameter. */
  pageParam?: string | undefined;
  /** The noun for the summary: "requests" → "Showing 21–40 of 132 requests". */
  itemLabel?: string | undefined;
  className?: string | undefined;
}

const linkClasses =
  "inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-standard";

function PageLink({
  href,
  current,
  label,
  children,
}: {
  href: string;
  current?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={cn(
        linkClasses,
        current
          ? "bg-brand text-surface"
          : "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
      )}
    >
      {children}
    </Link>
  );
}

function Disabled({ children }: { children: ReactNode }) {
  return (
    <span
      aria-disabled="true"
      className={cn(
        linkClasses,
        "cursor-not-allowed border border-border bg-surface text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Page links for a list, driven entirely by the URL (`?page=3`) so a page can be bookmarked,
 * shared and reloaded. It is a server component: it renders plain links and keeps every other
 * query parameter (filters, sort) on each of them. Phones get Previous / "Page 3 of 7" / Next;
 * wider screens add the numbered links.
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  basePath,
  searchParams,
  pageParam = "page",
  itemLabel = "items",
  className,
}: PaginationProps) {
  const range = getPageRange(page, pageSize, totalItems);
  if (range.totalPages === 0) {
    return null;
  }

  // Page 1 has no parameter, so the first page of a filtered list has a clean URL.
  const hrefFor = (target: number) =>
    buildHref(basePath, searchParams, { [pageParam]: target === 1 ? null : target });
  const items = getPaginationItems(range.page, range.totalPages);
  const hasPrevious = range.page > 1;
  const hasNext = range.page < range.totalPages;

  return (
    <div
      className={cn("flex flex-col items-center gap-3 sm:flex-row sm:justify-between", className)}
    >
      <p className="text-sm text-ink-secondary">
        Showing{" "}
        <span className="font-medium text-ink tabular-nums">
          {range.from}–{range.to}
        </span>{" "}
        of <span className="font-medium text-ink tabular-nums">{totalItems}</span> {itemLabel}
      </p>

      <nav aria-label="Pagination">
        <ul className="flex items-center gap-1.5">
          <li>
            {hasPrevious ? (
              <PageLink href={hrefFor(range.page - 1)} label="Go to previous page">
                <ChevronLeft aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </PageLink>
            ) : (
              <Disabled>
                <ChevronLeft aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </Disabled>
            )}
          </li>

          <li className="px-2 text-sm text-ink-secondary tabular-nums sm:hidden">
            Page {range.page} of {range.totalPages}
          </li>

          {items.map((item) =>
            typeof item === "number" ? (
              <li key={item} className="hidden sm:block">
                <PageLink
                  href={hrefFor(item)}
                  current={item === range.page}
                  label={item === range.page ? `Page ${item}, current page` : `Go to page ${item}`}
                >
                  <span className="tabular-nums">{item}</span>
                </PageLink>
              </li>
            ) : (
              <li key={item} aria-hidden="true" className="hidden px-1 text-ink-muted sm:block">
                …
              </li>
            ),
          )}

          <li>
            {hasNext ? (
              <PageLink href={hrefFor(range.page + 1)} label="Go to next page">
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </PageLink>
            ) : (
              <Disabled>
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </Disabled>
            )}
          </li>
        </ul>
      </nav>
    </div>
  );
}
