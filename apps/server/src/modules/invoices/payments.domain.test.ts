import { ErrorCode, InvoiceStatus, PaymentMethod } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { isAppError } from "../../lib/errors.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { MAX_PUBLIC_SUMMARY_LENGTH, MAX_SUMMARY_LENGTH } from "../activity/activity.service.js";
import {
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
} from "../notifications/notifications.domain.js";
import {
  assertPayable,
  assertPaymentDateNotFuture,
  FUTURE_PAYMENT_DATE_MESSAGE,
  isPayable,
  ledgerAfterRecording,
  ledgerAfterVoiding,
  ledgerOf,
  paymentAlreadyVoidedError,
  paymentExceedsBalanceError,
  type PaymentInvoiceFacts,
  paymentRecordedNotification,
  paymentRecordedTexts,
  paymentVoidedNotification,
  paymentVoidedTexts,
  remainingBalance,
} from "./payments.domain.js";

const I = InvoiceStatus;
const NY = "America/New_York";

/** 2026-11-10 is winter in New York: 23:59:59 local on the due date is 04:59:59 UTC the next day. */
const BEFORE_DUE = new Date("2026-11-05T12:00:00Z");
const AFTER_DUE = new Date("2026-11-11T05:00:00Z");

function facts(overrides: Partial<PaymentInvoiceFacts> = {}): PaymentInvoiceFacts {
  return {
    issuedAt: new Date("2026-11-01T15:00:00Z"),
    voidedAt: null,
    totalAmount: "300.00",
    dueDate: "2026-11-10",
    now: BEFORE_DUE,
    timeZone: NY,
    currencyCode: "USD",
    ...overrides,
  };
}

function problem(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AppError, but nothing was thrown.");
}

describe("which invoices take a payment (D-27)", () => {
  it("issued, partly paid and overdue invoices do", () => {
    for (const status of [I.ISSUED, I.PARTIALLY_PAID, I.OVERDUE]) {
      expect(isPayable(status)).toBe(true);
      expect(() => assertPayable(status)).not.toThrow();
    }
  });

  it.each([
    [I.DRAFT, "still a draft"],
    [I.VOID, "voided"],
    [I.PAID, "already paid in full"],
  ] as const)("a %s invoice is 409 INVOICE_NOT_PAYABLE and says why", (status, words) => {
    expect(isPayable(status)).toBe(false);
    const error = problem(() => assertPayable(status));
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.INVOICE_NOT_PAYABLE);
    expect(error.message).toContain(words);
    expect(error.details).toEqual({ currentStatus: status });
  });

  it("gives each of the three a message of its own", () => {
    const messages = [I.DRAFT, I.VOID, I.PAID].map(
      (status) => problem(() => assertPayable(status)).message,
    );
    expect(new Set(messages).size).toBe(3);
  });
});

describe("remaining balance (FR-075)", () => {
  it("is the total less the payments that stand", () => {
    expect(remainingBalance("300.00", [])).toBe("300.00");
    expect(remainingBalance("300.00", ["100.00"])).toBe("200.00");
    expect(remainingBalance("300.00", ["100.00", "200.00"])).toBe("0.00");
  });

  it("is exact where floats are not", () => {
    expect(remainingBalance("0.30", ["0.10", "0.20"])).toBe("0.00");
    expect(remainingBalance("100.00", ["33.33", "33.33"])).toBe("33.34");
  });
});

describe("the payment date (business time zone)", () => {
  it("today and the past are fine", () => {
    // 02:00 UTC on the 11th is still the 10th in New York.
    const now = new Date("2026-11-11T02:00:00Z");
    expect(() => assertPaymentDateNotFuture("2026-11-10", now, NY)).not.toThrow();
    expect(() => assertPaymentDateNotFuture("2026-01-01", now, NY)).not.toThrow();
  });

  it("tomorrow on the business's calendar is 422 on paymentDate, even when it is today in UTC", () => {
    const now = new Date("2026-11-11T02:00:00Z");
    const error = problem(() => assertPaymentDateNotFuture("2026-11-11", now, NY));
    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual({ paymentDate: FUTURE_PAYMENT_DATE_MESSAGE });
  });

  it("follows the zone: the same instant is a day later in Tokyo", () => {
    const now = new Date("2026-11-11T02:00:00Z");
    expect(() => assertPaymentDateNotFuture("2026-11-11", now, "Asia/Tokyo")).not.toThrow();
    expect(() => assertPaymentDateNotFuture("2026-11-12", now, "Asia/Tokyo")).toThrow();
  });
});

