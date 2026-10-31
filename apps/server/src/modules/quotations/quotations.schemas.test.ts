import type { FieldErrors } from "@fixflow/shared";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  createQuotationBodySchema,
  getQuotationQuerySchema,
  quotationIdParamsSchema,
  sendQuotationBodySchema,
  updateQuotationBodySchema,
  voidQuotationBodySchema,
} from "./quotations.schemas.js";

const ID = "6f1c7a0e-5d0b-4f55-9d52-0d8d1c3b8a11";

const validUpdate = {
  lines: [
    { description: "AC diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
  ],
  discountAmount: "0",
  taxRate: "8.00",
  validUntil: "2026-12-01",
  terms: "Payment due within 14 days.",
  customerNote: null,
  expectedUpdatedAt: "2026-11-02T10:00:00.123Z",
};

function issues(
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      error?: { issues: { path: PropertyKey[]; message: string }[] };
    };
  },
  value: unknown,
) {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/** What the API would answer in `fieldErrors`; empty when the value is valid. */
function fieldErrorsOf(schema: ZodType, value: unknown): FieldErrors {
  const result = schema.safeParse(value);
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

describe("updateQuotationBodySchema", () => {
  it("accepts a complete body and trims the text", () => {
    const parsed = updateQuotationBodySchema.parse({
      ...validUpdate,
      lines: [{ ...validUpdate.lines[0], description: "  AC diagnostic visit  " }],
      terms: "  Payment due within 14 days.  ",
    });
    expect(parsed.lines[0]?.description).toBe("AC diagnostic visit");
    expect(parsed.terms).toBe("Payment due within 14 days.");
  });

  it("turns blank terms and a blank note into null, which clears them", () => {
    const parsed = updateQuotationBodySchema.parse({
      ...validUpdate,
      terms: "   ",
      customerNote: "",
    });
    expect(parsed.terms).toBeNull();
    expect(parsed.customerNote).toBeNull();
  });

  it("refuses every total, so a client cannot believe it set one", () => {
    for (const key of [
      "subtotal",
      "taxableSubtotal",
      "taxableBase",
      "taxAmount",
      "totalAmount",
      "discount",
      "id",
      "status",
    ]) {
      expect(
        fieldErrorsOf(updateQuotationBodySchema, { ...validUpdate, [key]: "1.00" }),
        key,
      ).toEqual({
        [key]: "Unknown field.",
      });
    }
  });

  it("refuses a total on a line, too, and names the line", () => {
    expect(
      fieldErrorsOf(updateQuotationBodySchema, {
        ...validUpdate,
        lines: [{ ...validUpdate.lines[0], lineTotal: "79.00", lineSubtotal: "79.00" }],
      }),
    ).toEqual({ "lines.0.lineTotal": "Unknown field.", "lines.0.lineSubtotal": "Unknown field." });
  });

  it("needs 1 to 50 lines", () => {
    expect(issues(updateQuotationBodySchema, { ...validUpdate, lines: [] })).toEqual([
      "lines: Add between 1 and 50 lines.",
    ]);
    const fiftyOne = Array.from({ length: 51 }, () => validUpdate.lines[0]);
    expect(issues(updateQuotationBodySchema, { ...validUpdate, lines: fiftyOne })).toEqual([
      "lines: Add between 1 and 50 lines.",
    ]);
    const fifty = Array.from({ length: 50 }, () => validUpdate.lines[0]);
    expect(updateQuotationBodySchema.safeParse({ ...validUpdate, lines: fifty }).success).toBe(
      true,
    );
  });

  it("names the line and the field that are wrong", () => {
    const found = issues(updateQuotationBodySchema, {
      ...validUpdate,
      lines: [
        validUpdate.lines[0],
        { description: "", quantity: 3, unitPrice: "1", taxable: "yes" },
      ],
    });
    expect(found.map((entry) => entry.split(":")[0]).sort()).toEqual([
      "lines.1.description",
      "lines.1.quantity",
      "lines.1.taxable",
    ]);
  });

  it("keeps the amounts as text for the shared calculation to judge", () => {
    // A bad number is the calculation's to report (with its own field key and message), not the schema's.
    expect(
      updateQuotationBodySchema.safeParse({
        ...validUpdate,
        lines: [{ ...validUpdate.lines[0], quantity: "abc" }],
      }).success,
    ).toBe(true);
  });

  it("limits the length of a description, the terms and the note", () => {
    expect(
      issues(updateQuotationBodySchema, {
        ...validUpdate,
        lines: [{ ...validUpdate.lines[0], description: "x".repeat(201) }],
      }).length,
    ).toBe(1);
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, terms: "x".repeat(2001) }).length,
    ).toBe(1);
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, customerNote: "x".repeat(2001) }).length,
    ).toBe(1);
  });

  it("needs a real calendar date and an ISO instant for the version being saved", () => {
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, validUntil: "2026-02-30" }).length,
    ).toBe(1);
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, validUntil: "01/12/2026" }).length,
    ).toBe(1);
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, expectedUpdatedAt: "yesterday" }).length,
    ).toBe(1);
    expect(
      issues(updateQuotationBodySchema, { ...validUpdate, expectedUpdatedAt: undefined }).length,
    ).toBe(1);
  });

  it("needs the terms and the note to be present, even when they are null", () => {
    const { terms: _terms, ...withoutTerms } = validUpdate;
    expect(issues(updateQuotationBodySchema, withoutTerms).length).toBe(1);
  });
});

