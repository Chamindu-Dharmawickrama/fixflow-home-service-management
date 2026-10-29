"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface SourceChoiceOption<Value extends string> {
  value: Value;
  label: string;
  description?: string | undefined;
}

export interface SourceChoiceProps<Value extends string> {
  options: readonly SourceChoiceOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  id?: string | undefined;
  disabled?: boolean | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
}

/**
 * "Where does it come from?": a short radio list for choosing between no picture, a bundled one and
 * a web address (or between fixed pricing and a quote). Put it inside a `FormFieldGroup`.
 */
export function SourceChoice<Value extends string>({
  options,
  value,
  onChange,
  id,
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: SourceChoiceProps<Value>) {
  const base = useId();
  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(next) => {
        onChange(next as Value);
      }}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className="gap-3"
    >
      {options.map((option) => {
        const itemId = `${base}-${option.value}`;
        return (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem value={option.value} id={itemId} className="mt-0.5" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={itemId}>{option.label}</Label>
              {option.description ? (
                <p className="text-sm text-ink-secondary">{option.description}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </RadioGroup>
  );
}
