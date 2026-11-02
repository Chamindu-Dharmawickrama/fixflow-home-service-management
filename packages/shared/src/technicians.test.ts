import { describe, expect, it } from "vitest";

import { technicianState } from "./derived-status.js";
import * as shared from "./index.js";
import { LIMITS } from "./limits.js";
import {
  ADMIN_TECHNICIAN_SORT_FIELDS,
  isTechnicianColor,
  TECHNICIAN_ACTIVE_FILTERS,
  TECHNICIAN_AVAILABILITY_DAYS,
  TECHNICIAN_COLORS,
  TECHNICIAN_UPCOMING_DAYS,
  TechnicianAction,
} from "./technicians.js";

describe("the technician calendar palette", () => {
  it("is offered from the package entry point", () => {
    expect(shared.TECHNICIAN_COLORS).toBe(TECHNICIAN_COLORS);
    expect(shared.isTechnicianColor).toBe(isTechnicianColor);
  });

  it("has no repeated key, and every key is a plain lower-case word (it names a design token)", () => {
    expect(new Set(TECHNICIAN_COLORS).size).toBe(TECHNICIAN_COLORS.length);
    for (const color of TECHNICIAN_COLORS) {
      expect(color).toMatch(/^[a-z]+$/);
    }
  });

  it("keeps the three keys the demo technicians were seeded with", () => {
    expect(TECHNICIAN_COLORS).toEqual(expect.arrayContaining(["blue", "green", "amber"]));
  });

  it("accepts a key and nothing else: not a colour value, a token name or another type", () => {
    for (const color of TECHNICIAN_COLORS) {
      expect(isTechnicianColor(color)).toBe(true);
    }
    for (const value of ["", "Blue", "#1d4f91", "cal-blue", "red", " blue", "blue ", null, 3]) {
      expect(isTechnicianColor(value), String(value)).toBe(false);
    }
  });
});

describe("technician constants", () => {
  it("looks 14 days ahead for assignments and 7 for the availability summary (FR-062)", () => {
    expect(TECHNICIAN_UPCOMING_DAYS).toBe(14);
    expect(TECHNICIAN_AVAILABILITY_DAYS).toBe(7);
    expect(TECHNICIAN_AVAILABILITY_DAYS).toBeLessThanOrEqual(TECHNICIAN_UPCOMING_DAYS);
  });

  it("names the actions and the filters", () => {
    expect(Object.values(TechnicianAction)).toEqual(["EDIT", "DEACTIVATE", "ACTIVATE"]);
    expect(TECHNICIAN_ACTIVE_FILTERS).toEqual(["true", "false", "all"]);
    expect(ADMIN_TECHNICIAN_SORT_FIELDS).toEqual(["name"]);
  });

  it("limits the tags, the notes and the search (the prompt's numbers)", () => {
    expect(LIMITS.technician.specialties).toEqual({ maxItems: 8, itemMaxLength: 40 });
    expect(LIMITS.technician.notes.maxLength).toBe(1000);
    expect(LIMITS.technician.search.maxLength).toBe(100);
    // The name follows a person's name: 2 to 100 characters.
    expect(LIMITS.personName).toEqual({ minLength: 2, maxLength: 100 });
  });
});

describe("technicianState", () => {
  it("says whether a technician can be given new jobs", () => {
    expect(technicianState({ isActive: true })).toBe("ACTIVE");
    expect(technicianState({ isActive: false })).toBe("INACTIVE");
  });

  it("is offered from the package entry point", () => {
    expect(shared.technicianState).toBe(technicianState);
    expect(shared.TechnicianState).toEqual({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE" });
  });
});
