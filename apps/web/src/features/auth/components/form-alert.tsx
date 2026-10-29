import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const TONES = {
  error: {
    classes: "border-danger-edge bg-danger-soft text-danger",
    Icon: CircleAlert,
    role: "alert",
  },
  success: {
    classes: "border-success-edge bg-success-soft text-success",
    Icon: CircleCheck,
    role: "status",
  },
  info: {
    classes: "border-border bg-surface-muted text-ink-secondary",
    Icon: Info,
    role: "status",
  },
} as const;

/**
 * A message above or below a form that is not tied to one field: a failed sign-in, a rate limit,
 * a confirmation. Errors use `role="alert"` so a screen reader announces them as they appear.
 */
export function FormAlert({
  tone,
  children,
  className,
  ...props
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  className?: string;
} & Omit<React.ComponentProps<"div">, "children" | "role">) {
  const { classes, Icon, role } = TONES[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm font-medium",
        classes,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "or" between two ways of signing in. */
export function OrDivider({ children = "or" }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-secondary" role="separator">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
