import type { ReactNode } from "react";

import { type BreadcrumbItem, Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** The page's one `h1`. */
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: readonly BreadcrumbItem[] | undefined;
  /** A `StatusBadge` for detail pages. Sits beside the title. */
  status?: ReactNode;
  /** The primary action first, then secondary ones. Wrap on narrow screens. */
  actions?: ReactNode;
  /** Reference number, created date, owner: quiet facts under the title. */
  meta?: ReactNode;
  className?: string | undefined;
}

/**
 * The top of every page: breadcrumbs, title with status, description, metadata and actions.
 * Detail pages put the single most likely next step first in `actions`; the server decides which
 * actions are available (`availableActions`, D-43), so render only what it allows.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  status,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* min-w-0 lets a flex item shrink below its longest word, so break-words can wrap it. */}
            <h1 className="min-w-0 break-words font-display text-2xl font-semibold text-ink sm:text-3xl">
              {title}
            </h1>
            {status}
          </div>
          {meta ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-secondary">
              {meta}
            </div>
          ) : null}
          {description ? (
            <p className="max-w-2xl text-pretty text-base text-ink-secondary [overflow-wrap:anywhere]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
