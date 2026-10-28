import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string | undefined;
  /** What went wrong and what the person can do. Never a stack trace or a raw server message. */
  message: ReactNode;
  /** Retry in place. Use from client components (for example an error boundary's `reset`). */
  onRetry?: (() => void) | undefined;
  /** Retry by navigating, for server-rendered pages: the current URL, so the data is fetched again. */
  retryHref?: string | undefined;
  retryLabel?: string | undefined;
  /** The `requestId` from the API error body, so the problem can be traced in the logs. */
  requestId?: string | undefined;
  className?: string | undefined;
}

/** The state of a section or page whose data could not be loaded (a server or network error). */
export function ErrorState({
  title = "We couldn't load this",
  message,
  onRetry,
  retryHref,
  retryLabel = "Try again",
  requestId,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-danger-edge bg-danger-soft px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-surface text-danger">
        <TriangleAlert aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="max-w-md text-pretty text-sm text-ink-secondary">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry} className="mt-2">
          {retryLabel}
        </Button>
      ) : retryHref ? (
        <Button variant="outline" asChild className="mt-2">
          <Link href={retryHref}>{retryLabel}</Link>
        </Button>
      ) : null}
      {requestId ? (
        <p className="text-xs text-ink-muted">
          Reference for support: <span className="font-medium tabular-nums">{requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
