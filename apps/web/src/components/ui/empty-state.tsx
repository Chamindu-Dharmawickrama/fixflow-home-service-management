import type { LucideIcon } from "lucide-react";
import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** The heading level for the page outline. An empty state inside a section is usually `h3`. */
  titleAs?: ElementType | undefined;
  /** Say why it is empty and what to do next. */
  description: ReactNode;
  /** The next step, usually a `Button` or a link-styled `Button asChild`. */
  action?: ReactNode;
  className?: string | undefined;
}

/**
 * The state of a list, search or section that has nothing in it yet (FR-083). An empty state is
 * guidance, not an apology: it names what is missing and offers the action that fills it.
 */
export function EmptyState({
  icon: Icon,
  title,
  titleAs: Heading = "h2",
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      <p className="max-w-md text-pretty text-sm text-ink-secondary">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
