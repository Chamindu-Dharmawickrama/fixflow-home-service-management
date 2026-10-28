import type { LucideIcon } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "asChild" | "loadingText"> {
  /** The accessible name. Required: an icon alone does not tell a screen reader what the button does. */
  label: string;
  icon: LucideIcon;
  /** Show the label in a tooltip on hover and focus. On by default. */
  tooltip?: boolean;
}

const SQUARE = {
  sm: "size-9 px-0",
  md: "size-11 px-0 sm:size-10",
  lg: "size-12 px-0",
} as const;

export function IconButton({
  label,
  icon: Icon,
  tooltip = true,
  size = "md",
  variant = "ghost",
  className,
  loading,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      variant={variant}
      size={size}
      loading={loading}
      loadingText={`${label}…`}
      aria-label={label}
      className={cn(SQUARE[size ?? "md"], className)}
      {...props}
    >
      <Icon aria-hidden="true" />
    </Button>
  );

  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
