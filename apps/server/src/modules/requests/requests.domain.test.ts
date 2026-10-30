import { PreferredWindow } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  preferredDateFieldErrors,
  preferredWindowToUtc,
  snapshotAddress,
  submissionTexts,
  toRequestAddress,
} from "./requests.domain.js";

const NEW_YORK = "America/New_York";

/** `[start, end]` as ISO strings, which are easier to read in a failure than two Dates. */
function window(date: string, preferred: PreferredWindow, timeZone: string): [string, string] {
  const { start, end } = preferredWindowToUtc(date, preferred, timeZone);
  return [start.toISOString(), end.toISOString()];
}

describe("preferredWindowToUtc (D-35)", () => {
  describe("in New York", () => {
    it("converts the three windows on an ordinary winter day (EST, UTC-5)", () => {
      expect(window("2026-12-15", "MORNING", NEW_YORK)).toEqual([
        "2026-12-15T13:00:00.000Z",
        "2026-12-15T17:00:00.000Z",
      ]);
      expect(window("2026-12-15", "AFTERNOON", NEW_YORK)).toEqual([
        "2026-12-15T17:00:00.000Z",
        "2026-12-15T21:00:00.000Z",
      ]);
      expect(window("2026-12-15", "EVENING", NEW_YORK)).toEqual([
        "2026-12-15T21:00:00.000Z",
        "2026-12-16T00:00:00.000Z",
      ]);
    });

    it("converts the windows on an ordinary summer day (EDT, UTC-4)", () => {
      expect(window("2027-07-15", "MORNING", NEW_YORK)).toEqual([
        "2027-07-15T12:00:00.000Z",
        "2027-07-15T16:00:00.000Z",
      ]);
      expect(window("2027-07-15", "EVENING", NEW_YORK)).toEqual([
        "2027-07-15T20:00:00.000Z",
        "2027-07-15T23:00:00.000Z",
      ]);
    });

    it("uses summer time all day on the day the clocks go forward (2026-03-08, 02:00 -> 03:00)", () => {
      // 08:00 is after the change, so it is already EDT: 12:00 UTC, not 13:00.
      expect(window("2026-03-08", "MORNING", NEW_YORK)).toEqual([
        "2026-03-08T12:00:00.000Z",
        "2026-03-08T16:00:00.000Z",
      ]);
      expect(window("2026-03-08", "AFTERNOON", NEW_YORK)).toEqual([
        "2026-03-08T16:00:00.000Z",
        "2026-03-08T20:00:00.000Z",
      ]);
    });

    it("uses winter time all day on the day the clocks go back (2026-11-01, 02:00 -> 01:00)", () => {
      // 08:00 is after the change, so it is EST: 13:00 UTC, not 12:00.
      expect(window("2026-11-01", "MORNING", NEW_YORK)).toEqual([
        "2026-11-01T13:00:00.000Z",
        "2026-11-01T17:00:00.000Z",
      ]);
      expect(window("2026-11-01", "EVENING", NEW_YORK)).toEqual([
        "2026-11-01T21:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      ]);
    });

    it("moves by one hour of UTC between the day before and the day after a change", () => {
      const before = preferredWindowToUtc("2026-10-31", "MORNING", NEW_YORK).start;
      const after = preferredWindowToUtc("2026-11-02", "MORNING", NEW_YORK).start;

      // 08:00 EDT = 12:00Z on the 31st; 08:00 EST = 13:00Z on the 2nd. Two calendar days apart,
      // but 49 hours: the clocks gained an hour in between.
      expect(before.toISOString()).toBe("2026-10-31T12:00:00.000Z");
      expect(after.toISOString()).toBe("2026-11-02T13:00:00.000Z");
      expect((after.getTime() - before.getTime()) / 3_600_000).toBe(49);
    });
  });

  describe("in other zones", () => {
    it("handles London, which changes on a different date (2026-03-29 and 2026-10-25)", () => {
      expect(window("2026-03-28", "MORNING", "Europe/London")).toEqual([
        "2026-03-28T08:00:00.000Z",
        "2026-03-28T12:00:00.000Z",
      ]);
      // British Summer Time (UTC+1) has begun: 08:00 local is 07:00 UTC.
      expect(window("2026-03-29", "MORNING", "Europe/London")).toEqual([
        "2026-03-29T07:00:00.000Z",
        "2026-03-29T11:00:00.000Z",
      ]);
      // Back on Greenwich Mean Time: 08:00 local is 08:00 UTC.
      expect(window("2026-10-25", "MORNING", "Europe/London")).toEqual([
        "2026-10-25T08:00:00.000Z",
        "2026-10-25T12:00:00.000Z",
      ]);
    });

    it("handles the southern hemisphere, where the evening of the day before is the morning (Auckland 2026-09-27)", () => {
      // New Zealand summer time (UTC+13) begins at 02:00 on 27 September: 08:00 local is 19:00 UTC the day before.
      expect(window("2026-09-27", "MORNING", "Pacific/Auckland")).toEqual([
        "2026-09-26T19:00:00.000Z",
        "2026-09-26T23:00:00.000Z",
      ]);
    });

    it("handles a zone with a half-hour offset and no changes (Kolkata, UTC+5:30)", () => {
      expect(window("2026-11-10", "MORNING", "Asia/Kolkata")).toEqual([
        "2026-11-10T02:30:00.000Z",
        "2026-11-10T06:30:00.000Z",
      ]);
    });

    it("handles UTC itself", () => {
      expect(window("2026-11-10", "AFTERNOON", "UTC")).toEqual([
        "2026-11-10T12:00:00.000Z",
        "2026-11-10T16:00:00.000Z",
      ]);
    });
  });

  it("always ends after it starts, as the database requires", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2027-02-28", "2028-02-29"]) {
      for (const preferred of Object.values(PreferredWindow)) {
        const { start, end } = preferredWindowToUtc(date, preferred, NEW_YORK);
        expect(end.getTime()).toBeGreaterThan(start.getTime());
      }
    }
  });

  it("keeps the window as long as its hours on a day with no change", () => {
    const { start, end } = preferredWindowToUtc("2026-12-15", "MORNING", NEW_YORK);

    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(4);
  });

  it("refuses a date that is not a real calendar date", () => {
    expect(() => preferredWindowToUtc("2026-02-30", "MORNING", NEW_YORK)).toThrow(RangeError);
    expect(() => preferredWindowToUtc("next friday", "MORNING", NEW_YORK)).toThrow(RangeError);
  });
});

