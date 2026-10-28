import { X } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FilterBarProps extends Omit<ComponentProps<"form">, "method" | "action"> {
  /** The list's own path. The form submits to it with `GET`, so filters live in the URL. */
  action: string;
  /** Names the search for screen readers: "Filter requests". */
  label: string;
  /** Parameters to carry across a filter change, such as the current sort. */
  preserve?: Record<string, string | undefined> | undefined;
  /** Show the "Clear filters" link. Pass `true` when any filter or search is applied. */
  hasActiveFilters?: boolean | undefined;
  submitLabel?: string | undefined;
  children: ReactNode;
}

/**
 * The container for a list's search and filters. It is a plain `GET` form: submitting it reloads
 * the list with the filters in the URL (and page 1, because `page` is never carried over), so it
 * works before any JavaScript loads and the result can be bookmarked. Put `FilterBarField`s inside.
 */
export function FilterBar({
  action,
  label,
  preserve = {},
  hasActiveFilters = false,
  submitLabel = "Apply filters",
  className,
  children,
  ...props
}: FilterBarProps) {
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label={label}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
      {...props}
    >
      {Object.entries(preserve).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      {children}
      <div className="flex items-center gap-2 sm:ml-auto">
        <Button type="submit" variant="secondary">
          {submitLabel}
        </Button>
        {hasActiveFilters ? (
          <Button variant="ghost" asChild>
            <Link href={action}>
              <X aria-hidden="true" />
              Clear filters
            </Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export interface FilterBarFieldProps {
  /** The control's `id`; the label is tied to it. */
  id: string;
  label: string;
  children: ReactNode;
  /** Wider than the default for a search box. */
  grow?: boolean | undefined;
}

/** A labelled control inside a `FilterBar`. */
export function FilterBarField({ id, label, children, grow = false }: FilterBarFieldProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", grow ? "sm:min-w-64 sm:flex-1" : "sm:w-48")}
    >
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
