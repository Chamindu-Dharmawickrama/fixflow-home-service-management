import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Key/value details such as a customer's contact data. Terms sit beside values from the `sm`
 * breakpoint and stack above them on phones.
 */
export function DescriptionList({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("divide-y divide-border", className)} {...props} />;
}

export interface DescriptionItemProps extends Omit<ComponentProps<"div">, "children"> {
  term: ReactNode;
  children: ReactNode;
}

export function DescriptionItem({ term, children, className, ...props }: DescriptionItemProps) {
  return (
    <div className={cn("py-3 sm:grid sm:grid-cols-3 sm:gap-4", className)} {...props}>
      <dt className="text-sm font-medium text-ink-secondary">{term}</dt>
      <dd className="mt-1 min-w-0 break-words text-sm text-ink sm:col-span-2 sm:mt-0">
        {children}
      </dd>
    </div>
  );
}
