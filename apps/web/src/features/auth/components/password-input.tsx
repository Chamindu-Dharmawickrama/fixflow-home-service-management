"use client";

import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a show/hide button. The button is a real toggle (`aria-pressed`) with a
 * name that says what it does next, is reachable by keyboard, and never submits the form. Pass the
 * right `autoComplete` (`current-password` or `new-password`) so password managers behave.
 */
export function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        // Browsers' own reveal/clear affordances would double up with ours.
        className={cn("pr-12", className)}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <button
        type="button"
        onClick={() => {
          setVisible((current) => !current);
        }}
        disabled={disabled}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-secondary hover:text-ink disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}
