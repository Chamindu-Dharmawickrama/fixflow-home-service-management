"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** The tab strip. It scrolls sideways on narrow screens instead of wrapping or overflowing the page. */
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium text-ink-secondary",
        "transition-colors duration-150 ease-standard hover:text-ink",
        "data-[state=active]:text-brand",
        "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full",
        "data-[state=active]:after:bg-brand",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("pt-4", className)} {...props} />;
}
