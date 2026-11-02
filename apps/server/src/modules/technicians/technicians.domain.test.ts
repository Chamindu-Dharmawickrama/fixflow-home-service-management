import { TECHNICIAN_COLORS } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  type Appointment,
  assignmentWindow,
  availableActions,
  BOOKED_STATUSES,
  changedTechnicianFields,
  isUpcoming,
  keptAssignmentsPhrase,
  mergeTechnicianValues,
  pickCalendarColor,
  scheduledMinutesPerDay,
  type TechnicianValues,
  tidySpecialties,
} from "./technicians.domain.js";

const NEW_YORK = "America/New_York";
const at = (iso: string) => new Date(iso);
const job = (start: string, end: string): Appointment => ({
  scheduledStart: at(start),
  scheduledEnd: at(end),
});

describe("which jobs hold a technician's time", () => {
  it("is the scheduled and the in-progress ones, as D-25 counts them", () => {
    expect(BOOKED_STATUSES).toEqual(["SCHEDULED", "IN_PROGRESS"]);
  });
});

describe("assignmentWindow", () => {
  it("covers today and the next 13 days, with seven day buckets, on the business's calendar", () => {
    // 10:00 in New York (EST) on 2 Nov 2026.
    const window = assignmentWindow(at("2026-11-02T15:00:00.000Z"), NEW_YORK);

    expect(window.from).toEqual(at("2026-11-02T15:00:00.000Z"));
    expect(window.since).toEqual(at("2026-11-02T05:00:00.000Z"));
    // 14 days: today to 15 Nov inclusive, so the window ends as 16 Nov starts.
    expect(window.until).toEqual(at("2026-11-16T05:00:00.000Z"));
    expect(window.days.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(window.days[0]?.start).toEqual(window.since);
  });

  it("tiles the days: each ends exactly where the next begins", () => {
    const { days } = assignmentWindow(at("2026-11-02T15:00:00.000Z"), NEW_YORK);
    days.slice(1).forEach((day, index) => {
      expect(days[index]?.end).toEqual(day.start);
    });
  });

  it("reads today on the business's calendar late in the evening, when UTC is already tomorrow", () => {
    // 22:30 in New York on 2 Nov is 03:30 UTC on 3 Nov.
    const window = assignmentWindow(at("2026-11-03T03:30:00.000Z"), NEW_YORK);
    expect(window.days[0]?.date).toBe("2026-11-02");
  });

  it("reads today on the business's calendar early in the morning, when UTC is still yesterday", () => {
    // 01:00 on 2 Nov in Auckland (NZDT, UTC+13) is 12:00 UTC on 1 Nov.
    const window = assignmentWindow(at("2026-11-01T12:00:00.000Z"), "Pacific/Auckland");
    expect(window.days[0]?.date).toBe("2026-11-02");
  });

  it("makes the day the clocks go back 25 hours long, and the day they go forward 23", () => {
    const hours = (day: { start: Date; end: Date }) =>
      (day.end.getTime() - day.start.getTime()) / 3_600_000;

    // 1 Nov 2026 is the autumn change in New York.
    const autumn = assignmentWindow(at("2026-10-30T15:00:00.000Z"), NEW_YORK);
    expect(autumn.days.map((day) => [day.date, hours(day)])).toEqual([
      ["2026-10-30", 24],
      ["2026-10-31", 24],
      ["2026-11-01", 25],
      ["2026-11-02", 24],
      ["2026-11-03", 24],
      ["2026-11-04", 24],
      ["2026-11-05", 24],
    ]);

    // 8 Mar 2026 is the spring change.
    const spring = assignmentWindow(at("2026-03-06T15:00:00.000Z"), NEW_YORK);
    expect(spring.days.find((day) => day.date === "2026-03-08")).toBeDefined();
    expect(hours(spring.days.find((day) => day.date === "2026-03-08")!)).toBe(23);
  });

  it("counts 14 calendar days even across the autumn change of the clocks", () => {
    const window = assignmentWindow(at("2026-10-30T15:00:00.000Z"), NEW_YORK);
    // Fourteen days from 30 Oct start the 13th of November: midnight EST, 05:00 UTC.
    expect(window.until).toEqual(at("2026-11-13T05:00:00.000Z"));
  });
});

describe("isUpcoming", () => {
  const window = assignmentWindow(at("2026-11-02T15:00:00.000Z"), NEW_YORK);

  it("counts a job that starts later today", () => {
    expect(isUpcoming(job("2026-11-02T18:00:00.000Z", "2026-11-02T20:00:00.000Z"), window)).toBe(
      true,
    );
  });

  it("counts a job that is under way right now: it has begun but not ended", () => {
    expect(isUpcoming(job("2026-11-02T14:00:00.000Z", "2026-11-02T16:00:00.000Z"), window)).toBe(
      true,
    );
  });

  it("does not count a job that has ended, or ends at the very instant of now", () => {
    expect(isUpcoming(job("2026-11-02T12:00:00.000Z", "2026-11-02T14:00:00.000Z"), window)).toBe(
      false,
    );
    expect(isUpcoming(job("2026-11-02T13:00:00.000Z", "2026-11-02T15:00:00.000Z"), window)).toBe(
      false,
    );
    // One millisecond later it is still going.
    expect(isUpcoming(job("2026-11-02T13:00:00.000Z", "2026-11-02T15:00:00.001Z"), window)).toBe(
      true,
    );
  });

  it("counts a job on the last day of the window and not one on the next day", () => {
    // The window ends at 05:00Z on 16 Nov (the start of that day in New York).
    expect(isUpcoming(job("2026-11-16T04:59:59.999Z", "2026-11-16T07:00:00.000Z"), window)).toBe(
      true,
    );
    expect(isUpcoming(job("2026-11-16T05:00:00.000Z", "2026-11-16T07:00:00.000Z"), window)).toBe(
      false,
    );
  });
});

describe("scheduledMinutesPerDay", () => {
  const { days } = assignmentWindow(at("2026-11-02T15:00:00.000Z"), NEW_YORK);
  const minutes = (appointments: Appointment[]) =>
    scheduledMinutesPerDay(appointments, days).map((day) => day.scheduledMinutes);

  it("is zero on every day when there are no jobs, and names the seven days", () => {
    expect(minutes([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(scheduledMinutesPerDay([], days).map((day) => day.date)).toEqual(
      days.map((day) => day.date),
    );
  });

  it("adds up the jobs of a day", () => {
    // 9:00-11:30 and 13:00-14:00 in New York on 3 Nov: 150 + 60 minutes.
    expect(
      minutes([
        job("2026-11-03T14:00:00.000Z", "2026-11-03T16:30:00.000Z"),
        job("2026-11-03T18:00:00.000Z", "2026-11-03T19:00:00.000Z"),
      ]),
    ).toEqual([0, 210, 0, 0, 0, 0, 0]);
  });

  it("splits a job that crosses midnight between the two days, by the business's midnight", () => {
    // 22:00 on 3 Nov to 02:00 on 4 Nov in New York: 120 minutes on each day.
    expect(minutes([job("2026-11-04T03:00:00.000Z", "2026-11-04T07:00:00.000Z")])).toEqual([
      0, 120, 120, 0, 0, 0, 0,
    ]);
  });

  it("counts a job that began earlier today in full for today, and ignores one outside the seven days", () => {
    expect(minutes([job("2026-11-02T13:00:00.000Z", "2026-11-02T14:30:00.000Z")])).toEqual([
      90, 0, 0, 0, 0, 0, 0,
    ]);
    // Day 8 and yesterday: not in the summary.
    expect(minutes([job("2026-11-09T15:00:00.000Z", "2026-11-09T17:00:00.000Z")])).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(minutes([job("2026-11-01T15:00:00.000Z", "2026-11-01T17:00:00.000Z")])).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("measures the day the clocks go back by its real 25 hours", () => {
    const autumn = assignmentWindow(at("2026-10-31T15:00:00.000Z"), NEW_YORK);
    // All of 1 Nov in New York: 04:00Z to 05:00Z the next day, 25 hours.
    const all = scheduledMinutesPerDay(
      [job("2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z")],
      autumn.days,
    );
    expect(all.find((day) => day.date === "2026-11-01")?.scheduledMinutes).toBe(25 * 60);
  });
});

describe("keptAssignmentsPhrase", () => {
  it("says what stays assigned, in the singular and the plural", () => {
    expect(keptAssignmentsPhrase(0)).toBe("no upcoming jobs are assigned");
    expect(keptAssignmentsPhrase(1)).toBe("1 upcoming job stays assigned");
    expect(keptAssignmentsPhrase(3)).toBe("3 upcoming jobs stay assigned");
  });
});

describe("pickCalendarColor", () => {
  it("offers the first colour of the palette to the first technician", () => {
    expect(pickCalendarColor([])).toBe(TECHNICIAN_COLORS[0]);
  });

  it("walks down the palette while each colour is used once", () => {
    expect(pickCalendarColor(["blue"])).toBe("green");
    expect(pickCalendarColor(["blue", "green"])).toBe("amber");
    // The order they were given in does not matter.
    expect(pickCalendarColor(["green", "blue"])).toBe("amber");
  });

  it("offers a colour nobody has before one somebody has", () => {
    expect(pickCalendarColor(["blue", "green", "amber", "purple", "rose", "teal", "orange"])).toBe(
      "slate",
    );
  });

  it("shares the palette as evenly as it can once every colour is taken", () => {
    const everyone = [...TECHNICIAN_COLORS];
    expect(pickCalendarColor(everyone)).toBe("blue");
    expect(pickCalendarColor([...everyone, "blue"])).toBe("green");
    expect(pickCalendarColor([...everyone, "blue", "blue", "green"])).toBe("amber");
  });

  it("ignores a stored value that is not on the palette", () => {
    expect(pickCalendarColor(["#ff0000", "chartreuse", ""])).toBe("blue");
  });
});

describe("tidySpecialties", () => {
  it("keeps the order and the first spelling, drops repeats ignoring case, and tidies spaces", () => {
    expect(
      tidySpecialties(["Heat pumps", "heat PUMPS", "  Diagnostics ", "Air   conditioning"]),
    ).toEqual(["Heat pumps", "Diagnostics", "Air conditioning"]);
  });

  it("drops blanks and leaves an empty list empty", () => {
    expect(tidySpecialties(["", "   "])).toEqual([]);
    expect(tidySpecialties([])).toEqual([]);
  });
});

describe("editing", () => {
  const current: TechnicianValues = {
    name: "Jordan Lee",
    phone: "(212) 555-0151",
    email: "jordan.lee@coolbreeze.test",
    specialties: ["Air conditioning", "Heat pumps"],
    notes: "Senior technician.",
    calendarColor: "blue",
  };

  it("keeps what a patch leaves out, and lets a patch clear a field with null", () => {
    expect(mergeTechnicianValues(current, {})).toEqual(current);
    expect(mergeTechnicianValues(current, { phone: null, notes: null, name: "J. Lee" })).toEqual({
      ...current,
      phone: null,
      notes: null,
      name: "J. Lee",
    });
    expect(mergeTechnicianValues(current, { specialties: [] }).specialties).toEqual([]);
  });

  it("lists the fields that differ, in a fixed order, and none when nothing does", () => {
    expect(changedTechnicianFields(current, current)).toEqual([]);
    expect(
      changedTechnicianFields(current, {
        ...current,
        calendarColor: "green",
        name: "Jordan Q. Lee",
        notes: null,
      }),
    ).toEqual(["name", "notes", "calendarColor"]);
  });

  it("compares the specialties as a list: a change of order or of one tag is a change", () => {
    expect(
      changedTechnicianFields(current, {
        ...current,
        specialties: ["Air conditioning", "Heat pumps"],
      }),
    ).toEqual([]);
    expect(
      changedTechnicianFields(current, {
        ...current,
        specialties: ["Heat pumps", "Air conditioning"],
      }),
    ).toEqual(["specialties"]);
    expect(
      changedTechnicianFields(current, { ...current, specialties: ["Air conditioning"] }),
    ).toEqual(["specialties"]);
  });

  it("offers edit always, and the one change of state that makes sense", () => {
    expect(availableActions(true)).toEqual(["EDIT", "DEACTIVATE"]);
    expect(availableActions(false)).toEqual(["EDIT", "ACTIVATE"]);
  });
});
