import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";

/**
 * A date field whose value is the API's date-only format, `YYYY-MM-DD`. It is the browser's own
 * date control: people can type the date or open the picker, and phones show their native
 * picker. `min` and `max` take the same format. No time zone is involved in a date-only value.
 */
export function DateInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  return <Input type="date" {...props} />;
}

/**
 * A time field whose value is `HH:mm` in 24-hour form, shown in the visitor's own clock style by
 * the browser. Convert to and from instants in the business time zone with `lib/formatting`; the
 * control itself knows nothing about time zones.
 */
export function TimeInput({ step = 60, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  return <Input type="time" step={step} {...props} />;
}
