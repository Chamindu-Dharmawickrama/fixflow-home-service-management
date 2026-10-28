import { cva } from "class-variance-authority";

/** The classes of every button style. Plain module (no client directive), so server code can also style a link as a button. */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium",
    "transition-colors duration-150 ease-standard",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-brand text-surface hover:bg-brand-hover aria-disabled:bg-brand-hover",
        secondary: "bg-brand-soft text-brand hover:bg-surface-muted",
        outline:
          "border border-border-strong bg-surface text-ink hover:bg-surface-muted aria-disabled:bg-surface-muted",
        ghost: "text-ink-secondary hover:bg-surface-muted hover:text-ink",
        destructive: "bg-danger text-surface hover:bg-danger-hover aria-disabled:bg-danger-hover",
        link: "h-auto rounded-md p-0 text-brand underline-offset-4 hover:underline",
      },
      // Primary actions are 44 px tall on touch-width screens, 40 px from the `sm` breakpoint up.
      size: {
        sm: "h-9 px-3 text-sm [&_svg]:size-4",
        md: "h-11 px-4 text-sm sm:h-10 [&_svg]:size-4",
        lg: "h-12 px-6 text-base [&_svg]:size-5",
      },
    },
    // A link-style button sits inline with text, so it drops the fixed height at every breakpoint.
    compoundVariants: [{ variant: "link", className: "h-auto px-0 sm:h-auto" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);
