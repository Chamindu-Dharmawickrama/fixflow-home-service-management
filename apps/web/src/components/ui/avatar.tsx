"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Avatar as AvatarPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand",
  {
    variants: {
      size: {
        sm: "size-8 text-xs",
        md: "size-10 text-sm",
        lg: "size-14 text-lg",
      },
    },
    defaultVariants: { size: "md" },
  },
);

/** Up to two initials from a name: `"Morgan Reyes"` → `"MR"`, `"Priya"` → `"P"`. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  /** Whose avatar this is; it becomes the accessible name and the source of the initials. */
  name: string;
  /** An image URL. Without one (or if it fails to load) the initials are shown. */
  src?: string | undefined;
  /**
   * Use when the person's name is written next to the avatar. The avatar is then hidden from
   * assistive technology instead of repeating the name.
   */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

export function Avatar({ name, src, size, decorative = false, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      className={cn(avatarVariants({ size }), className)}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      {/* With an image, wait briefly so the initials do not flash before it loads. */}
      <AvatarPrimitive.Fallback {...(src ? { delayMs: 300 } : {})}>
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
