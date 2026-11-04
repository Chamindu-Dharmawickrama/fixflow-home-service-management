import type { AdminWorkOrderDto } from "@fixflow/shared";
import { Check } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { jobProgress, type ProgressStepState } from "../lib/job-lifecycle";

const STATE_WORDS: Readonly<Record<ProgressStepState, string>> = {
  done: "done",
  current: "current step",
  upcoming: "not reached",
};

/**
 * Where a job stands on its usual path: Pending scheduling, Scheduled, In progress, Completed. A job
 * that left the path (it needs a new time, or it was cancelled) shows the way out under the steps.
 * Every step says its state in words as well as in colour and shape (CLAUDE.md §10), and the whole
 * thing is a list the screen reader reads in order.
 */
export function JobProgress({
  job,
}: {
  job: Pick<AdminWorkOrderDto, "status" | "scheduledStart">;
}) {
  const { steps, exit } = jobProgress(job);

  return (
    <nav aria-label="Job progress" className="rounded-xl border border-border bg-surface p-4">
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-2">
        {steps.map((step, index) => (
          <li
            key={step.status}
            {...(step.state === "current" && { "aria-current": "step" as const })}
            className="flex min-w-0 items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
          >
            <span className="flex items-center gap-3 sm:w-full">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  step.state === "done" && "border-success bg-success text-surface",
                  step.state === "current" && "border-brand bg-brand text-surface",
                  step.state === "upcoming" && "border-border-strong bg-surface text-ink-secondary",
                )}
              >
                {step.state === "done" ? <Check className="size-4" /> : index + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "hidden h-0.5 flex-1 sm:block",
                  index === steps.length - 1
                    ? "sm:hidden"
                    : step.state === "done"
                      ? "bg-success"
                      : "bg-border",
                )}
              />
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "text-sm [overflow-wrap:anywhere]",
                  step.state === "current"
                    ? "font-semibold text-ink"
                    : "font-medium text-ink-secondary",
                )}
              >
                {step.label}
              </span>
              <span className="text-xs text-ink-secondary">{STATE_WORDS[step.state]}</span>
            </span>
          </li>
        ))}
      </ol>

      {exit === null ? null : (
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm text-ink-secondary">
          <span>This job left the usual path:</span>
          <StatusBadge kind="workOrder" status={exit.status} />
        </p>
      )}
    </nav>
  );
}
