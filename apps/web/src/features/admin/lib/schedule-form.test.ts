import type { SchedulingConflictDto } from "@fixflow/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  conflictSentence,
  conflictsRoute,
  dayRequest,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_START_TIME,
  describeJobTime,
  describeMove,
  describeSlot,
  durationChoices,
  formatDuration,
  initialScheduleValues,
  mapServerFieldErrors,
  reasonProblem,
  resolveSchedule,
  type ScheduleFormValues,
  toScheduleBody,
  validateScheduleForm,
} from "./schedule-form";

const NEW_YORK = "America/New_York";
const TECHNICIAN = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const filled: ScheduleFormValues = {
  date: "2026-03-03",
  startTime: "10:00",
  duration: "120",
  technicianId: TECHNICIAN,
  reason: "",
};

describe("durationChoices", () => {
  it("offers half-hours from 30 minutes to 12 hours", () => {
    const choices = durationChoices();
    expect(choices[0]).toBe(30);
    expect(choices.at(-1)).toBe(720);
    expect(choices).toHaveLength(24);
    expect(choices.every((minutes) => minutes % 30 === 0)).toBe(true);
  });

  it("adds an odd length a job already has, in its place, so the form can show it", () => {
    const choices = durationChoices(45);
    expect(choices).toContain(45);
    expect(choices.indexOf(45)).toBe(choices.indexOf(30) + 1);
    expect(durationChoices(60)).toHaveLength(24);
  });

  it("ignores a length the server would refuse", () => {
    for (const bad of [0, -30, 721, 1.5, Number.NaN]) {
      expect(durationChoices(bad)).toHaveLength(24);
    }
  });
});

