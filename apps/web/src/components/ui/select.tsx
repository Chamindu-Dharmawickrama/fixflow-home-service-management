import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { controlClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SelectProps extends ComponentProps<"select"> {
  /**
   * Text of the empty first option, for example "Choose a service". It submits as an empty string
   * and cannot be re-selected once the field is `required`.
   */
  placeholder?: string;
}

/**
 * A styled native `<select>`. The browser provides the keyboard behaviour, screen-reader support
 * and the touch picker on phones, which is better than a custom listbox for the short option
 * lists this application has. Pass `<option>` or `<optgroup>` children.
 */
export function Select({
  className,
  placeholder,
  children,
  value,
  defaultValue,
  required,
  ...props
}: SelectProps) {
  // A browser skips a disabled first option when choosing the initial one, so an uncontrolled
  // select with a placeholder must start on the empty value explicitly.
  const valueProps =
    value !== undefined
      ? { value }
      : { defaultValue: defaultValue ?? (placeholder === undefined ? undefined : "") };

  return (
    <div className="relative">
      <select
        className={cn(controlClasses, "appearance-none pr-10", className)}
        required={required}
        {...valueProps}
        {...props}
      >
        {placeholder === undefined ? null : (
          <option value="" disabled={required === true}>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
}
