"use client";

import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the child element (for example a `Link`) with the button's styling. */
  asChild?: boolean | undefined;
  /**
   * Shows a spinner, blocks clicks and form submission, and announces `loadingText` to screen
   * readers. The button stays focusable (`aria-disabled`, not `disabled`) so keyboard focus is not
   * lost while a request is pending. Not supported together with `asChild`.
   */
  loading?: boolean | undefined;
  /** What a screen reader hears while `loading`. Describe the action: "Saving quotation…". */
  loadingText?: string | undefined;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText = "Working…",
  type = "button",
  onClick,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      // Stops duplicate submissions: a click or Enter on a pending submit button does nothing.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        type={type}
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        data-loading={loading || undefined}
        onClick={handleClick}
        {...props}
      >
        {loading ? <Spinner /> : null}
        {children}
      </button>
      {loading ? (
        <span role="status" className="sr-only">
          {loadingText}
        </span>
      ) : null}
    </>
  );
}
