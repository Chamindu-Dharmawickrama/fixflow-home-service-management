import type { ComponentProps } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A placeholder block. Compose it into the shape of the content that is loading. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-md bg-surface-muted motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

interface LoadingRegionProps extends ComponentProps<"div"> {
  /** What is loading, read to screen-reader users: "Loading requests". */
  label: string;
}

function LoadingRegion({ label, className, children, ...props }: LoadingRegionProps) {
  return (
    <div role="status" aria-live="polite" className={className} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Loading state for a list or table: a header strip and `rows` placeholder rows. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  label = "Loading list",
  className,
}: {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion
      label={label}
      className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}
    >
      <div className="flex gap-4 border-b border-border bg-surface-muted px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1 bg-border" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={column} className={cn("h-4 flex-1", column === 0 && "max-w-40")} />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Loading state for a card: a title line and a few lines of text. */
export function CardSkeleton({
  lines = 3,
  label = "Loading",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion label={label} className={className}>
      <Card className="flex flex-col gap-3 p-5 sm:p-6">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </Card>
    </LoadingRegion>
  );
}

/** Loading state for a detail page: header, status badge, a details card and a side card. */
export function DetailSkeleton({
  label = "Loading details",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <LoadingRegion label={label} className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3 max-w-md" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 p-5 sm:p-6 lg:col-span-2">
          <Skeleton className="h-5 w-1/4" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex gap-4">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </Card>
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      </div>
    </LoadingRegion>
  );
}
