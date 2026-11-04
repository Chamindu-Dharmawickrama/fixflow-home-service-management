import { WorkOrderStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { at, BUSINESS_ZONE, JORDAN, SAM, visit } from "../test-fixtures";
import { weekDays } from "./dates";
import { visitAccessibleName, visitLook, visitTimeRange } from "./visit-text";
import {
  agendaDays,
  blocksByDay,
  businessDateOf,
  legendTechnicians,
  splitByTechnician,
} from "./visits";

const DAYS = weekDays("2026-03-04");
const dateOf = (instant: string) => businessDateOf(instant, BUSINESS_ZONE);

describe("blocksByDay", () => {
  it("gives every day of the week an entry, empty when nothing is on it", () => {
    const blocks = blocksByDay([], DAYS, BUSINESS_ZONE);
    expect([...blocks.keys()]).toEqual(DAYS);
    expect([...blocks.values()].every((day) => day.length === 0)).toBe(true);
  });

  it("puts a visit on its business day and orders each day by time", () => {
    const late = visit({ date: "2026-03-03", from: "14:00", to: "15:00" });
    const early = visit({ date: "2026-03-03", from: "08:00", to: "09:00" });
    const other = visit({ date: "2026-03-05" });
    const blocks = blocksByDay([late, other, early], DAYS, BUSINESS_ZONE);
    expect(blocks.get("2026-03-03")?.map((b) => b.visit.id)).toEqual([early.id, late.id]);
    expect(blocks.get("2026-03-05")?.map((b) => b.visit.id)).toEqual([other.id]);
  });

  it("splits a visit across midnight into a block on each day", () => {
    const night = visit({
      date: "2026-03-03",
      from: "23:00",
      to: "23:30",
      end: at("2026-03-04", "01:00"),
    });
    const blocks = blocksByDay([night], DAYS, BUSINESS_ZONE);
    expect(blocks.get("2026-03-03")?.[0]?.segment).toMatchObject({ startMin: 1380, endMin: 1440 });
    expect(blocks.get("2026-03-04")?.[0]?.segment).toMatchObject({ startMin: 0, endMin: 60 });
  });

  it("leaves out the part of a visit that falls on a day that is not on screen", () => {
    const sunday = visit({
      date: "2026-03-08",
      from: "23:00",
      to: "23:30",
      end: at("2026-03-09", "01:00"),
    });
    const blocks = blocksByDay([sunday], DAYS, BUSINESS_ZONE);
    expect(blocks.get("2026-03-08")).toHaveLength(1);
    expect(blocks.has("2026-03-09")).toBe(false);
  });

  it("keeps a visit on the right day across the change of the clocks", () => {
    const days = weekDays("2026-03-08");
    const evening = visit({ date: "2026-03-08", from: "21:00", to: "22:00" });
    const blocks = blocksByDay([evening], days, BUSINESS_ZONE);
    expect(blocks.get("2026-03-08")).toHaveLength(1);
    expect(blocks.get("2026-03-08")?.[0]?.segment.startMin).toBe(21 * 60);
  });
});

describe("agendaDays", () => {
  it("groups by start day, in order, and has no entry for an empty day", () => {
    const wed = visit({ date: "2026-03-04", from: "15:00", to: "16:00" });
    const tueLate = visit({ date: "2026-03-03", from: "14:00", to: "15:00" });
    const tueEarly = visit({ date: "2026-03-03", from: "09:00", to: "10:00" });
    const days = agendaDays([wed, tueLate, tueEarly], BUSINESS_ZONE);
    expect(days.map((day) => day.date)).toEqual(["2026-03-03", "2026-03-04"]);
    expect(days[0]?.visits.map((v) => v.id)).toEqual([tueEarly.id, tueLate.id]);
  });

  it("is empty for no visits", () => {
    expect(agendaDays([], BUSINESS_ZONE)).toEqual([]);
  });

  it("lists a visit that crosses midnight once, under the day it starts", () => {
    const night = visit({ date: "2026-03-03", from: "23:00", end: at("2026-03-04", "01:00") });
    expect(agendaDays([night], BUSINESS_ZONE).map((day) => day.date)).toEqual(["2026-03-03"]);
  });
});

describe("splitByTechnician", () => {
  it("makes a column for each technician with a visit, A to Z, and a last one for nobody", () => {
    const sam = visit({
      technician: { id: SAM.id, name: SAM.name, calendarColor: "green" },
      date: "2026-03-03",
    });
    const jordan = visit({ date: "2026-03-03", from: "13:00", to: "14:00" });
    const nobody = visit({ technician: null, date: "2026-03-03", from: "15:00", to: "16:00" });
    const blocks = blocksByDay([sam, nobody, jordan], DAYS, BUSINESS_ZONE).get("2026-03-03") ?? [];
    const columns = splitByTechnician(blocks);
    expect(columns.map((column) => column.name)).toEqual([
      "Jordan Lee",
      "Sam Ortiz",
      "No technician",
    ]);
    expect(columns[2]?.technicianId).toBeNull();
    expect(columns[0]?.blocks).toHaveLength(1);
  });
});

describe("legendTechnicians", () => {
  const technicians = [
    { id: SAM.id, name: "Sam Ortiz", calendarColor: "green" as const, isActive: true },
    { id: JORDAN.id, name: "Jordan Lee", calendarColor: "blue" as const, isActive: true },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Rae Retired",
      calendarColor: "amber" as const,
      isActive: false,
    },
  ];

  it("names the active technicians A to Z", () => {
    expect(legendTechnicians(technicians, []).map((t) => t.name)).toEqual([
      "Jordan Lee",
      "Sam Ortiz",
    ]);
  });

  it("adds an inactive technician whose visit is on screen, so their colour is explained", () => {
    const retired = visit({
      technician: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Rae Retired",
        calendarColor: "amber",
      },
    });
    expect(legendTechnicians(technicians, [retired]).map((t) => t.name)).toEqual([
      "Jordan Lee",
      "Rae Retired",
      "Sam Ortiz",
    ]);
  });
});

