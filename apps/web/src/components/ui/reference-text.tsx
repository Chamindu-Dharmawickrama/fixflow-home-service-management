import type { ComponentProps } from "react";

import { formatReference } from "@/lib/formatting/reference";
import { cn } from "@/lib/utils";

export interface ReferenceTextProps extends Omit<ComponentProps<"span">, "children"> {
  /** A document reference such as `FF-2026-00125`. */
  reference: string;
}

/** A document reference that never wraps across lines and keeps its digits aligned. */
export function ReferenceText({ reference, className, ...props }: ReferenceTextProps) {
  return (
    <span className={cn("whitespace-nowrap font-medium tabular-nums", className)} {...props}>
      {formatReference(reference)}
    </span>
  );
}