describe("formatDuration", () => {
  it.each([
    [30, "30 minutes"],
    [60, "1 hour"],
    [90, "1 hour 30 minutes"],
    [120, "2 hours"],
    [135, "2 hours 15 minutes"],
    [720, "12 hours"],
    [1, "1 minute"],
  ])("writes %i minutes as %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe("initialScheduleValues", () => {
  it("starts a first booking with no date, a morning start and two hours", () => {
    expect(
      initialScheduleValues(
        { rescheduling: false, scheduledStart: null, scheduledEnd: null, technicianId: null },
        NEW_YORK,
      ),
    ).toEqual({
      date: "",
      startTime: DEFAULT_START_TIME,
      duration: String(DEFAULT_DURATION_MINUTES),
      technicianId: "",
      reason: "",
    });
  });

  it("starts a reschedule from the appointment, read on the business's clocks", () => {
    expect(
      initialScheduleValues(
        {
          rescheduling: true,
          scheduledStart: "2026-03-03T15:00:00.000Z",
          scheduledEnd: "2026-03-03T17:30:00.000Z",
          technicianId: TECHNICIAN,
        },
        NEW_YORK,
      ),
    ).toEqual({
      date: "2026-03-03",
      startTime: "10:00",
      duration: "150",
      technicianId: TECHNICIAN,
      reason: "",
    });
  });

  it("reads an evening visit on the day it happens in New York, not in UTC", () => {
    const values = initialScheduleValues(
      {
        rescheduling: true,
        scheduledStart: "2026-03-04T02:30:00.000Z",
        scheduledEnd: "2026-03-04T03:30:00.000Z",
        technicianId: null,
      },
      NEW_YORK,
    );
    expect(values).toMatchObject({ date: "2026-03-03", startTime: "21:30", duration: "60" });
  });

  it("does not carry the old time of a job that needs a new one, but keeps its technician", () => {
    expect(
      initialScheduleValues(
        {
          rescheduling: false,
          scheduledStart: "2026-03-03T15:00:00.000Z",
          scheduledEnd: "2026-03-03T17:00:00.000Z",
          technicianId: TECHNICIAN,
        },
        NEW_YORK,
      ),
    ).toMatchObject({ date: "", technicianId: TECHNICIAN });
  });
});

describe("resolveSchedule", () => {
  it("turns the business's date and time into UTC instants, with the end after the duration", () => {
    const resolved = resolveSchedule(filled, NEW_YORK);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.window.start.toISOString()).toBe("2026-03-03T15:00:00.000Z");
    expect(resolved.window.end.toISOString()).toBe("2026-03-03T17:00:00.000Z");
  });

  it("follows daylight saving: the same wall time is an hour earlier in UTC in summer", () => {
    const resolved = resolveSchedule({ ...filled, date: "2026-07-14" }, NEW_YORK);
    expect(resolved.ok && resolved.window.start.toISOString()).toBe("2026-07-14T14:00:00.000Z");
  });

  it("measures a visit across the night the clocks go forward in real time, not wall time", () => {
    // 01:00 EST + 2 hours is 04:00 EDT: the wall clock jumps over 02:00 to 03:00.
    const resolved = resolveSchedule(
      { ...filled, date: "2026-03-08", startTime: "01:00", duration: "120" },
      NEW_YORK,
    );
    expect(resolved.ok && resolved.window.end.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("names the time the clocks skip instead of guessing one", () => {
    const resolved = resolveSchedule(
      { ...filled, date: "2026-03-08", startTime: "02:30" },
      NEW_YORK,
    );
    expect(resolved).toEqual({
      ok: false,
      errors: {
        startTime:
          "02:30 does not exist on that day: the clocks go forward that night. Choose another time.",
      },
    });
  });

  it("names every field that is missing or wrong", () => {
    const resolved = resolveSchedule({ date: "", startTime: "", duration: "" }, NEW_YORK);
    expect(resolved).toEqual({
      ok: false,
      errors: {
        date: "Choose the date of the visit.",
        startTime: "Enter the start time.",
        duration: "Choose how long the visit lasts.",
      },
    });
  });

  it.each(["0", "-30", "721", "1.5", "abc", ""])("refuses a duration of %j", (duration) => {
    const resolved = resolveSchedule({ ...filled, duration }, NEW_YORK);
    expect(!resolved.ok && resolved.errors.duration).toBe("Choose how long the visit lasts.");
  });

  it("allows exactly 12 hours", () => {
    const resolved = resolveSchedule({ ...filled, duration: "720" }, NEW_YORK);
    expect(resolved.ok).toBe(true);
  });

  it("refuses a date that is not on the calendar", () => {
    const resolved = resolveSchedule({ ...filled, date: "2026-02-30" }, NEW_YORK);
    expect(!resolved.ok && resolved.errors.date).toBe("Choose the date of the visit.");
  });
});

describe("the browser's own time zone makes no difference (D-104)", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  });

  it.each(["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Europe/London"])(
    "gives the same instants when the browser is set to %s",
    (zone) => {
      process.env.TZ = zone;
      const resolved = resolveSchedule(filled, NEW_YORK);
      expect(resolved.ok && resolved.window.start.toISOString()).toBe("2026-03-03T15:00:00.000Z");
      expect(resolved.ok && resolved.window.end.toISOString()).toBe("2026-03-03T17:00:00.000Z");
      expect(
        initialScheduleValues(
          {
            rescheduling: true,
            scheduledStart: "2026-03-03T15:00:00.000Z",
            scheduledEnd: "2026-03-03T17:00:00.000Z",
            technicianId: null,
          },
          NEW_YORK,
        ),
      ).toMatchObject({ date: "2026-03-03", startTime: "10:00" });
    },
  );
});

describe("reasonProblem", () => {
  it("asks for nothing on a first booking", () => {
    expect(reasonProblem("", false)).toBeUndefined();
    expect(reasonProblem("x".repeat(500), false)).toBeUndefined();
  });

  it("holds a reschedule's reason to 5 to 200 characters, after trimming", () => {
    expect(reasonProblem("", true)).toContain("5 to 200 characters");
    expect(reasonProblem("  abcd  ", true)).toContain("5 to 200 characters");
    expect(reasonProblem("  abcde  ", true)).toBeUndefined();
    expect(reasonProblem("x".repeat(200), true)).toBeUndefined();
    expect(reasonProblem("x".repeat(201), true)).toBe(
      "The reason must be 200 characters or fewer.",
    );
  });
});

