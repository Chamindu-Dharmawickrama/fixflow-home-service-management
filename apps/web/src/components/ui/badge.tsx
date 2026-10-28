import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        info: "border-info-edge bg-info-soft text-info",
        attention: "border-attention-edge bg-attention-soft text-attention",
        success: "border-success-edge bg-success-soft text-success",
        danger: "border-danger-edge bg-danger-soft text-danger",
        neutral: "border-neutral-edge bg-neutral-soft text-neutral",
        brand: "border-brand-soft bg-brand-soft text-brand",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

/**
 * A small label for a category or count. For the state of a record (a request, quotation, job or
 * invoice) use `StatusBadge`, which carries the label, tone and icon from the status mapping.
 */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
