"use client";

import { type ChangeEvent, type ComponentProps, useId, useState } from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends ComponentProps<"textarea"> {
  /**
   * Show a live "n / max" counter. Needs `maxLength`. The counter is tied to the field with
   * `aria-describedby`, so it is read when the field is focused rather than on every keystroke.
   */
  showCount?: boolean;
}

const WARN_AT = 0.9;

export function Textarea({
  className,
  showCount = false,
  maxLength,
  value,
  defaultValue,
  onChange,
  "aria-describedby": describedBy,
  ...props
}: TextareaProps) {
  const counterId = useId();
  const [uncontrolledLength, setUncontrolledLength] = useState(String(defaultValue ?? "").length);
  const counting = showCount && maxLength !== undefined;
  const length = value === undefined ? uncontrolledLength : String(value).length;
  const nearLimit = counting && length >= maxLength * WARN_AT;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  };

  const textarea = (
    <textarea
      className={cn(
        "block min-h-24 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-ink sm:text-sm",
        "placeholder:text-ink-muted",
        "transition-colors duration-150 ease-standard",
        "hover:border-ink-muted",
        "aria-invalid:border-danger aria-invalid:hover:border-danger",
        "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted",
        "read-only:bg-surface-muted",
        className,
      )}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      aria-describedby={
        [describedBy, counting ? counterId : undefined].filter(Boolean).join(" ") || undefined
      }
      {...props}
    />
  );

  if (!counting) {
    return textarea;
  }

  return (
    <div className="flex flex-col gap-1">
      {textarea}
      <p
        id={counterId}
        className={cn(
          "text-right text-xs tabular-nums",
          nearLimit ? "font-medium text-attention" : "text-ink-muted",
        )}
      >
        {length} / {maxLength}
        <span className="sr-only"> characters used</span>
      </p>
    </div>
  );
}
