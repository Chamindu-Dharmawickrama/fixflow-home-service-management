import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The shared look of every single-line text control (input, select, date and time inputs). */
export const controlClasses = cn(
  "block h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-ink sm:h-10 sm:text-sm",
  "placeholder:text-ink-muted",
  "transition-colors duration-150 ease-standard",
  "hover:border-ink-muted",
  "aria-invalid:border-danger aria-invalid:hover:border-danger",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted",
);

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  // `read-only:` is applied here and not in the shared classes: it would also match a <select>.
  return (
    <input
      type={type}
      className={cn(controlClasses, "read-only:bg-surface-muted", className)}
      {...props}
    />
  );
}
