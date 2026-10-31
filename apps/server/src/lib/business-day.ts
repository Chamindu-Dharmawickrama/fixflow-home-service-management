import { TZDate } from "@date-fns/tz";

/**
 * The instant a calendar day starts at on the business's wall clock (`date` is `YYYY-MM-DD`, `timeZone`
 * an IANA name). It is looked up for that day, so a day on which the clocks change still starts at
 * local midnight, whatever zone the server or the browser is in (BR-17).
 */
export function startOfBusinessDay(date: string, timeZone: string): Date {
  const instant = new TZDate(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    timeZone,
  );
  return new Date(instant.getTime());
}
