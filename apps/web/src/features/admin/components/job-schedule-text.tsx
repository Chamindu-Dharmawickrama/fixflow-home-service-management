import { DateTimeText } from "@/components/ui/date-time-text";
import { formatTimeRange, formatTimeZoneName } from "@/lib/formatting/datetime";
import { cn } from "@/lib/utils";

/**
 * A job's appointment on the business's clocks: the day, then the time range. A job with no
 * appointment says so instead of showing an empty cell. Times are never the browser's: they come
 * from the business time zone (BR-17).
 */
export function JobScheduleText({
  start,
  end,
  timeZone,
  empty = "Not scheduled yet",
  className,
}: {
  start: string | null;
  end: string | null;
  timeZone: string;
  empty?: string | undefined;
  className?: string | undefined;
}) {
  if (start === null || end === null) {
    return <span className={cn("text-ink-secondary", className)}>{empty}</span>;
  }
  return (
    <span className={cn("flex flex-col", className)}>
      <DateTimeText value={start} timeZone={timeZone} display="date" />
      <span className="text-ink-secondary">
        {formatTimeRange(start, end, timeZone)} {formatTimeZoneName(start, timeZone)}
      </span>
    </span>
  );
}
