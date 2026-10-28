import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fieldErrorsFromZod, ROOT_FIELD } from "./zod-errors.js";

function errorOf(schema: z.ZodType, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("Expected the input to be invalid");
  return result.error;
}

describe("fieldErrorsFromZod", () => {
  const schema = z.strictObject({
    name: z.string().min(2, "Name is too short."),
    lines: z.array(z.strictObject({ quantity: z.number().positive("Must be positive.") })),
  });

  it("keys errors by dotted path, including array indexes", () => {
    const error = errorOf(schema, {
      name: "A",
      lines: [{ quantity: 1 }, { quantity: 2 }, { quantity: -1 }],
    });

    expect(fieldErrorsFromZod(error)).toEqual({
      name: "Name is too short.",
      "lines.2.quantity": "Must be positive.",
    });
  });

  it("reports unknown keys on the key itself", () => {
    const error = errorOf(schema, {
      name: "Alex",
      lines: [{ quantity: 1, discount: 5 }],
      extra: true,
    });

    expect(fieldErrorsFromZod(error)).toEqual({
      "lines.0.discount": "Unknown field.",
      extra: "Unknown field.",
    });
  });

  it("uses the root key for issues that belong to no field", () => {
    const error = errorOf(schema, "not an object");

    expect(Object.keys(fieldErrorsFromZod(error))).toEqual([ROOT_FIELD]);
  });

  it("keeps the first message when a field has several issues", () => {
    const multi = z.object({
      code: z.string().min(5, "Too short.").regex(/^\d+$/, "Digits only."),
    });
    const error = errorOf(multi, { code: "ab" });

    expect(fieldErrorsFromZod(error)).toEqual({ code: "Too short." });
  });

  it("does not echo the rejected input in the messages", () => {
    const error = errorOf(z.object({ email: z.email(), age: z.number() }), {
      email: "hunter2-secret",
      age: "forty-secret",
    });

    expect(JSON.stringify(fieldErrorsFromZod(error))).not.toContain("secret");
  });
});
