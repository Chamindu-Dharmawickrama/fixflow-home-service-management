import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** `light` is for light backgrounds (the default); `dark` is for the deep-navy sidebar and footer. */
export type LogoVariant = "light" | "dark";

interface LogoMarkProps extends Omit<ComponentProps<"svg">, "children"> {
  variant?: LogoVariant | undefined;
}

/**
 * The FixFlow mark: a roof over a line of flowing water, drawn on a rounded tile. It is original
 * artwork, built from two strokes so it stays legible at favicon size. `src/app/icon.svg` is the
 * same drawing with literal colours for the browser tab.
 */
export function LogoMark({ variant = "light", className, ...props }: LogoMarkProps) {
  const dark = variant === "dark";
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
      {...props}
    >
      <rect width="32" height="32" rx="8" className={dark ? "fill-accent-fill" : "fill-brand"} />
      <path
        d="M7 15.5 16 8l9 7.5"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={dark ? "stroke-brand-deep" : "stroke-surface"}
      />
      <path
        d="M7.5 22.5q2.125-3 4.25 0t4.25 0 4.25 0 4.25 0"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className={dark ? "stroke-brand-deep" : "stroke-accent-fill"}
      />
    </svg>
  );
}

export interface LogoProps extends Omit<ComponentProps<"span">, "children"> {
  variant?: LogoVariant | undefined;
  /** Show only the mark (for a collapsed sidebar or a small header). The name stays available to screen readers. */
  markOnly?: boolean | undefined;
}

/** The FixFlow mark and wordmark. Wrap it in a link to the home page where it is clickable. */
export function Logo({ variant = "light", markOnly = false, className, ...props }: LogoProps) {
  const dark = variant === "dark";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} {...props}>
      <LogoMark variant={variant} />
      {markOnly ? (
        <span className="sr-only">FixFlow</span>
      ) : (
        <span className="font-display text-xl font-bold tracking-tight">
          <span className={dark ? "text-surface" : "text-ink"}>Fix</span>
          <span className={dark ? "text-accent-fill" : "text-accent"}>Flow</span>
        </span>
      )}
    </span>
  );
}
