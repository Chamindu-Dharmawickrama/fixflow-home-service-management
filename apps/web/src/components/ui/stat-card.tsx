import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  /** The number or amount. Pass a `MoneyText` for money. */
  value: ReactNode;
  /** One line of context: the period, a comparison, or what needs attention. */
  context?: ReactNode;
  /** Makes the card a link to the records behind the number. */
  href?: string | undefined;
  icon?: LucideIcon | undefined;
  /** Colours the value to flag a figure that needs attention (for example overdue invoices). */
  tone?: "default" | "attention" | "danger" | undefined;
  className?: string | undefined;
}

const VALUE_TONES = {
  default: "text-ink",
  attention: "text-attention",
  danger: "text-danger",
} as const;

/**
 * One headline figure for a dashboard. Show four or five of these, not a wall of them (UX-03),
 * and link each to the list it summarises so the number is a way in, not decoration.
 */
export function StatCard({
  label,
  value,
  context,
  href,
  icon: Icon,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        "relative flex flex-col gap-1 p-4 sm:p-5",
        href && "transition-colors duration-150 ease-standard hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-ink-secondary">
        {href ? (
          <Link
            href={href}
            className="rounded-sm after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:text-ink"
          >
            {label}
          </Link>
        ) : (
          <span>{label}</span>
        )}
        {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" /> : null}
      </div>
      <p className={cn("font-display text-3xl font-semibold tabular-nums", VALUE_TONES[tone])}>
        {value}
      </p>
      {context ? <p className="text-sm text-ink-secondary">{context}</p> : null}
    </Card>
  );
}
