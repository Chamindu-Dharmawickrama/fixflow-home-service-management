import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PermissionDeniedProps {
  title?: string | undefined;
  message?: ReactNode;
  /** Where the person can go instead, for example a link back to their own dashboard. */
  action?: ReactNode;
  className?: string | undefined;
}

/**
 * Shown when the API answers 403: the person is signed in but this page is not for their role.
 * (A record that exists but belongs to someone else is a 404, so ids cannot be probed.) Hiding a
 * link is never the control; this state is what a person sees if they reach the URL anyway.
 */
export function PermissionDenied({
  title = "You don't have access to this page",
  message = "This page is for a different kind of account. If you think that's a mistake, contact the business.",
  action,
  className,
}: PermissionDeniedProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-neutral-soft text-neutral">
        <Lock aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="max-w-md text-sm text-ink-secondary">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
