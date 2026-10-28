import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export interface ScrollRegionProps extends Omit<ComponentProps<"div">, "aria-label" | "role"> {
  /** What scrolls, read to screen-reader users: "Service requests". */
  label: string;
}

/**
 * A container that may scroll sideways (a wide table). To be usable without a mouse it is a named
 * region that can take keyboard focus, so arrow keys scroll it (WCAG 2.1.1). Use it only where
 * deliberate horizontal scrolling is the design; most content should reflow instead.
 */
export function ScrollRegion({ label, className, ...props }: ScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("overflow-x-auto", className)}
      {...props}
    />
  );
}