describe("validateScheduleForm", () => {
  it("passes a complete first booking", () => {
    expect(validateScheduleForm(filled, NEW_YORK, false)).toEqual({});
  });

  it("needs a technician", () => {
    expect(validateScheduleForm({ ...filled, technicianId: "" }, NEW_YORK, false)).toEqual({
      technicianId: "Choose a technician.",
    });
  });

  it("needs a reason to reschedule", () => {
    expect(Object.keys(validateScheduleForm(filled, NEW_YORK, true))).toEqual(["reason"]);
    expect(
      validateScheduleForm({ ...filled, reason: "The part is late." }, NEW_YORK, true),
    ).toEqual({});
  });

  it("reports everything at once", () => {
    const errors = validateScheduleForm(
      { date: "", startTime: "", duration: "", technicianId: "", reason: "" },
      NEW_YORK,
      true,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["date", "duration", "reason", "startTime", "technicianId"].sort(),
    );
  });
});

describe("toScheduleBody", () => {
  const window = resolveSchedule(filled, NEW_YORK);

  it("sends UTC instants, the technician and the status the screen saw", () => {
    if (!window.ok) throw new Error("setup");
    expect(toScheduleBody(window.window, filled, "PENDING_SCHEDULING", false)).toEqual({
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technicianId: TECHNICIAN,
      expectedStatus: "PENDING_SCHEDULING",
    });
  });

  it("sends the trimmed reason of a reschedule, and none for a first booking", () => {
    if (!window.ok) throw new Error("setup");
    const withReason = { ...filled, reason: "  The part is late.  " };
    expect(toScheduleBody(window.window, withReason, "SCHEDULED", true).reason).toBe(
      "The part is late.",
    );
    expect(
      toScheduleBody(window.window, withReason, "PENDING_SCHEDULING", false),
    ).not.toHaveProperty("reason");
  });
});

describe("mapServerFieldErrors", () => {
  it("puts the start with the date, the end with the duration, and keeps the rest where they are", () => {
    expect(
      mapServerFieldErrors({
        scheduledStart: "The visit cannot start in the past.",
        scheduledEnd: "A visit can last at most 12 hours.",
        technicianId: "Choose a technician from the list.",
        reason: "Enter a reason.",
        somethingElse: "ignored",
      }),
    ).toEqual({
      date: "The visit cannot start in the past.",
      duration: "A visit can last at most 12 hours.",
      technicianId: "Choose a technician from the list.",
      reason: "Enter a reason.",
    });
  });

  it("is empty when the server named no field", () => {
    expect(mapServerFieldErrors(undefined)).toEqual({});
    expect(mapServerFieldErrors({})).toEqual({});
  });
});

describe("conflict requests", () => {
  it("asks about one appointment by technician, instants and the job to leave out", () => {
    const route = conflictsRoute({
      technicianId: TECHNICIAN,
      start: new Date("2026-03-03T15:00:00.000Z"),
      end: new Date("2026-03-03T17:00:00.000Z"),
      excludeId: "job-1",
    });
    const url = new URL(route, "http://x");
    expect(url.pathname).toBe("/admin/work-orders/conflicts");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      technicianId: TECHNICIAN,
      start: "2026-03-03T15:00:00.000Z",
      end: "2026-03-03T17:00:00.000Z",
      excludeId: "job-1",
    });
  });

  it("asks about a whole business day for 'their other jobs that day'", () => {
    const request = dayRequest("2026-03-03", TECHNICIAN, "job-1", NEW_YORK);
    expect(request?.start.toISOString()).toBe("2026-03-03T05:00:00.000Z");
    expect(request?.end.toISOString()).toBe("2026-03-04T05:00:00.000Z");
  });

  it("asks about nothing until there is a date and a technician", () => {
    expect(dayRequest("", TECHNICIAN, "job-1", NEW_YORK)).toBeNull();
    expect(dayRequest("2026-03-03", "", "job-1", NEW_YORK)).toBeNull();
    expect(dayRequest("not-a-date", TECHNICIAN, "job-1", NEW_YORK)).toBeNull();
  });
});

