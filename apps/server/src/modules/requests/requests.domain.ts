import { TZDate } from "@date-fns/tz";
import {
  isDateOnly,
  PREFERRED_WINDOWS,
  preferredDateProblem,
  type PreferredWindow,
  type RequestAddressDto,
} from "@fixflow/shared";

/**
 * Pure rules for service requests (spec §7.1, D-35, D-36): turning the customer's preferred day and
 * window into instants, copying an address, and the words of the history and the notification.
 * Nothing here reads a database, a clock or a request; the service passes everything in.
 */

export interface PreferredInstants {
  start: Date;
  end: Date;
}

/**
 * The window a customer chose, as UTC instants, for a date on the business's calendar (D-35).
 * `2026-11-01` + `MORNING` in New York is 08:00-12:00 Eastern: 13:00-17:00 UTC, because the clocks
 * went back that night. The offset is looked up for the day itself, so a change of the clocks on
 * (or before) that day cannot shift the window by an hour.
 */
export function preferredWindowToUtc(
  date: string,
  window: PreferredWindow,
  timeZone: string,
): PreferredInstants {
  if (!isDateOnly(date)) {
    throw new RangeError(`"${date}" is not a date written YYYY-MM-DD.`);
  }
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const { startHour, endHour } = PREFERRED_WINDOWS[window];

  const at = (hour: number): Date => {
    const instant = new TZDate(year, monthIndex, day, hour, timeZone);
    if (Number.isNaN(instant.getTime())) {
      throw new RangeError(`Cannot place ${date} ${hour}:00 in the time zone "${timeZone}".`);
    }
    return new Date(instant.getTime());
  };
  return { start: at(startHour), end: at(endHour) };
}

/**
 * The problems with the day a customer asked for, as `fieldErrors` (empty when it is fine). `now`
 * is the injected clock's, so the range is tomorrow to 90 days ahead on the business's calendar.
 */
export function preferredDateFieldErrors(
  date: string,
  now: Date,
  timeZone: string,
): Record<string, string> {
  const problem = preferredDateProblem(date, now, timeZone);
  return problem === null ? {} : { preferredDate: problem };
}

/** An address as typed or saved. Optional parts may be missing or `null`. */
export interface AddressInput {
  line1: string;
  line2?: string | null | undefined;
  city: string;
  region?: string | null | undefined;
  postalCode: string;
  accessNotes?: string | null | undefined;
}

/** The columns of a request that hold its copy of the address (D-36). */
export interface AddressSnapshot {
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressRegion: string | null;
  addressPostalCode: string;
  accessNotesSnapshot: string | null;
}

/**
 * Copies the address fields a request keeps. The request owns this copy: editing or deleting the
 * saved address later must not change what was asked for or where the work was to be done.
 */
export function snapshotAddress(address: AddressInput): AddressSnapshot {
  return {
    addressLine1: address.line1,
    addressLine2: address.line2 ?? null,
    addressCity: address.city,
    addressRegion: address.region ?? null,
    addressPostalCode: address.postalCode,
    accessNotesSnapshot: address.accessNotes ?? null,
  };
}

/** The address as the customer is shown it, from the columns of a request. */
export function toRequestAddress(row: AddressSnapshot): RequestAddressDto {
  return {
    line1: row.addressLine1,
    line2: row.addressLine2,
    city: row.addressCity,
    region: row.addressRegion,
    postalCode: row.addressPostalCode,
    accessNotes: row.accessNotesSnapshot,
  };
}

export interface SubmissionTexts {
  /** Phrases for `buildActivitySummaries`: `"<customer> <staff>."` and `"You <customer>."`. */
  activity: { staff: string; customer: string };
  /** The in-app notification every admin receives (D-38). */
  adminNotification: { title: string; message: string };
}

/**
 * The words used when a request is submitted, in one place so the history, the notification and
 * the tests agree. None of them contains the description or the address: those stay in the request.
 */
export function submissionTexts(input: {
  reference: string;
  serviceName: string;
  customerName: string;
}): SubmissionTexts {
  const { reference, serviceName, customerName } = input;
  return {
    activity: {
      staff: `submitted request ${reference} for ${serviceName}`,
      customer: "submitted your request",
    },
    adminNotification: {
      title: `New request ${reference}`,
      message: `${customerName} asked for ${serviceName}. It is waiting for review.`,
    },
  };
}