describe("the invoice after a payment is recorded", () => {
  it("a part payment gives PARTIALLY_PAID, with the amount paid and the balance", () => {
    expect(ledgerAfterRecording(facts(), [], "100.00")).toEqual({
      amountPaid: "100.00",
      balance: "200.00",
      status: I.PARTIALLY_PAID,
    });
  });

  it("a second part payment adds to the first", () => {
    expect(ledgerAfterRecording(facts(), ["100.00"], "50.50")).toEqual({
      amountPaid: "150.50",
      balance: "149.50",
      status: I.PARTIALLY_PAID,
    });
  });

  it("paying exactly what is left gives PAID with nothing owed", () => {
    expect(ledgerAfterRecording(facts(), [], "300.00")).toEqual({
      amountPaid: "300.00",
      balance: "0.00",
      status: I.PAID,
    });
    expect(ledgerAfterRecording(facts(), ["100.00"], "200.00").status).toBe(I.PAID);
  });

  it("a part payment after the due date leaves the invoice OVERDUE (precedence), a full one pays it", () => {
    const late = facts({ now: AFTER_DUE });
    expect(ledgerAfterRecording(late, [], "100.00").status).toBe(I.OVERDUE);
    expect(ledgerAfterRecording(late, ["100.00"], "100.00").status).toBe(I.OVERDUE);
    expect(ledgerAfterRecording(late, [], "300.00").status).toBe(I.PAID);
  });

  it("a payment above the balance is 422 PAYMENT_EXCEEDS_BALANCE naming the balance", () => {
    const error = problem(() => ledgerAfterRecording(facts(), ["100.00"], "200.01"));
    expect(error.status).toBe(422);
    expect(error.code).toBe(ErrorCode.PAYMENT_EXCEEDS_BALANCE);
    expect(error.message).toBe("This payment exceeds the remaining balance of $200.00");
    expect(error.fieldErrors).toEqual({ amount: error.message });
    expect(error.details).toEqual({ remainingBalance: "200.00", currencyCode: "USD" });
  });

  it("one cent over is over, and a voided payment is not counted", () => {
    expect(() => ledgerAfterRecording(facts(), [], "300.01")).toThrow();
    // The 100.00 that was voided is not in the list of payments that stand, so 300.00 fits again.
    expect(ledgerAfterRecording(facts(), [], "300.00").status).toBe(I.PAID);
  });

  it("refuses zero, whatever the balance", () => {
    expect(problem(() => ledgerAfterRecording(facts(), [], "0.00")).status).toBe(422);
  });

  it("formats the balance in the invoice's currency", () => {
    expect(paymentExceedsBalanceError("1234.50", "USD").message).toBe(
      "This payment exceeds the remaining balance of $1,234.50",
    );
    expect(paymentExceedsBalanceError("12.00", "EUR").message).toContain("€12.00");
  });
});

describe("the invoice after a payment is voided", () => {
  it("a paid invoice falls back to PARTIALLY_PAID when another payment still stands", () => {
    expect(ledgerAfterVoiding(facts(), ["100.00"])).toEqual({
      amountPaid: "100.00",
      balance: "200.00",
      status: I.PARTIALLY_PAID,
    });
  });

  it("voiding the only payment gives ISSUED before the due date and OVERDUE after it", () => {
    expect(ledgerAfterVoiding(facts(), [])).toEqual({
      amountPaid: "0.00",
      balance: "300.00",
      status: I.ISSUED,
    });
    expect(ledgerAfterVoiding(facts({ now: AFTER_DUE }), []).status).toBe(I.OVERDUE);
  });

  it("a paid invoice that is past due and loses a payment is OVERDUE, not partly paid", () => {
    expect(ledgerAfterVoiding(facts({ now: AFTER_DUE }), ["100.00"]).status).toBe(I.OVERDUE);
  });

  it("recording then voiding the same payment returns to where it began", () => {
    const start = ledgerOf(facts(), []);
    const recorded = ledgerAfterRecording(facts(), [], "125.00");
    expect(recorded.status).toBe(I.PARTIALLY_PAID);
    expect(ledgerAfterVoiding(facts(), [])).toEqual(start);
  });

  it("a payment already voided is 409 PAYMENT_ALREADY_VOIDED", () => {
    const error = paymentAlreadyVoidedError();
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.PAYMENT_ALREADY_VOIDED);
  });
});