describe("how a conflict is worded", () => {
  const conflict: SchedulingConflictDto = {
    id: "1",
    reference: "JOB-2026-00031",
    status: "SCHEDULED",
    scheduledStart: "2026-03-03T15:00:00.000Z",
    scheduledEnd: "2026-03-03T17:00:00.000Z",
    serviceName: "AC Repair",
    customerName: "Alex Morgan",
  };

  it("names the job and its time on the business's clocks", () => {
    expect(describeJobTime(conflict, NEW_YORK)).toBe("JOB-2026-00031, 10:00 AM – 12:00 PM");
    expect(conflictSentence([conflict], NEW_YORK)).toBe(
      "Conflicts with JOB-2026-00031, 10:00 AM – 12:00 PM.",
    );
  });

  it("says how many more there are", () => {
    expect(
      conflictSentence([conflict, { ...conflict, id: "2" }, { ...conflict, id: "3" }], NEW_YORK),
    ).toBe("Conflicts with JOB-2026-00031, 10:00 AM – 12:00 PM and 2 more.");
  });

  it("says nothing for no conflicts", () => {
    expect(conflictSentence([], NEW_YORK)).toBe("");
  });
});

describe("describeSlot and describeMove: stating a reschedule before it is saved", () => {
  const current = { start: "2026-03-03T15:00:00.000Z", end: "2026-03-03T17:00:00.000Z" };
  const window = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

  it("writes a slot with its weekday and date on the business's clocks", () => {
    expect(describeSlot(current.start, current.end, NEW_YORK)).toBe(
      "Tue, Mar 3, 10:00 AM – 12:00 PM",
    );
    // 02:00Z on the 4th is still the evening of the 3rd in New York.
    expect(describeSlot("2026-03-04T02:00:00.000Z", "2026-03-04T03:00:00.000Z", NEW_YORK)).toBe(
      "Tue, Mar 3, 9:00 – 10:00 PM",
    );
  });

  it("states a move from one slot to another", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window("2026-03-04T19:00:00.000Z", "2026-03-04T21:00:00.000Z"),
          technicianChanged: false,
          technicianName: "Jordan Lee",
        },
        NEW_YORK,
      ),
    ).toBe(
      "Move JOB-2026-00031 from Tue, Mar 3, 10:00 AM – 12:00 PM to Wed, Mar 4, 2:00 – 4:00 PM?",
    );
  });

  it("names the technician when the move changes them", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window("2026-03-04T19:00:00.000Z", "2026-03-04T21:00:00.000Z"),
          technicianChanged: true,
          technicianName: "Sam Ortiz",
        },
        NEW_YORK,
      ),
    ).toBe(
      "Move JOB-2026-00031 from Tue, Mar 3, 10:00 AM – 12:00 PM to Wed, Mar 4, 2:00 – 4:00 PM, with Sam Ortiz?",
    );
  });

  it("states a change of technician alone as keeping the slot", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window(current.start, current.end),
          technicianChanged: true,
          technicianName: "Sam Ortiz",
        },
        NEW_YORK,
      ),
    ).toBe("Keep JOB-2026-00031 at Tue, Mar 3, 10:00 AM – 12:00 PM and give it to Sam Ortiz?");
  });

  it("states a move when only the start changes and the end stays where it was", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window("2026-03-03T16:00:00.000Z", current.end),
          technicianChanged: false,
          technicianName: "Jordan Lee",
        },
        NEW_YORK,
      ),
    ).toBe(
      "Move JOB-2026-00031 from Tue, Mar 3, 10:00 AM – 12:00 PM to Tue, Mar 3, 11:00 AM – 12:00 PM?",
    );
  });

  it("states a move when only the end changes and the start stays where it was", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window(current.start, "2026-03-03T18:00:00.000Z"),
          technicianChanged: false,
          technicianName: undefined,
        },
        NEW_YORK,
      ),
    ).toBe(
      "Move JOB-2026-00031 from Tue, Mar 3, 10:00 AM – 12:00 PM to Tue, Mar 3, 10:00 AM – 1:00 PM?",
    );
  });

  it("has nothing to confirm when nothing changes", () => {
    expect(
      describeMove(
        {
          reference: "JOB-2026-00031",
          current,
          next: window(current.start, current.end),
          technicianChanged: false,
          technicianName: "Jordan Lee",
        },
        NEW_YORK,
      ),
    ).toBeNull();
  });

  it("reads the same whatever zone the browser is in, because the zone is given", () => {
    const sentence = describeSlot(current.start, current.end, "Asia/Colombo");
    expect(sentence).toBe("Tue, Mar 3, 8:30 – 10:30 PM");
    expect(describeSlot(current.start, current.end, NEW_YORK)).not.toBe(sentence);
  });
});
