"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { DialogOverlay } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sheetVariants = cva(
  [
    "fixed inset-y-0 z-50 flex h-full flex-col gap-4 shadow-lg",
    "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
  ],
  {
    variants: {
      side: {
        left: "left-0 w-72 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
        right:
          "right-0 w-80 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
      },
      tone: {
        light: "bg-surface text-ink",
        // The navigation drawer keeps the sidebar's deep brand colour and its lighter focus ring.
        dark: "bg-brand-deep text-surface",
      },
    },
    defaultVariants: { side: "left", tone: "light" },
  },
);

export interface SheetContentProps
  extends ComponentProps<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /** Show a corner close button. Navigation drawers draw their own. */
  showCloseButton?: boolean | undefined;
}

/**
 * A drawer that slides in from the edge: the mobile navigation drawer (`left`, `tone="dark"`) and
 * detail panels (`right`). It is a modal dialog, so focus is trapped, Escape closes it and focus
 * returns to the trigger. Include a `SheetTitle` (hide it with `sr-only` when the layout supplies
 * its own heading).
 */
export function SheetContent({
  className,
  side,
  tone,
  children,
  showCloseButton = false,
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay />
      <SheetPrimitive.Content
        data-surface={tone === "dark" ? "dark" : undefined}
        className={cn(sheetVariants({ side, tone }), className)}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close asChild>
            <IconButton
              label="Close"
              icon={X}
              size="sm"
              tooltip={false}
              className="absolute right-3 top-3"
            />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("font-display text-lg font-semibold", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm", className)} {...props} />;
}