describe("the invariant: amountPaid is the sum of the payments that stand, and the status follows", () => {
  it("holds after every step of a sequence of records and voids", () => {
    const f = facts();
    const standing: string[] = [];
    const steps: [string, string][] = [
      ["record", "100.00"],
      ["record", "50.25"],
      ["record", "149.75"],
      ["void", "50.25"],
      ["record", "50.25"],
      ["void", "100.00"],
    ];
    for (const [action, amount] of steps) {
      const ledger =
        action === "record"
          ? ledgerAfterRecording(f, standing, amount)
          : (() => {
              standing.splice(standing.indexOf(amount), 1);
              return ledgerAfterVoiding(f, standing);
            })();
      if (action === "record") {
        standing.push(amount);
      }
      expect(ledger).toEqual(ledgerOf(f, standing));
      expect(ledger.balance).toBe(remainingBalance(f.totalAmount, standing));
    }
    expect(standing).toEqual(["149.75", "50.25"]);
    // 149.75 + 50.25 = 200.00 of 300.00 once the first payment is voided.
    expect(ledgerOf(f, standing)).toEqual({
      amountPaid: "200.00",
      balance: "100.00",
      status: I.PARTIALLY_PAID,
    });
  });
});

describe("the words", () => {
  const words = {
    amount: "125.50",
    currencyCode: "USD",
    paymentDate: "2026-11-03",
    method: PaymentMethod.BANK_TRANSFER,
  };

  it("say 'recorded', never 'processed' or 'charged'", () => {
    const texts = paymentRecordedTexts(words);
    const notification = paymentRecordedNotification({
      invoiceNumber: "INV-2026-00007",
      serviceName: "AC repair",
      amount: "125.50",
      currencyCode: "USD",
      paymentDate: "2026-11-03",
      balance: "174.50",
    });
    const all = [texts.staff, texts.customer, notification.title, notification.message].join(" ");
    expect(all).toMatch(/recorded/);
    expect(all).not.toMatch(/process|charged|paid by card|approved/i);
  });

  it("the staff sentence names the method and the customer's does not need to", () => {
    const texts = paymentRecordedTexts(words);
    expect(texts.staff).toBe(
      "recorded a payment of $125.50 received on Nov 3, 2026 (Bank transfer)",
    );
    expect(texts.customer).toBe("recorded your payment of $125.50 received on Nov 3, 2026");
  });

  it("fit the history's limits once built", () => {
    const summaries = buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      ...paymentRecordedTexts(words),
    });
    expect(summaries.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    expect(summaries.publicSummary).toBe(
      "We recorded your payment of $125.50 received on Nov 3, 2026.",
    );
    expect(summaries.publicSummary?.length).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
  });

  it("the notification says whether a balance remains or the invoice is paid in full", () => {
    const base = {
      invoiceNumber: "INV-2026-00007",
      serviceName: "AC repair",
      amount: "125.50",
      currencyCode: "USD",
      paymentDate: "2026-11-03",
    };
    expect(paymentRecordedNotification({ ...base, balance: "174.50" }).message).toContain(
      "The balance due is $174.50.",
    );
    expect(paymentRecordedNotification({ ...base, balance: "0.00" }).message).toContain(
      "The invoice is now paid in full.",
    );
  });

  it("a reversal tells the customer the new balance and has no input for the internal reason", () => {
    const texts = paymentVoidedTexts({ ...words, balance: "300.00" });
    expect(texts.customer).toContain("balance due is now $300.00");
    const notification = paymentVoidedNotification({
      invoiceNumber: "INV-2026-00007",
      serviceName: "AC repair",
      amount: "125.50",
      currencyCode: "USD",
      paymentDate: "2026-11-03",
      balance: "300.00",
    });
    expect(notification.title).toBe("A payment record on invoice INV-2026-00007 was reversed");
    expect(notification.message).toContain("The balance due is now $300.00.");
  });

  it("stay within the notification limits even for a long service name and the largest amounts", () => {
    const longName = "x".repeat(100);
    const big = {
      invoiceNumber: "INV-2026-00007",
      serviceName: longName,
      amount: "9999999999.99",
      currencyCode: "USD",
      paymentDate: "2026-11-03",
      balance: "9999999999.99",
    };
    for (const notification of [paymentRecordedNotification(big), paymentVoidedNotification(big)]) {
      expect(notification.title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX_LENGTH);
      expect(notification.message.length).toBeLessThanOrEqual(NOTIFICATION_MESSAGE_MAX_LENGTH);
    }
  });
});
