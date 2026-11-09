import { describe, expect, it } from "vitest";

import {
  paymentParamsSchema,
  recordPaymentBodySchema,
  voidPaymentBodySchema,
} from "./payments.schemas.js";

const VALID = { amount: "100.00", paymentDate: "2026-03-02", method: "BANK_TRANSFER" };

function messagesOf(body: unknown, path: string): string[] {
  const result = recordPaymentBodySchema.safeParse(body);
  if (result.success) {
    return [];
  }
  return result.error.issues.filter((issue) => issue.path.join(".") === path).map((i) => i.message);
}

describe("recordPaymentBodySchema (D-27, FR-073)", () => {
  it("accepts the smallest body and normalizes the amount to two places", () => {
    const result = recordPaymentBodySchema.safeParse({ ...VALID, amount: "100" });
    expect(result.success && result.data).toEqual({
      amount: "100.00",
      paymentDate: "2026-03-02",
      method: "BANK_TRANSFER",
    });
  });

  it("accepts a reference and notes, trimming them, and turns blank ones into null", () => {
    const filled = recordPaymentBodySchema.safeParse({
      ...VALID,
      reference: "  Cheque 004512 ",
      notes: "Paid at the door",
    });
    expect(filled.success && filled.data).toMatchObject({
      reference: "Cheque 004512",
      notes: "Paid at the door",
    });
    const blank = recordPaymentBodySchema.safeParse({ ...VALID, reference: "  ", notes: null });
    expect(blank.success && blank.data).toMatchObject({ reference: null, notes: null });
  });

  it.each(["CASH", "BANK_TRANSFER", "CARD_TERMINAL", "CHEQUE", "OTHER"])("accepts %s", (method) => {
    expect(recordPaymentBodySchema.safeParse({ ...VALID, method }).success).toBe(true);
  });

  it.each(["", "cash", "CREDIT_CARD", "PAYPAL", "STRIPE", null, 5])(
    "refuses %j as a method",
    (method) => {
      expect(messagesOf({ ...VALID, method }, "method")).toHaveLength(1);
    },
  );

  it.each([
    "0",
    "0.00",
    "-5",
    "-0.01",
    "abc",
    "",
    "1e3",
    "1,000",
    "10.001",
    "NaN",
    "10000000000.00",
  ])("refuses the amount %j with a message for the amount", (amount) => {
    expect(messagesOf({ ...VALID, amount }, "amount")).toHaveLength(1);
  });

  it("refuses an amount that is not text, so a number cannot slip through as a float", () => {
    for (const amount of [100, 100.5, null, undefined, {}, ["100"]]) {
      expect(messagesOf({ ...VALID, amount }, "amount")).toHaveLength(1);
    }
  });

  it("says what is wrong in words a person can use", () => {
    expect(messagesOf({ ...VALID, amount: "0" }, "amount")).toEqual([
      "The amount must be more than zero.",
    ]);
    expect(messagesOf({ ...VALID, amount: "5.123" }, "amount")).toEqual([
      "Use at most 2 decimal places.",
    ]);
  });

  it.each(["", "2026-3-2", "2026-02-30", "02/03/2026", "tomorrow", null, 20260302])(
    "refuses the date %j",
    (paymentDate) => {
      expect(messagesOf({ ...VALID, paymentDate }, "paymentDate")).toHaveLength(1);
    },
  );

  it("limits the reference to 100 and the notes to 500 characters", () => {
    expect(
      recordPaymentBodySchema.safeParse({ ...VALID, reference: "r".repeat(100) }).success,
    ).toBe(true);
    expect(messagesOf({ ...VALID, reference: "r".repeat(101) }, "reference")).toHaveLength(1);
    expect(recordPaymentBodySchema.safeParse({ ...VALID, notes: "n".repeat(500) }).success).toBe(
      true,
    );
    expect(messagesOf({ ...VALID, notes: "n".repeat(501) }, "notes")).toHaveLength(1);
  });

  it("keeps the reference on one line but lets the notes run over several", () => {
    expect(messagesOf({ ...VALID, reference: "a\nb" }, "reference")).toHaveLength(1);
    expect(recordPaymentBodySchema.safeParse({ ...VALID, notes: "a\nb" }).success).toBe(true);
  });

  it.each([
    "amountPaid",
    "balanceDue",
    "status",
    "invoiceId",
    "recordedByUserId",
    "voidedAt",
    "id",
  ])("refuses a body that names %s: it is the server's to decide", (field) => {
    expect(recordPaymentBodySchema.safeParse({ ...VALID, [field]: "x" }).success).toBe(false);
  });

  it("refuses a body with a missing field", () => {
    for (const field of ["amount", "paymentDate", "method"]) {
      const { [field as keyof typeof VALID]: _omitted, ...rest } = VALID;
      expect(recordPaymentBodySchema.safeParse(rest).success).toBe(false);
    }
  });
});

describe("voidPaymentBodySchema (BR-16)", () => {
  it("needs a reason of 5 to 500 characters and trims it", () => {
    const ok = voidPaymentBodySchema.safeParse({ reason: "  Entered on the wrong invoice. " });
    expect(ok.success && ok.data).toEqual({ reason: "Entered on the wrong invoice." });
    expect(voidPaymentBodySchema.safeParse({ reason: "oops" }).success).toBe(false);
    expect(voidPaymentBodySchema.safeParse({ reason: "     " }).success).toBe(false);
    expect(voidPaymentBodySchema.safeParse({ reason: "r".repeat(500) }).success).toBe(true);
    expect(voidPaymentBodySchema.safeParse({ reason: "r".repeat(501) }).success).toBe(false);
    expect(voidPaymentBodySchema.safeParse({}).success).toBe(false);
  });

  it("refuses unknown fields, so nothing else can be changed by a void", () => {
    expect(
      voidPaymentBodySchema.safeParse({ reason: "Wrong invoice", amount: "1.00" }).success,
    ).toBe(false);
  });
});

describe("paymentParamsSchema", () => {
  it("needs two ids", () => {
    const id = "6f1b1d55-0a9b-4a2c-9a52-0f2f5a3d9c11";
    expect(paymentParamsSchema.safeParse({ id, paymentId: id }).success).toBe(true);
    expect(paymentParamsSchema.safeParse({ id, paymentId: "nope" }).success).toBe(false);
    expect(paymentParamsSchema.safeParse({ id: "nope", paymentId: id }).success).toBe(false);
  });
});
