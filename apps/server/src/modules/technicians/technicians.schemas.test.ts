import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  adminTechniciansQuerySchema,
  createTechnicianBodySchema,
  technicianIdParamsSchema,
  updateTechnicianBodySchema,
} from "./technicians.schemas.js";

function errorsOf(schema: z.ZodType, input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

describe("createTechnicianBodySchema", () => {
  it("needs only a name, and fills the rest with nothing", () => {
    expect(createTechnicianBodySchema.parse({ name: "Jordan Lee" })).toEqual({
      name: "Jordan Lee",
      phone: null,
      email: null,
      specialties: [],
      notes: null,
    });
  });

  it("trims and tidies every field it keeps", () => {
    expect(
      createTechnicianBodySchema.parse({
        name: "  Jordan Lee ",
        phone: "  (212)   555-0151 ",
        email: "  Jordan.Lee@CoolBreeze.test ",
        specialties: [" Heat pumps ", "heat PUMPS", "Air   conditioning"],
        notes: "  Takes the early visits.  ",
        calendarColor: "teal",
      }),
    ).toEqual({
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Heat pumps", "Air conditioning"],
      notes: "Takes the early visits.",
      calendarColor: "teal",
    });
  });

  it("turns a blank phone, email and notes into nothing", () => {
    expect(
      createTechnicianBodySchema.parse({ name: "Jordan Lee", phone: "  ", email: "", notes: " " }),
    ).toMatchObject({ phone: null, email: null, notes: null });
  });

  describe("name: 2 to 100 characters on one line", () => {
    it.each([
      ["", "The name must be at least 2 characters."],
      ["J", "The name must be at least 2 characters."],
      ["   ", "The name must be at least 2 characters."],
      ["x".repeat(101), "The name must be 100 characters or fewer."],
      ["Jordan\nLee", "The name must be on a single line."],
    ])("rejects %j", (name, message) => {
      expect(errorsOf(createTechnicianBodySchema, { name })).toEqual({ name: message });
    });

    it("accepts the shortest and the longest", () => {
      expect(createTechnicianBodySchema.safeParse({ name: "Jo" }).success).toBe(true);
      expect(createTechnicianBodySchema.safeParse({ name: "x".repeat(100) }).success).toBe(true);
    });

    it("is required", () => {
      expect(errorsOf(createTechnicianBodySchema, {})).toEqual({ name: "Enter the name." });
    });
  });

  describe("phone", () => {
    it.each(["(212) 555-0151", "+44 20 7946 0958", "2125550151"])("accepts %j", (phone) => {
      expect(createTechnicianBodySchema.safeParse({ name: "Jordan Lee", phone }).success).toBe(
        true,
      );
    });

    it.each(["call me", "12345", "555-ABCD-1234", "+1 (212) 555-0151 ext 4", "1".repeat(21)])(
      "rejects %j with advice on what to enter",
      (phone) => {
        expect(errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", phone }).phone).toMatch(
          /^Enter a phone number with 7 to 15 digits/,
        );
      },
    );
  });

  describe("email", () => {
    it.each(["jordan@coolbreeze.test", "j.lee+jobs@mail.coolbreeze.test"])(
      "accepts %j",
      (email) => {
        expect(createTechnicianBodySchema.safeParse({ name: "Jordan Lee", email }).success).toBe(
          true,
        );
      },
    );

    it.each(["jordan", "jordan@", "@coolbreeze.test", "jordan lee@coolbreeze.test", "a@b"])(
      "rejects %j",
      (email) => {
        expect(errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", email })).toEqual({
          email: "Enter a valid email address, like name@example.com.",
        });
      },
    );

    it("refuses an address longer than any can be", () => {
      expect(
        errorsOf(createTechnicianBodySchema, {
          name: "Jordan Lee",
          email: `${"a".repeat(250)}@x.test`,
        }),
      ).toEqual({ email: "The email address is too long." });
    });
  });

  describe("specialties: up to 8 tags of at most 40 characters", () => {
    it("accepts eight and refuses nine", () => {
      const tags = Array.from({ length: 9 }, (_, index) => `Tag ${String(index + 1)}`);
      expect(
        createTechnicianBodySchema.safeParse({ name: "Jordan Lee", specialties: tags.slice(0, 8) })
          .success,
      ).toBe(true);
      expect(
        errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", specialties: tags }),
      ).toEqual({ specialties: "Add no more than 8 specialties." });
    });

    it("accepts a tag of 40 characters and refuses one of 41, naming which tag", () => {
      expect(
        createTechnicianBodySchema.safeParse({ name: "Jordan Lee", specialties: ["x".repeat(40)] })
          .success,
      ).toBe(true);
      expect(
        errorsOf(createTechnicianBodySchema, {
          name: "Jordan Lee",
          specialties: ["ok", "x".repeat(41)],
        }),
      ).toEqual({ "specialties.1": "The specialty must be 40 characters or fewer." });
    });

    it("refuses a blank tag and anything that is not a list of text", () => {
      expect(
        errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", specialties: [" "] }),
      ).toEqual({ "specialties.0": "Enter the specialty." });
      expect(
        errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", specialties: "Heat" }),
      ).toEqual({ specialties: "Enter the specialties as a list." });
      expect(
        errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", specialties: [3] }),
      ).toHaveProperty("specialties.0");
    });
  });

  describe("notes: up to 1000 characters, internal", () => {
    it("accepts 1000 characters over several lines and refuses 1001", () => {
      expect(
        createTechnicianBodySchema.safeParse({ name: "Jordan Lee", notes: `a\n${"b".repeat(998)}` })
          .success,
      ).toBe(true);
      expect(
        errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", notes: "x".repeat(1001) }),
      ).toEqual({ notes: "The notes must be 1000 characters or fewer." });
    });
  });

  describe("calendarColor: a key from the palette", () => {
    it.each(["#1d4f91", "red", "BLUE", "cal-blue", ""])("rejects %j", (calendarColor) => {
      expect(errorsOf(createTechnicianBodySchema, { name: "Jordan Lee", calendarColor })).toEqual({
        calendarColor: "Choose one of the available colours.",
      });
    });

    it("may be left out, for the server to choose", () => {
      expect(createTechnicianBodySchema.parse({ name: "Jordan Lee" })).not.toHaveProperty(
        "calendarColor",
      );
    });
  });

  it("rejects what a caller must not send: the active flag, the id, timestamps and unknown keys", () => {
    for (const extra of [
      { isActive: false },
      { id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" },
      { createdAt: "2026-11-02T00:00:00.000Z" },
      { role: "BUSINESS_ADMIN" },
    ]) {
      expect(createTechnicianBodySchema.safeParse({ name: "Jordan Lee", ...extra }).success).toBe(
        false,
      );
    }
  });
});

describe("updateTechnicianBodySchema", () => {
  it("accepts any one field", () => {
    for (const body of [
      { name: "Jordan Q. Lee" },
      { phone: null },
      { email: "j@coolbreeze.test" },
      { specialties: [] },
      { notes: "" },
      { calendarColor: "rose" },
    ]) {
      expect(updateTechnicianBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it("clears a field with null or blank text, and leaves out a field that was not sent", () => {
    expect(updateTechnicianBodySchema.parse({ phone: "  ", notes: null })).toEqual({
      phone: null,
      notes: null,
    });
  });

  it("refuses an empty change, and a body that only holds undefined", () => {
    expect(errorsOf(updateTechnicianBodySchema, {})).toEqual({
      _: "Send at least one field to change.",
    });
  });

  it("applies the same limits as creating", () => {
    expect(errorsOf(updateTechnicianBodySchema, { name: "J" })).toEqual({
      name: "The name must be at least 2 characters.",
    });
    expect(errorsOf(updateTechnicianBodySchema, { calendarColor: "red" })).toEqual({
      calendarColor: "Choose one of the available colours.",
    });
  });

  it("refuses the active flag: that is what activate and deactivate are for", () => {
    expect(updateTechnicianBodySchema.safeParse({ isActive: false }).success).toBe(false);
    expect(
      updateTechnicianBodySchema.safeParse({ name: "Jordan Lee", isActive: true }).success,
    ).toBe(false);
  });
});

describe("technicianIdParamsSchema", () => {
  it("accepts a UUID and nothing else", () => {
    expect(
      technicianIdParamsSchema.safeParse({ id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }).success,
    ).toBe(true);
    for (const id of ["assignable", "1", "", "0b6c1e0e-6f1a-4b0e-9f1d"]) {
      expect(errorsOf(technicianIdParamsSchema, { id }), id).toEqual({
        id: "The technician id must be a valid id.",
      });
    }
  });
});

describe("adminTechniciansQuerySchema", () => {
  it("defaults to the first page, A to Z, with no filter and no search", () => {
    expect(adminTechniciansQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "name",
      order: "asc",
    });
  });

  it("takes the active filter as true, false or all", () => {
    for (const active of ["true", "false", "all"]) {
      expect(adminTechniciansQuerySchema.parse({ active }).active).toBe(active);
    }
    expect(errorsOf(adminTechniciansQuerySchema, { active: "yes" })).toEqual({
      active: "active must be one of: true, false, all.",
    });
    expect(errorsOf(adminTechniciansQuerySchema, { active: "TRUE" })).toHaveProperty("active");
  });

  it("trims the search, folds runs of spaces and reads blank as no search", () => {
    expect(adminTechniciansQuerySchema.parse({ q: "  jordan   lee " }).q).toBe("jordan lee");
    expect(adminTechniciansQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(adminTechniciansQuerySchema.parse({ q: "x".repeat(100) }).q).toHaveLength(100);
    expect(errorsOf(adminTechniciansQuerySchema, { q: "x".repeat(101) })).toEqual({
      q: "q must be 100 characters or fewer.",
    });
  });

  it("sorts by name only, and keeps the standard page-size limit", () => {
    expect(errorsOf(adminTechniciansQuerySchema, { sort: "phone" })).toEqual({
      sort: "sort must be one of: name.",
    });
    expect(adminTechniciansQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true);
    expect(adminTechniciansQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });
});
