import type { AdminTechnicianDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  addSpecialties,
  emptyTechnicianValues,
  formFieldForApiError,
  TECHNICIAN_FIELD_LABELS,
  technicianFormSchema,
  type TechnicianFormValues,
  technicianToFormValues,
  toTechnicianBody,
} from "./technician-form";

const VALID: TechnicianFormValues = {
  name: "Jordan Lee",
  phone: "(212) 555-0151",
  email: "jordan.lee@coolbreeze.test",
  specialties: ["Air conditioning", "Heat pumps"],
  specialtyDraft: "",
  notes: "Senior technician.",
  calendarColor: "blue",
};

function messagesFor(values: Partial<TechnicianFormValues>): Record<string, string> {
  const result = technicianFormSchema.safeParse({ ...VALID, ...values });
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("technicianFormSchema", () => {
  it("accepts a full technician and a bare one", () => {
    expect(technicianFormSchema.safeParse(VALID).success).toBe(true);
    expect(technicianFormSchema.safeParse(emptyTechnicianValues("teal")).success).toBe(false);
    expect(
      technicianFormSchema.safeParse({ ...emptyTechnicianValues("teal"), name: "Jo" }).success,
    ).toBe(true);
  });

  it.each([
    ["", "Enter the name."],
    ["   ", "Enter the name."],
    ["J", "The name must be at least 2 characters."],
    ["x".repeat(101), "The name must be 100 characters or fewer."],
  ])("refuses the name %j", (name, message) => {
    expect(messagesFor({ name })).toEqual({ name: message });
  });

  it("checks the phone number like the API does, and allows none", () => {
    expect(messagesFor({ phone: "" })).toEqual({});
    expect(messagesFor({ phone: "   " })).toEqual({});
    expect(messagesFor({ phone: "+44 20 7946 0958" })).toEqual({});
    expect(messagesFor({ phone: "12345" }).phone).toMatch(
      /^Enter a phone number with 7 to 15 digits/,
    );
    expect(messagesFor({ phone: "call me" }).phone).toMatch(/^Enter a phone number/);
  });

  it("checks the email address, and allows none", () => {
    expect(messagesFor({ email: "" })).toEqual({});
    expect(messagesFor({ email: "jordan@coolbreeze.test" })).toEqual({});
    expect(messagesFor({ email: "jordan@" })).toEqual({
      email: "Enter a valid email address, like name@example.com.",
    });
  });

  it("allows eight specialties and no more, each up to 40 characters", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `Tag ${String(i)}`);
    expect(messagesFor({ specialties: eight })).toEqual({});
    expect(messagesFor({ specialties: [...eight, "Tag 8"] })).toEqual({
      specialties: "Add no more than 8 specialties.",
    });
    expect(messagesFor({ specialties: ["x".repeat(41)] })).toEqual({
      "specialties.0": "A specialty must be 40 characters or fewer.",
    });
  });

  it("allows 1000 characters of notes and not 1001", () => {
    expect(messagesFor({ notes: "n".repeat(1000) })).toEqual({});
    expect(messagesFor({ notes: "n".repeat(1001) })).toEqual({
      notes: "The notes must be 1000 characters or fewer.",
    });
  });

  it("insists on a colour from the palette", () => {
    expect(messagesFor({ calendarColor: "chartreuse" as never }).calendarColor).toBe(
      "Choose a colour.",
    );
  });

  it("has a label for every field the error summary can name", () => {
    for (const field of ["name", "phone", "email", "specialties", "notes", "calendarColor"]) {
      expect(TECHNICIAN_FIELD_LABELS[field], field).toBeTruthy();
    }
  });
});

describe("toTechnicianBody", () => {
  it("trims, tidies the phone number, lower-cases the email and sends blanks as null", () => {
    expect(
      toTechnicianBody({
        name: "  Jordan Lee ",
        phone: "  (212)   555-0151 ",
        email: " Jordan.Lee@CoolBreeze.test ",
        specialties: [" Heat pumps ", "  ", "Dryers"],
        specialtyDraft: "ignored here",
        notes: "  Takes the early visits.  ",
        calendarColor: "green",
      }),
    ).toEqual({
      name: "Jordan Lee",
      phone: "(212) 555-0151",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Heat pumps", "Dryers"],
      notes: "Takes the early visits.",
      calendarColor: "green",
    });
    expect(toTechnicianBody({ ...VALID, phone: " ", email: "", notes: "\n " })).toMatchObject({
      phone: null,
      email: null,
      notes: null,
    });
  });

  it("never sends the draft of the specialties box", () => {
    expect(toTechnicianBody({ ...VALID, specialtyDraft: "Half-typed" })).not.toHaveProperty(
      "specialtyDraft",
    );
  });
});

