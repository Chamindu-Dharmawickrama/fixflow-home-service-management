import { Check, Minus, X } from "lucide-react";

import { type PasswordStrength as Strength, passwordStrength } from "@/features/auth/lib/schemas";
import { cn } from "@/lib/utils";

const COPY: Record<Strength, { text: string; tone: string; Icon: typeof Check }> = {
  empty: {
    text: "Choose a password of at least 10 characters.",
    tone: "text-ink-secondary",
    Icon: Minus,
  },
  "too-short": {
    text: "Too short so far. Use at least 10 characters.",
    tone: "text-danger",
    Icon: X,
  },
  okay: {
    text: "Okay. A few more characters would make it stronger.",
    tone: "text-attention",
    Icon: Check,
  },
  good: {
    text: "Strong. Length is what makes a password hard to guess.",
    tone: "text-success",
    Icon: Check,
  },
};

/**
 * A live hint under the new-password field. It is text with an icon, never colour alone, and it is
 * announced politely as the person types (without shouting on every keystroke: it only changes at
 * the thresholds).
 */
export function PasswordStrength({
  password,
  className,
}: {
  password: string;
  className?: string;
}) {
  const strength = passwordStrength(password);
  const { text, tone, Icon } = COPY[strength];

  return (
    <p
      role="status"
      aria-live="polite"
      data-strength={strength}
      className={cn("flex items-start gap-2 text-sm", tone, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
