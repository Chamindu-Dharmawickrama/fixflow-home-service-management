"use client";

import {
  PREFERRED_WINDOW_ORDER,
  PREFERRED_WINDOWS,
  type PreferredWindow,
  preferredWindowHours,
} from "@fixflow/shared";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface WindowPickerProps {
  /** The chosen window, or an empty string when none is chosen yet. */
  value: PreferredWindow | "";
  onChange: (window: PreferredWindow) => void;
  disabled?: boolean | undefined;
  /** The group's DOM id, as `FormFieldGroup` passes it (the error summary links to it). */
  id?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
  "aria-required"?: true | undefined;
  className?: string | undefined;
}

/**
 * Chooses the time of day the customer would like (D-35): morning, afternoon or evening, each with
 * the hours it covers on the business's clock. It is a preference, not a booking, and the form says
 * so next to it. Wrap it in a `FormFieldGroup` for the legend and the error.
 */
export function WindowPicker({
  value,
  onChange,
  disabled = false,
  id,
  className,
  ...aria
}: WindowPickerProps) {
  const baseId = useId();

  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(next) => {
        onChange(next as PreferredWindow);
      }}
      disabled={disabled}
      className={cn("grid-cols-1 gap-3 sm:grid-cols-3", className)}
      {...aria}
    >
      {PREFERRED_WINDOW_ORDER.map((window) => {
        const itemId = `${baseId}-${window}`;
        const checked = window === value;
        return (
          <div
            key={window}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150",
              checked ? "border-brand bg-brand-soft" : "border-border hover:border-ink-muted",
            )}
          >
            <RadioGroupItem value={window} id={itemId} className="mt-0.5" />
            <Label
              htmlFor={itemId}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 font-normal"
            >
              <span className="text-base font-semibold text-ink">
                {PREFERRED_WINDOWS[window].label}
              </span>
              <span className="text-sm text-ink-secondary">{preferredWindowHours(window)}</span>
            </Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}