describe("preferredDateFieldErrors", () => {
  const now = new Date("2026-10-30T14:00:00.000Z"); // 10:00 on Friday 30 October in New York

  it("is empty for tomorrow and for the last allowed day", () => {
    expect(preferredDateFieldErrors("2026-10-31", now, NEW_YORK)).toEqual({});
    expect(preferredDateFieldErrors("2027-01-28", now, NEW_YORK)).toEqual({});
  });

  it("names the field and says what is wrong", () => {
    expect(preferredDateFieldErrors("2026-10-30", now, NEW_YORK)).toEqual({
      preferredDate: "Choose a date from tomorrow onwards.",
    });
    expect(preferredDateFieldErrors("2027-01-29", now, NEW_YORK)).toEqual({
      preferredDate: "Choose a date within the next 90 days.",
    });
  });

  it("judges 'tomorrow' by the business's calendar even when UTC is already a day ahead", () => {
    const lateEvening = new Date("2026-10-31T02:30:00.000Z"); // 22:30 on 30 October in New York

    expect(preferredDateFieldErrors("2026-10-31", lateEvening, NEW_YORK)).toEqual({});
    expect(preferredDateFieldErrors("2026-10-30", lateEvening, NEW_YORK)).not.toEqual({});
  });

  it("holds across a change of the clocks (a DST date inside the range)", () => {
    const eve = new Date("2026-10-31T20:00:00.000Z"); // 16:00 EDT on 31 October

    // 1 November is the day the clocks go back; it is tomorrow, so it is allowed.
    expect(preferredDateFieldErrors("2026-11-01", eve, NEW_YORK)).toEqual({});
    expect(preferredDateFieldErrors("2026-10-31", eve, NEW_YORK)).not.toEqual({});
  });
});

describe("address snapshot (D-36)", () => {
  it("copies every field and turns missing optional parts into null", () => {
    expect(
      snapshotAddress({
        line1: "214 Larkspur Lane",
        city: "Harbor City",
        postalCode: "10001",
      }),
    ).toEqual({
      addressLine1: "214 Larkspur Lane",
      addressLine2: null,
      addressCity: "Harbor City",
      addressRegion: null,
      addressPostalCode: "10001",
      accessNotesSnapshot: null,
    });
  });

  it("keeps the access notes with the copy", () => {
    const snapshot = snapshotAddress({
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Gate code 4821, dog in the yard.",
    });

    expect(snapshot.accessNotesSnapshot).toBe("Gate code 4821, dog in the yard.");
    expect(snapshot.addressLine2).toBe("Unit 4");
  });

  it("round-trips to the address a customer is shown", () => {
    const input = {
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      region: "NY",
      postalCode: "10001",
      accessNotes: "Side door",
    };

    expect(toRequestAddress(snapshotAddress(input))).toEqual(input);
  });

  it("ignores columns that are not part of the address", () => {
    const snapshot = snapshotAddress({
      line1: "1 A St",
      city: "B",
      postalCode: "1",
      ...({ id: "x", customerId: "y", label: "Home", isDefault: true } as object),
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      "accessNotesSnapshot",
      "addressCity",
      "addressLine1",
      "addressLine2",
      "addressPostalCode",
      "addressRegion",
    ]);
  });
});

describe("submissionTexts", () => {
  const texts = submissionTexts({
    reference: "FF-2026-00012",
    serviceName: "AC Repair",
    customerName: "Alex Morgan",
  });

  it("describes the submission for staff and for the customer", () => {
    expect(texts.activity.staff).toBe("submitted request FF-2026-00012 for AC Repair");
    expect(texts.activity.customer).toBe("submitted your request");
  });

  it("tells the admins who asked for what, and links nowhere in the text itself", () => {
    expect(texts.adminNotification.title).toBe("New request FF-2026-00012");
    expect(texts.adminNotification.message).toBe(
      "Alex Morgan asked for AC Repair. It is waiting for review.",
    );
  });
});
