import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The association with a control comes from `htmlFor`, supplied by the caller or by `Field`. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}