describe("visitAccessibleName", () => {
  it("says when, which job, what, for whom, who goes and the status", () => {
    const v = visit({ reference: "JOB-2026-00031" });
    expect(visitAccessibleName(v, BUSINESS_ZONE, dateOf)).toBe(
      "Tuesday 10:00 AM – 12:00 PM JOB-2026-00031 AC Routine Maintenance Alex Morgan, assigned to Jordan Lee, Scheduled",
    );
  });

  it("says the weekday of the business day, not of the UTC day", () => {
    const evening = visit({ date: "2026-03-03", from: "21:00", to: "22:00" });
    expect(evening.start.startsWith("2026-03-04")).toBe(true);
    expect(
      visitAccessibleName(evening, BUSINESS_ZONE, dateOf).startsWith("Tuesday 9:00 – 10:00 PM"),
    ).toBe(true);
  });

  it("gives both days when the visit runs past midnight", () => {
    const night = visit({ date: "2026-03-03", from: "23:00", end: at("2026-03-04", "01:00") });
    expect(visitAccessibleName(night, BUSINESS_ZONE, dateOf)).toContain(
      "Tuesday Mar 3, 11:00 PM – Mar 4, 1:00 AM JOB-",
    );
  });

  it("contains the text a block shows, whole and in order (WCAG 2.5.3, Label in Name)", () => {
    // A block shows: the time range, the reference, the service and the customer.
    for (const v of [
      visit(),
      visit({ date: "2026-03-05", from: "13:00", to: "14:30", customerName: "Priya Shah" }),
      visit({ technician: null, status: WorkOrderStatus.COMPLETED, statusLabel: "Completed" }),
      visit({ date: "2026-03-03", from: "23:00", end: at("2026-03-04", "01:00") }),
    ]) {
      const shown = [visitTimeRange(v, BUSINESS_ZONE), v.reference, v.serviceName, v.customerName];
      expect(visitAccessibleName(v, BUSINESS_ZONE, dateOf)).toContain(shown.join(" "));
    }
  });

  it("says so when nobody is assigned, and always says the status", () => {
    const v = visit({
      technician: null,
      status: WorkOrderStatus.COMPLETED,
      statusLabel: "Completed",
    });
    const name = visitAccessibleName(v, BUSINESS_ZONE, dateOf);
    expect(name).toContain("no technician assigned");
    expect(name.endsWith(", Completed")).toBe(true);
  });
});

describe("visit text and look", () => {
  it("writes the time range on the business's clocks", () => {
    expect(visitTimeRange(visit(), BUSINESS_ZONE)).toBe("10:00 AM – 12:00 PM");
    expect(visitTimeRange(visit({ from: "13:00", to: "14:30" }), BUSINESS_ZONE)).toBe(
      "1:00 – 2:30 PM",
    );
  });

  it("marks cancelled and waiting visits by more than colour", () => {
    expect(visitLook(WorkOrderStatus.SCHEDULED)).toMatchObject({ dashed: false, struck: false });
    expect(visitLook(WorkOrderStatus.CANCELLED)).toMatchObject({ dashed: true, struck: true });
    expect(visitLook(WorkOrderStatus.NEEDS_RESCHEDULING)).toMatchObject({
      dashed: true,
      struck: false,
    });
  });

  it("gives each status the icon its badge has, so a block and a badge agree", () => {
    const icons = new Set(
      [
        WorkOrderStatus.SCHEDULED,
        WorkOrderStatus.IN_PROGRESS,
        WorkOrderStatus.COMPLETED,
        WorkOrderStatus.CANCELLED,
        WorkOrderStatus.NEEDS_RESCHEDULING,
      ].map((status) => visitLook(status).icon),
    );
    expect(icons.size).toBe(5);
  });
});