describe("createQuotationBodySchema", () => {
  it("takes nothing, or the id of the quotation to replace", () => {
    expect(createQuotationBodySchema.parse({})).toEqual({});
    expect(createQuotationBodySchema.parse({ replacesQuotationId: ID })).toEqual({
      replacesQuotationId: ID,
    });
  });

  it("refuses anything else", () => {
    expect(issues(createQuotationBodySchema, { replacesQuotationId: "nope" }).length).toBe(1);
    expect(issues(createQuotationBodySchema, { status: "SENT" }).length).toBe(1);
  });
});

describe("sendQuotationBodySchema", () => {
  it("needs the status the screen showed", () => {
    expect(sendQuotationBodySchema.parse({ expectedStatus: "DRAFT" })).toEqual({
      expectedStatus: "DRAFT",
    });
    expect(issues(sendQuotationBodySchema, {}).length).toBe(1);
    expect(issues(sendQuotationBodySchema, { expectedStatus: "DONE" }).length).toBe(1);
    expect(
      issues(sendQuotationBodySchema, { expectedStatus: "DRAFT", status: "SENT" }).length,
    ).toBe(1);
  });
});

describe("voidQuotationBodySchema", () => {
  it("needs a reason of 5 to 500 characters", () => {
    const base = { expectedStatus: "SENT" };
    expect(
      voidQuotationBodySchema.safeParse({ ...base, reason: "Wrong unit priced." }).success,
    ).toBe(true);
    expect(issues(voidQuotationBodySchema, { ...base, reason: "no" }).length).toBe(1);
    expect(issues(voidQuotationBodySchema, { ...base, reason: "x".repeat(501) }).length).toBe(1);
    expect(issues(voidQuotationBodySchema, base).length).toBe(1);
  });

  it("may carry a message for the customer, and nothing else", () => {
    const body = { expectedStatus: "SENT", reason: "Wrong unit priced." };
    expect(
      voidQuotationBodySchema.parse({ ...body, customerMessage: "  A corrected quote follows.  " })
        .customerMessage,
    ).toBe("A corrected quote follows.");
    expect(
      voidQuotationBodySchema.parse({ ...body, customerMessage: "" }).customerMessage,
    ).toBeNull();
    expect(
      issues(voidQuotationBodySchema, { ...body, customerMessage: "x".repeat(501) }).length,
    ).toBe(1);
    expect(issues(voidQuotationBodySchema, { ...body, voidedBy: "someone" }).length).toBe(1);
  });
});

describe("params and query", () => {
  it("needs a real id", () => {
    expect(quotationIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(quotationIdParamsSchema.safeParse({ id: "QT-2026-00001" }).success).toBe(false);
  });

  it("accepts ?preview=1 and nothing else for preview", () => {
    expect(getQuotationQuerySchema.parse({})).toEqual({});
    expect(getQuotationQuerySchema.parse({ preview: "1" })).toEqual({ preview: true });
    expect(getQuotationQuerySchema.safeParse({ preview: "0" }).success).toBe(false);
    expect(getQuotationQuerySchema.safeParse({ preview: "true" }).success).toBe(false);
  });
});
