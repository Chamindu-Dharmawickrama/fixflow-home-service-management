import { describe, expect, it } from "vitest";

import type { Technician } from "../../generated/prisma/client.js";
import {
  type AssignmentRow,
  colorOf,
  toAdminTechnicianDto,
  toAssignableTechnicianDto,
  toTechnicianListItem,
} from "./technicians.dto.js";

const row: Technician = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  name: "Jordan Lee",
  phone: "(212) 555-0151",
  email: "jordan.lee@coolbreeze.test",
  specialties: ["Air conditioning", "Heat pumps"],
  notes: "Senior technician. Takes the early visits.",
  calendarColor: "blue",
  isActive: true,
  createdAt: new Date("2026-10-28T12:00:00.000Z"),
  updatedAt: new Date("2026-11-01T09:30:00.000Z"),
};

const JOB_ID = "b4a1f5c2-3d6e-4c7a-9b8d-2e1f0a9b8c7d";

const assignment = (overrides: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: JOB_ID,
  reference: "JOB-2026-00007",
  serviceNameSnapshot: "AC Diagnostic Visit",
  status: "SCHEDULED",
  scheduledStart: new Date("2026-11-03T14:00:00.000Z"),
  scheduledEnd: new Date("2026-11-03T16:00:00.000Z"),
  customerName: "Alex Morgan",
  ...overrides,
});

describe("toTechnicianListItem", () => {
  it("has exactly the fields the list shows, and no internal notes", () => {
    const item = toTechnicianListItem(row, { count: 0, next: null });
    expect(Object.keys(item).sort()).toEqual([
      "availableActions",
      "calendarColor",
      "email",
      "id",
      "isActive",
      "name",
      "nextJob",
      "phone",
      "specialties",
      "upcomingJobCount",
    ]);
    expect(JSON.stringify(item)).not.toContain("Takes the early visits");
  });

  it("carries the count and the next job, with its start as an ISO instant", () => {
    expect(
      toTechnicianListItem(row, {
        count: 3,
        next: {
          id: JOB_ID,
          reference: "JOB-2026-00007",
          scheduledStart: new Date("2026-11-03T14:00:00.000Z"),
        },
      }),
    ).toMatchObject({
      upcomingJobCount: 3,
      nextJob: {
        id: JOB_ID,
        reference: "JOB-2026-00007",
        scheduledStart: "2026-11-03T14:00:00.000Z",
      },
    });
    expect(toTechnicianListItem(row, { count: 0, next: null }).nextJob).toBeNull();
  });

  it("lists the actions that fit the state", () => {
    expect(toTechnicianListItem(row, { count: 0, next: null }).availableActions).toEqual([
      "EDIT",
      "DEACTIVATE",
    ]);
    expect(
      toTechnicianListItem({ ...row, isActive: false }, { count: 0, next: null }).availableActions,
    ).toEqual(["EDIT", "ACTIVATE"]);
  });

  it("copies the specialties, so the row is not shared", () => {
    const item = toTechnicianListItem(row, { count: 0, next: null });
    expect(item.specialties).toEqual(row.specialties);
    expect(item.specialties).not.toBe(row.specialties);
  });
});

describe("toAdminTechnicianDto", () => {
  it("adds the notes, the timestamps, the assignments and the availability to the list item", () => {
    const availability = [{ date: "2026-11-02", scheduledMinutes: 0 }];
    const dto = toAdminTechnicianDto(row, [assignment()], availability);
    expect(Object.keys(dto).sort()).toEqual([
      "availability",
      "availableActions",
      "calendarColor",
      "createdAt",
      "email",
      "id",
      "isActive",
      "name",
      "nextJob",
      "notes",
      "phone",
      "specialties",
      "upcomingAssignments",
      "upcomingJobCount",
      "updatedAt",
    ]);
    expect(dto.notes).toBe("Senior technician. Takes the early visits.");
    expect(dto.createdAt).toBe("2026-10-28T12:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-11-01T09:30:00.000Z");
    expect(dto.availability).toBe(availability);
  });

  it("derives the count and the next job from the assignments it is given", () => {
    const first = assignment({ reference: "JOB-2026-00007" });
    const second = assignment({
      reference: "JOB-2026-00009",
      scheduledStart: new Date("2026-11-05T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-05T15:00:00.000Z"),
    });
    const dto = toAdminTechnicianDto(row, [first, second], []);
    expect(dto.upcomingJobCount).toBe(2);
    expect(dto.nextJob).toEqual({
      id: JOB_ID,
      reference: "JOB-2026-00007",
      scheduledStart: "2026-11-03T14:00:00.000Z",
    });
    expect(dto.upcomingAssignments.map((job) => job.reference)).toEqual([
      "JOB-2026-00007",
      "JOB-2026-00009",
    ]);
  });

  it("has no next job and no assignments for a technician with nothing coming up", () => {
    const dto = toAdminTechnicianDto(row, [], []);
    expect(dto.upcomingJobCount).toBe(0);
    expect(dto.nextJob).toBeNull();
    expect(dto.upcomingAssignments).toEqual([]);
  });

  it("shows an assignment as id, reference, customer, service, start, end and status only", () => {
    const [shown] = toAdminTechnicianDto(row, [assignment()], []).upcomingAssignments;
    expect(shown).toEqual({
      // The id is for the job's page (T17); the reference is a label.
      id: JOB_ID,
      reference: "JOB-2026-00007",
      customerName: "Alex Morgan",
      serviceName: "AC Diagnostic Visit",
      scheduledStart: "2026-11-03T14:00:00.000Z",
      scheduledEnd: "2026-11-03T16:00:00.000Z",
      status: "SCHEDULED",
    });
  });
});

describe("toAssignableTechnicianDto", () => {
  it("is just enough to choose someone: no contact details, no notes", () => {
    const dto = toAssignableTechnicianDto(row);
    expect(dto).toEqual({
      id: row.id,
      name: "Jordan Lee",
      specialties: ["Air conditioning", "Heat pumps"],
      calendarColor: "blue",
    });
  });
});

describe("colorOf", () => {
  it("returns a palette key unchanged and shows anything else as the first colour", () => {
    expect(colorOf("teal")).toBe("teal");
    expect(colorOf("#ff00ff")).toBe("blue");
    expect(colorOf("")).toBe("blue");
  });
});
