import type { AdminQuotationDto } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  adminQuotationPath,
  EMPTY_QUOTATION_FORM,
  quotationFieldLabels,
  quotationFormProblems,
  quotationFormSchema,
  type QuotationFormValues,
  quotationToFormValues,
  splitApiProblems,
  toUpdateBody,
  trimTrailingZeros,
} from "./quotations";

const VALUES: QuotationFormValues = {
  lines: [
    { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
    { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  ],
  discountAmount: "0.00",
  taxRate: "8.00",
  validUntil: "2026-12-01",
  terms: "Half in advance.",
  customerNote: "",
};

function values(overrides: Partial<QuotationFormValues> = {}): QuotationFormValues {
  return { ...VALUES, ...overrides };
}

describe("adminQuotationPath", () => {
  it("is keyed by the id and escapes it", () => {
    expect(adminQuotationPath("6f1c7a0e")).toBe("/app/quotations/6f1c7a0e");
    expect(adminQuotationPath("a/b")).toBe("/app/quotations/a%2Fb");
  });
});

describe("trimTrailingZeros", () => {
  it("writes a quantity as a person does", () => {
    expect(trimTrailingZeros("1.00")).toBe("1");
    expect(trimTrailingZeros("1.50")).toBe("1.5");
    expect(trimTrailingZeros("2.25")).toBe("2.25");
    expect(trimTrailingZeros("10")).toBe("10");
    expect(trimTrailingZeros("100.00")).toBe("100");
  });
});

describe("quotationToFormValues and toUpdateBody", () => {
  const quotation = {
    lines: [
      {
        id: "l1",
        position: 1,
        description: "Labour",
        quantity: "1.50",
        unitPrice: "85.00",
        taxable: false,
        lineTotal: "127.50",
      },
    ],
    discountAmount: "10.00",
    taxRate: "8.00",
    validUntil: "2026-12-01",
    terms: null,
    customerNote: "Parts in stock.",
  } as unknown as AdminQuotationDto;

  it("shows the saved draft as text, with quantities as a person writes them and no totals", () => {
    expect(quotationToFormValues(quotation)).toEqual({
      lines: [{ description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false }],
      discountAmount: "10.00",
      taxRate: "8.00",
      validUntil: "2026-12-01",
      terms: "",
      customerNote: "Parts in stock.",
    });
  });

  it("sends the lines and the details with the version being saved, and never a total", () => {
    const body = toUpdateBody(
      values({ terms: "  Half in advance.  ", customerNote: "   ", discountAmount: " 5 " }),
      "2026-11-02T10:00:00.123Z",
    );
    expect(body).toEqual({
      lines: [
        { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
        { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
      ],
      discountAmount: "5",
      taxRate: "8.00",
      validUntil: "2026-12-01",
      terms: "Half in advance.",
      customerNote: null,
      expectedUpdatedAt: "2026-11-02T10:00:00.123Z",
    });
    for (const total of ["subtotal", "taxAmount", "taxableBase", "totalAmount"]) {
      expect(Object.keys(body)).not.toContain(total);
    }
  });

  it("trims the text of a line", () => {
    const body = toUpdateBody(
      values({
        lines: [{ description: "  Fan  ", quantity: " 2 ", unitPrice: " 5.00 ", taxable: true }],
      }),
      "2026-11-02T10:00:00.000Z",
    );
    expect(body.lines).toEqual([
      { description: "Fan", quantity: "2", unitPrice: "5.00", taxable: true },
    ]);
  });
});

describe("quotationFormProblems: the same words and keys as the API", () => {
  it("finds nothing wrong with a good form", () => {
    expect(quotationFormProblems(VALUES)).toEqual({});
  });

  it("names the line and the field of each bad amount", () => {
    const problems = quotationFormProblems(
      values({
        lines: [
          VALUES.lines[0] as (typeof VALUES.lines)[number],
          { description: "Part", quantity: "0", unitPrice: "1.005", taxable: true },
          { description: "Other", quantity: "x", unitPrice: "", taxable: true },
        ],
      }),
    );
    expect(Object.keys(problems).sort()).toEqual([
      "lines.1.quantity",
      "lines.1.unitPrice",
      "lines.2.quantity",
      "lines.2.unitPrice",
    ]);
    expect(problems["lines.1.unitPrice"]).toBe("Use at most 2 decimal places.");
  });

  it("asks for a description on each line", () => {
    const problems = quotationFormProblems(
      values({ lines: [{ description: "   ", quantity: "1", unitPrice: "5", taxable: true }] }),
    );
    expect(problems).toEqual({ "lines.0.description": "Describe the work or item on this line." });
  });

  it("limits a description to 200 characters", () => {
    expect(
      quotationFormProblems(
        values({
          lines: [{ description: "x".repeat(201), quantity: "1", unitPrice: "5", taxable: true }],
        }),
      )["lines.0.description"],
    ).toBe("Keep the description to 200 characters or fewer.");
  });

  it("reports the description of one line beside the quantity of another, together", () => {
    const problems = quotationFormProblems(
      values({
        lines: [
          { description: "", quantity: "1", unitPrice: "5", taxable: true },
          { description: "Part", quantity: "nope", unitPrice: "5", taxable: true },
        ],
      }),
    );
    expect(Object.keys(problems).sort()).toEqual(["lines.0.description", "lines.1.quantity"]);
  });

  it("checks the discount against the subtotal and the tax rate against 0 to 100", () => {
    expect(quotationFormProblems(values({ discountAmount: "500" })).discountAmount).toBe(
      "The discount can't be more than the subtotal (124.50).",
    );
    expect(quotationFormProblems(values({ taxRate: "101" })).taxRate).toBe(
      "Enter a tax rate from 0 to 100.",
    );
  });

  it("needs a real valid-until date and limits the terms and the note", () => {
    expect(quotationFormProblems(values({ validUntil: "" })).validUntil).toBe(
      "Choose the last day the quotation is valid.",
    );
    expect(quotationFormProblems(values({ validUntil: "2026-02-30" })).validUntil).toBeDefined();
    expect(quotationFormProblems(values({ terms: "x".repeat(2001) })).terms).toMatch(/2000/);
    expect(quotationFormProblems(values({ customerNote: "x".repeat(2001) })).customerNote).toMatch(
      /2000/,
    );
  });

  it("wants at least one line", () => {
    expect(quotationFormProblems(values({ lines: [] })).lines).toBe("Add between 1 and 50 lines.");
  });
});

describe("quotationFormSchema", () => {
  it("accepts a good form", () => {
    expect(quotationFormSchema.safeParse(VALUES).success).toBe(true);
  });

  it("turns every problem into an issue on the same path the API uses", () => {
    const result = quotationFormSchema.safeParse(
      values({
        lines: [{ description: "", quantity: "0", unitPrice: "5", taxable: true }],
        taxRate: "abc",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join(".")).sort()).toEqual([
        "lines.0.description",
        "lines.0.quantity",
        "taxRate",
      ]);
      expect(result.error.issues.find((issue) => issue.path.at(-1) === "quantity")?.path).toEqual([
        "lines",
        0,
        "quantity",
      ]);
    }
  });

  it("is not a valid form when empty: the amounts and the date have to be entered", () => {
    expect(quotationFormSchema.safeParse(EMPTY_QUOTATION_FORM).success).toBe(false);
  });
});

describe("quotationFieldLabels", () => {
  it("names each line's fields by the line number", () => {
    const labels = quotationFieldLabels(2);
    expect(labels["lines.0.quantity"]).toBe("Line 1 quantity");
    expect(labels["lines.1.unitPrice"]).toBe("Line 2 unit price");
    expect(labels["lines.1.description"]).toBe("Line 2 description");
    expect(labels.validUntil).toBe("Valid until");
  });
});

describe("splitApiProblems", () => {
  it("puts the API's field errors beside their fields", () => {
    expect(
      splitApiProblems({
        "lines.2.quantity": "Enter a quantity from 0.01 to 9,999.99.",
        discountAmount: "Too big.",
        taxRate: "Bad.",
        validUntil: "Past.",
        lines: "Add between 1 and 50 lines.",
      }),
    ).toEqual({
      fields: {
        "lines.2.quantity": "Enter a quantity from 0.01 to 9,999.99.",
        discountAmount: "Too big.",
        taxRate: "Bad.",
        validUntil: "Past.",
        lines: "Add between 1 and 50 lines.",
      },
      banner: null,
    });
  });

  it("keeps what has no field of its own for a message above the form", () => {
    expect(
      splitApiProblems({
        totalAmount: "The total must be more than zero before the quotation can be sent.",
        validUntil: "Choose a date.",
      }),
    ).toEqual({
      fields: { validUntil: "Choose a date." },
      banner: "The total must be more than zero before the quotation can be sent.",
    });
    expect(splitApiProblems(undefined)).toEqual({ fields: {}, banner: null });
  });

  it("does not take a made-up path for a field", () => {
    const { fields, banner } = splitApiProblems({ "lines.0.secret": "No.", "__proto__.x": "No." });
    expect(fields).toEqual({});
    expect(banner).toBe("No. No.");
  });
});
