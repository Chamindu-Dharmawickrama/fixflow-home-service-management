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
  former = false,
  className,
}: {
  start: string | null;
  end: string | null;
  timeZone: string;
  empty?: string | undefined;
  /**
   * The appointment is history: the job needs a new time, or was cancelled, and the old time is
   * kept for reference. It is labelled so it is never read as a booking.
   */
  former?: boolean | undefined;
  className?: string | undefined;
}) {
  if (start === null || end === null) {
    return <span className={cn("text-ink-secondary", className)}>{empty}</span>;
  }
  return (
    <span className={cn("flex flex-col", className)}>
      {former ? (
        <span className="text-xs font-medium text-ink-secondary">Previously scheduled</span>
      ) : null}
      <DateTimeText value={start} timeZone={timeZone} display="date" />
      <span className="text-ink-secondary">
        {formatTimeRange(start, end, timeZone)} {formatTimeZoneName(start, timeZone)}
      </span>
    </span>
  );
}
