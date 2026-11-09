import { describe, expect, it } from "vitest";

import {
  exceedsBalanceMessage,
  firstPaymentFieldWithMessage,
  initialPaymentValues,
  PAYMENT_METHOD_OPTIONS,
  type PaymentFormValues,
  splitServerPaymentErrors,
  toRecordPaymentBody,
  validatePaymentForm,
  voidPaymentConsequence,
} from "./payments";

const CONTEXT = { balanceDue: "200.00", currencyCode: "USD", today: "2026-03-02" };

function values(overrides: Partial<PaymentFormValues> = {}): PaymentFormValues {
  return {
    amount: "100.00",
    paymentDate: "2026-03-02",
    method: "CASH",
    reference: "",
    notes: "",
    ...overrides,
  };
}

describe("initialPaymentValues", () => {
  it("pre-fills the remaining balance and today, and leaves the method to be chosen", () => {
    expect(initialPaymentValues("200.00", "2026-03-02")).toEqual({
      amount: "200.00",
      paymentDate: "2026-03-02",
      method: "",
      reference: "",
      notes: "",
    });
  });
});

describe("validatePaymentForm", () => {
  it("accepts a complete form, including the exact balance and today", () => {
    expect(validatePaymentForm(values(), CONTEXT)).toEqual({});
    expect(validatePaymentForm(values({ amount: "200" }), CONTEXT)).toEqual({});
    expect(validatePaymentForm(values({ amount: "0.01" }), CONTEXT)).toEqual({});
  });

  it.each([
    ["", "Enter the amount received."],
    ["   ", "Enter the amount received."],
    ["abc", "Enter the amount as a number above zero, for example 120 or 120.50."],
    ["-5", "Enter the amount as a number above zero, for example 120 or 120.50."],
    ["1e2", "Enter the amount as a number above zero, for example 120 or 120.50."],
    ["0", "The amount must be more than zero."],
    ["0.00", "The amount must be more than zero."],
    ["10.005", "Use at most 2 decimal places."],
  ])("refuses the amount %j with %j", (amount, message) => {
    expect(validatePaymentForm(values({ amount }), CONTEXT).amount).toBe(message);
  });

  it("refuses more than the balance, naming it, with the server's wording", () => {
    const errors = validatePaymentForm(values({ amount: "200.01" }), CONTEXT);
    expect(errors.amount).toBe("This payment exceeds the remaining balance of $200.00");
    expect(errors.amount).toBe(exceedsBalanceMessage("200.00", "USD"));
  });

  it("compares exactly, to the cent", () => {
    expect(
      validatePaymentForm(values({ amount: "0.31" }), { ...CONTEXT, balanceDue: "0.30" }).amount,
    ).toBeDefined();
    expect(
      validatePaymentForm(values({ amount: "0.30" }), { ...CONTEXT, balanceDue: "0.30" }).amount,
    ).toBeUndefined();
  });

  it("refuses a missing date, a malformed one and one after the business's today", () => {
    expect(validatePaymentForm(values({ paymentDate: "" }), CONTEXT).paymentDate).toBe(
      "Choose the date the payment was received.",
    );
    expect(validatePaymentForm(values({ paymentDate: "2026-02-30" }), CONTEXT).paymentDate).toBe(
      "Choose the date the payment was received.",
    );
    expect(validatePaymentForm(values({ paymentDate: "2026-03-03" }), CONTEXT).paymentDate).toBe(
      "The payment date can't be in the future.",
    );
    expect(
      validatePaymentForm(values({ paymentDate: "2026-03-01" }), CONTEXT).paymentDate,
    ).toBeUndefined();
  });

  it("needs a method", () => {
    expect(validatePaymentForm(values({ method: "" }), CONTEXT).method).toBe(
      "Choose how the payment was received.",
    );
  });

  it("limits the reference to 100 and the notes to 500 characters", () => {
    expect(
      validatePaymentForm(values({ reference: "r".repeat(100), notes: "n".repeat(500) }), CONTEXT),
    ).toEqual({});
    const errors = validatePaymentForm(
      values({ reference: "r".repeat(101), notes: "n".repeat(501) }),
      CONTEXT,
    );
    expect(errors.reference).toContain("100");
    expect(errors.notes).toContain("500");
  });

  it("reports every problem at once, and the first field to focus is the first the person meets", () => {
    const errors = validatePaymentForm(
      values({ amount: "", paymentDate: "", method: "" }),
      CONTEXT,
    );
    expect(Object.keys(errors)).toEqual(["amount", "paymentDate", "method"]);
    expect(firstPaymentFieldWithMessage(errors)).toBe("amount");
    expect(firstPaymentFieldWithMessage({ method: "x", notes: "y" })).toBe("method");
    expect(firstPaymentFieldWithMessage({})).toBeNull();
  });
});

describe("toRecordPaymentBody", () => {
  it("sends the amount as typed text and turns blank optional fields into null", () => {
    expect(toRecordPaymentBody(values({ amount: " 120.50 ", reference: "  ", notes: "" }))).toEqual(
      {
        amount: "120.50",
        paymentDate: "2026-03-02",
        method: "CASH",
        reference: null,
        notes: null,
      },
    );
  });

  it("trims a reference and notes that are filled in", () => {
    const body = toRecordPaymentBody(
      values({ method: "CHEQUE", reference: " 004512 ", notes: " left with neighbour " }),
    );
    expect(body).toMatchObject({
      method: "CHEQUE",
      reference: "004512",
      notes: "left with neighbour",
    });
    expect(typeof body.amount).toBe("string");
  });

  it("refuses to build a body without a method", () => {
    expect(() => toRecordPaymentBody(values({ method: "" }))).toThrow();
  });
});

describe("splitServerPaymentErrors", () => {
  it("keeps the messages for fields the form has and returns the rest for the banner", () => {
    expect(
      splitServerPaymentErrors({
        amount: "This payment exceeds the remaining balance of $100.00",
        paymentDate: "The payment date can't be in the future.",
        other: "Something else.",
      }),
    ).toEqual({
      fields: {
        amount: "This payment exceeds the remaining balance of $100.00",
        paymentDate: "The payment date can't be in the future.",
      },
      loose: ["Something else."],
    });
    expect(splitServerPaymentErrors(undefined)).toEqual({ fields: {}, loose: [] });
  });
});

describe("PAYMENT_METHOD_OPTIONS", () => {
  it("offers the five methods with labels that never claim FixFlow took the money", () => {
    expect(PAYMENT_METHOD_OPTIONS.map((option) => option.value)).toEqual([
      "CASH",
      "BANK_TRANSFER",
      "CARD_TERMINAL",
      "CHEQUE",
      "OTHER",
    ]);
    expect(PAYMENT_METHOD_OPTIONS.map((option) => option.label)).toEqual([
      "Cash",
      "Bank transfer",
      "Card terminal",
      "Cheque",
      "Other",
    ]);
  });
});

describe("voidPaymentConsequence", () => {
  it("states the amount the balance rises by and the balance after, exactly", () => {
    expect(
      voidPaymentConsequence({ amount: "100.10", balanceDue: "199.90", currencyCode: "USD" }),
    ).toEqual({ raises: "$100.10", newBalance: "$300.00" });
    expect(
      voidPaymentConsequence({ amount: "0.10", balanceDue: "0.20", currencyCode: "USD" }),
    ).toEqual({ raises: "$0.10", newBalance: "$0.30" });
  });
});