describe("technicianToFormValues", () => {
  const technician = {
    name: "Jordan Lee",
    phone: null,
    email: "jordan.lee@coolbreeze.test",
    specialties: ["Heat pumps"],
    notes: null,
    calendarColor: "rose",
  } as AdminTechnicianDto;

  it("shows a missing phone number and notes as empty boxes, and starts with an empty draft", () => {
    expect(technicianToFormValues(technician)).toEqual({
      name: "Jordan Lee",
      phone: "",
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Heat pumps"],
      specialtyDraft: "",
      notes: "",
      calendarColor: "rose",
    });
  });

  it("round-trips: a form opened and saved untouched sends what was stored", () => {
    expect(toTechnicianBody(technicianToFormValues(technician))).toEqual({
      name: "Jordan Lee",
      phone: null,
      email: "jordan.lee@coolbreeze.test",
      specialties: ["Heat pumps"],
      notes: null,
      calendarColor: "rose",
    });
  });

  it("copies the specialties, so editing the form cannot change the record it came from", () => {
    const values = technicianToFormValues(technician);
    expect(values.specialties).not.toBe(technician.specialties);
  });
});

describe("emptyTechnicianValues", () => {
  it("offers the colour it is given and nothing else filled in", () => {
    expect(emptyTechnicianValues("purple")).toEqual({
      name: "",
      phone: "",
      email: "",
      specialties: [],
      specialtyDraft: "",
      notes: "",
      calendarColor: "purple",
    });
  });
});

describe("formFieldForApiError", () => {
  it("puts an error about one tag on the specialties", () => {
    expect(formFieldForApiError("specialties.3")).toBe("specialties");
    expect(formFieldForApiError("specialties")).toBe("specialties");
    expect(formFieldForApiError("name")).toBe("name");
    expect(formFieldForApiError("_")).toBe("_");
  });
});

describe("addSpecialties", () => {
  it("adds a tag, tidying the spaces inside it", () => {
    expect(addSpecialties(["Dryers"], "  Heat    pumps ")).toEqual({
      tags: ["Dryers", "Heat pumps"],
      problem: null,
      rest: "",
    });
  });

  it("adds several at once, separated by commas or new lines", () => {
    expect(addSpecialties([], "Heat pumps, Dryers\nDiagnostics,, ")).toEqual({
      tags: ["Heat pumps", "Dryers", "Diagnostics"],
      problem: null,
      rest: "",
    });
  });

  it("adds nothing for blank text", () => {
    expect(addSpecialties(["Dryers"], "   ")).toEqual({
      tags: ["Dryers"],
      problem: null,
      rest: "",
    });
    expect(addSpecialties([], " , ,")).toEqual({ tags: [], problem: null, rest: "" });
  });

  it("does not add a tag twice, ignoring case, and says so", () => {
    expect(addSpecialties(["Heat pumps"], "heat PUMPS")).toEqual({
      tags: ["Heat pumps"],
      problem: "“heat PUMPS” is already in the list.",
      rest: "heat PUMPS",
    });
    // The same tag twice in one paste counts once.
    expect(addSpecialties([], "Dryers, dryers").tags).toEqual(["Dryers"]);
  });

  it("refuses a tag over 40 characters and keeps it in the box to be shortened", () => {
    const long = "x".repeat(41);
    expect(addSpecialties([], long)).toEqual({
      tags: [],
      problem: "A specialty can be up to 40 characters.",
      rest: long,
    });
    expect(addSpecialties([], "x".repeat(40)).tags).toHaveLength(1);
  });

  it("stops at eight tags, adds those that fit and keeps the rest in the box", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `Tag ${String(i)}`);
    expect(addSpecialties(seven, "One more, And another, And a third")).toEqual({
      tags: [...seven, "One more"],
      problem: "You can add up to 8 specialties.",
      rest: "And another, And a third",
    });
  });

  it("adds what it can when only one tag in a paste is a problem", () => {
    expect(addSpecialties([], `Dryers, ${"y".repeat(50)}, Diagnostics`)).toEqual({
      tags: ["Dryers", "Diagnostics"],
      problem: "A specialty can be up to 40 characters.",
      rest: "y".repeat(50),
    });
  });

  it("does not change the list it was given", () => {
    const current = ["Dryers"];
    addSpecialties(current, "Heat pumps");
    expect(current).toEqual(["Dryers"]);
  });
});
