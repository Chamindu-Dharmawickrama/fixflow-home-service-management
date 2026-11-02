"use client";

import { TECHNICIAN_COLORS, type TechnicianColor } from "@fixflow/shared";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import { TECHNICIAN_COLOR_STYLES } from "../lib/technician-colors";

export interface ColorPickerProps {
  value: TechnicianColor;
  onChange: (color: TechnicianColor) => void;
  disabled?: boolean | undefined;
  /** The group's DOM id, as `FormFieldGroup` passes it (the error summary links to it). */
  id?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
  "aria-required"?: true | undefined;
}

/**
 * Chooses the colour a technician's jobs have on the calendar (T19). Every choice has a swatch and
 * its name, so it never depends on telling two colours apart. The choices are the palette in
 * `@fixflow/shared`; the swatches come from the design tokens. Wrap it in a `FormFieldGroup` for
 * the legend and the error.
 */
export function ColorPicker({ value, onChange, disabled = false, id, ...aria }: ColorPickerProps) {
  const baseId = useId();

  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(next) => {
        const color = TECHNICIAN_COLORS.find((candidate) => candidate === next);
        if (color !== undefined) onChange(color);
      }}
      disabled={disabled}
      className="grid-cols-2 gap-2"
      {...aria}
    >
      {TECHNICIAN_COLORS.map((color) => {
        const itemId = `${baseId}-${color}`;
        const style = TECHNICIAN_COLOR_STYLES[color];
        const checked = color === value;
        return (
          <div
            key={color}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150",
              checked ? "border-brand bg-brand-soft" : "border-border hover:border-ink-muted",
            )}
          >
            <RadioGroupItem value={color} id={itemId} />
            <Label
              htmlFor={itemId}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 font-normal"
            >
              <span aria-hidden="true" className={cn("size-4 shrink-0 rounded-full", style.dot)} />
              <span className="text-sm text-ink">{style.label}</span>
            </Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}
