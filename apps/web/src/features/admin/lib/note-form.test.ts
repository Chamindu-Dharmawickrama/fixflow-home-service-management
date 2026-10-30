import { LIMITS, NoteVisibility } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { EMPTY_NOTE, noteFormSchema, toNoteBody } from "./note-form";

function messages(values: Record<string, unknown>): Record<string, string> {
  const result = noteFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe("noteFormSchema", () => {
  it("accepts a note for the team and a note for the customer", () => {
    expect(
      noteFormSchema.safeParse({ body: "Left a voicemail.", visibility: "INTERNAL" }).success,
    ).toBe(true);
    expect(
      noteFormSchema.safeParse({ body: "We will call you.", visibility: "CUSTOMER_VISIBLE" })
        .success,
    ).toBe(true);
  });

  it.each(["", "   ", "\n\t "])("asks for text when the note is %j", (body) => {
    expect(messages({ body, visibility: "INTERNAL" }).body).toBe(
      "Write the note before adding it.",
    );
  });

  it("accepts a note of exactly the longest length and refuses one character more", () => {
    const max = LIMITS.notes.maxLength;
    expect(messages({ body: "x".repeat(max), visibility: "INTERNAL" })).toEqual({});
    expect(messages({ body: "x".repeat(max + 1), visibility: "INTERNAL" }).body).toBe(
      `A note must be ${max} characters or fewer.`,
    );
  });

  it("does not count spaces around the note towards the length", () => {
    const max = LIMITS.notes.maxLength;
    expect(messages({ body: `  ${"x".repeat(max)}  `, visibility: "INTERNAL" })).toEqual({});
  });

  it("makes the person choose who sees the note", () => {
    expect(messages({ body: "Hello", visibility: "" }).visibility).toBe(
      "Choose who can see the note: your team only, or the customer too.",
    );
    expect(messages({ body: "Hello" }).visibility).toBe(
      "Choose who can see the note: your team only, or the customer too.",
    );
    expect(messages({ body: "Hello", visibility: "PUBLIC" }).visibility).toBeDefined();
  });
});

describe("EMPTY_NOTE", () => {
  it("starts internal, so sharing with the customer is always a choice", () => {
    expect(EMPTY_NOTE).toEqual({ body: "", visibility: NoteVisibility.INTERNAL });
  });
});

describe("toNoteBody", () => {
  it("trims the text and keeps the chosen visibility", () => {
    expect(toNoteBody({ body: "  Gate code is 4821.\n", visibility: "CUSTOMER_VISIBLE" })).toEqual({
      body: "Gate code is 4821.",
      visibility: "CUSTOMER_VISIBLE",
    });
  });

  it("keeps line breaks inside the note", () => {
    expect(toNoteBody({ body: "One\nTwo", visibility: "INTERNAL" }).body).toBe("One\nTwo");
  });
});
