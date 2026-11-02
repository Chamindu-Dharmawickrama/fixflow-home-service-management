import { isTechnicianColor } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { createTechnicianBodySchema } from "../modules/technicians/technicians.schemas.js";
import { DEMO_TECHNICIANS } from "./seed-data.js";

describe("the demo technicians", () => {
  it("are colour-coded with keys from the shared calendar palette, each a different one (F-12)", () => {
    const colors = DEMO_TECHNICIANS.map((technician) => technician.calendarColor);
    for (const color of colors) {
      expect(isTechnicianColor(color), color).toBe(true);
    }
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("would be accepted by the API as they are seeded: the same name, contact and tag rules", () => {
    for (const { name, phone, email, specialties, notes, calendarColor } of DEMO_TECHNICIANS) {
      const result = createTechnicianBodySchema.safeParse({
        name,
        phone,
        email,
        specialties,
        notes,
        calendarColor,
      });
      expect(result.success, name).toBe(true);
      // Nothing was tidied away: what the seed holds is already in its stored form.
      expect(result.data, name).toEqual({ name, phone, email, specialties, notes, calendarColor });
    }
  });
});
