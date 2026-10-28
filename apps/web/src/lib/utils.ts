import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know which of our token names are colours, font families and text
 * sizes; otherwise `text-ink` could be mistaken for a font size and survive next to `text-sm`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "page",
        "surface",
        "surface-muted",
        "border-strong",
        "ink",
        "ink-secondary",
        "ink-muted",
        "brand",
        "brand-hover",
        "brand-deep",
        "brand-soft",
        "accent",
        "accent-fill",
        "accent-soft",
        "nav-text",
        "nav-muted",
        "nav-hover",
        "nav-active",
        "nav-border",
        "focus",
        "focus-on-dark",
        "success",
        "success-soft",
        "success-edge",
        "attention",
        "attention-soft",
        "attention-edge",
        "danger",
        "danger-hover",
        "danger-soft",
        "danger-edge",
        "info",
        "info-soft",
        "info-edge",
        "neutral",
        "neutral-soft",
        "neutral-edge",
      ],
      font: ["sans", "display", "mono"],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts, the last one winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
