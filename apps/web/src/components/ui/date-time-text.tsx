import type { ComponentProps } from "react";

import {
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeZoneName,
} from "@/lib/formatting/datetime";
import { cn } from "@/lib/utils";

export interface DateTimeTextProps extends Omit<ComponentProps<"time">, "children" | "dateTime"> {
  /** An ISO 8601 instant (`2026-10-28T15:30:00Z`) or a date-only value (`2026-10-28`). */
  value: string;
  /** The business time zone from settings (an IANA name such as `America/New_York`). */
  timeZone: string;
  /** What to show. Date-only values always show the date. */
  display?: "date" | "dateTime" | "time" | undefined;
}

/**
 * A date or time in the business time zone, as a semantic `<time>` element. The tooltip adds the
 * time zone name, because "3:30 PM" alone does not say whose clock it is.
 */
export function DateTimeText({
  value,
  timeZone,
  display = "dateTime",
  className,
  ...props
}: DateTimeTextProps) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const text = isDateOnly
    ? formatDate(value, timeZone)
    : display === "date"
      ? formatDate(value, timeZone)
      : display === "time"
        ? formatTime(value, timeZone)
        : formatDateTime(value, timeZone);
  const title = isDateOnly
    ? undefined
    : `${formatDateTime(value, timeZone)} ${formatTimeZoneName(value, timeZone)}`;

  return (
    <time dateTime={value} title={title} className={cn("whitespace-nowrap", className)} {...props}>
      {text}
    </time>
  );
}
