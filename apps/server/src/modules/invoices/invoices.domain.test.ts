import { ErrorCode, InvoiceAction, InvoiceStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { isAppError } from "../../lib/errors.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { MAX_PUBLIC_SUMMARY_LENGTH, MAX_SUMMARY_LENGTH } from "../activity/activity.service.js";
import {
  assertInvoiceTransition,
  availableInvoiceActions,
  canTransitionInvoice,
  createdTexts,
  daysOverdue,
  defaultDueDate,
  deriveInvoiceStatus,
  DUE_BEFORE_ISSUE_MESSAGE,
  effectiveIssueDate,
  INVOICE_TRANSITIONS,
  invoiceExistsError,
  invoiceHasPaymentsError,
  invoiceNotEditableError,
  InvoiceTrigger,
  isPastDue,
  ISSUE_NEEDS_LINES_MESSAGE,
  ISSUE_NEEDS_TOTAL_MESSAGE,
  issuedNotification,
  issuedTexts,
  issueProblems,
  overdueTexts,
  staleInvoiceError,
  voidedNotification,
  voidedTexts,
} from "./invoices.domain.js";

const I = InvoiceStatus;
const NY = "America/New_York";
const ISSUED_AT = new Date("2026-11-01T15:00:00Z");

// 2026-11-10 is a winter day in New York (UTC-5): 23:59:59 local is 04:59:59 UTC the next day.
const DUE = "2026-11-10";
const LAST_SECOND = new Date("2026-11-11T04:59:59Z");
const FIRST_OVERDUE_SECOND = new Date("2026-11-11T05:00:00Z");

function derive(overrides: Partial<Parameters<typeof deriveInvoiceStatus>[0]> = {}) {
  return deriveInvoiceStatus({
    issuedAt: ISSUED_AT,
    voidedAt: null,
    totalAmount: "100.00",
    amountPaid: "0.00",
    dueDate: DUE,
    now: new Date("2026-11-05T12:00:00Z"),
    timeZone: NY,
    ...overrides,
  });
}

describe("deriveInvoiceStatus precedence (VOID > DRAFT > PAID > OVERDUE > PARTIALLY_PAID > ISSUED)", () => {
  const PAST = new Date("2026-12-01T12:00:00Z");
  const PAST_DUE = { dueDate: DUE, now: PAST };

  it("a voided invoice is VOID whatever else is true", () => {
    const voidedAt = new Date("2026-11-02T10:00:00Z");
    expect(derive({ voidedAt })).toBe(I.VOID);
    expect(derive({ voidedAt, issuedAt: null })).toBe(I.VOID); // a voided draft
    expect(derive({ voidedAt, ...PAST_DUE })).toBe(I.VOID); // past due
    expect(derive({ voidedAt, amountPaid: "100.00" })).toBe(I.VOID); // fully paid
    expect(derive({ voidedAt, amountPaid: "40.00", ...PAST_DUE })).toBe(I.VOID);
  });

  it("an invoice that was never issued is a DRAFT, even past a due date it already holds", () => {
    expect(derive({ issuedAt: null })).toBe(I.DRAFT);
    expect(derive({ issuedAt: null, ...PAST_DUE })).toBe(I.DRAFT);
    expect(derive({ issuedAt: null, dueDate: null })).toBe(I.DRAFT);
    expect(derive({ issuedAt: null, totalAmount: "0.00" })).toBe(I.DRAFT);
  });

  it("an issued invoice with nothing owed is PAID, past due or not", () => {
    expect(derive({ amountPaid: "100.00" })).toBe(I.PAID);
    expect(derive({ amountPaid: "100.00", ...PAST_DUE })).toBe(I.PAID);
  });

  it("an issued invoice past its due date with a balance is OVERDUE, partly paid or not", () => {
    expect(derive({ ...PAST_DUE })).toBe(I.OVERDUE);
    expect(derive({ amountPaid: "0.01", ...PAST_DUE })).toBe(I.OVERDUE);
    expect(derive({ amountPaid: "99.99", ...PAST_DUE })).toBe(I.OVERDUE);
  });

  it("an issued invoice not yet due with part paid is PARTIALLY_PAID", () => {
    expect(derive({ amountPaid: "0.01" })).toBe(I.PARTIALLY_PAID);
    expect(derive({ amountPaid: "99.99" })).toBe(I.PARTIALLY_PAID);
  });

  it("an issued invoice not yet due with nothing paid is ISSUED", () => {
    expect(derive()).toBe(I.ISSUED);
  });

  it("compares amounts as decimals, not as text or floats", () => {
    expect(derive({ totalAmount: "0.30", amountPaid: "0.10" })).toBe(I.PARTIALLY_PAID);
    expect(derive({ totalAmount: "0.30", amountPaid: "0.30" })).toBe(I.PAID);
    expect(derive({ totalAmount: "1234567.89", amountPaid: "1234567.89" })).toBe(I.PAID);
    expect(derive({ totalAmount: "9.5", amountPaid: "9.50" })).toBe(I.PAID);
  });
});

describe("deriveInvoiceStatus: a total of zero", () => {
  it("owes nothing, so an issued invoice for zero is PAID and never overdue", () => {
    expect(derive({ totalAmount: "0.00", amountPaid: "0.00" })).toBe(I.PAID);
    expect(
      derive({ totalAmount: "0.00", amountPaid: "0.00", now: new Date("2027-06-01T00:00:00Z") }),
    ).toBe(I.PAID);
  });

  it("is a DRAFT while it is a draft", () => {
    expect(derive({ totalAmount: "0.00", issuedAt: null })).toBe(I.DRAFT);
  });
});

describe("the due-date boundary in the business time zone (D-26)", () => {
  it("is still ISSUED at 23:59:59 on the due date in New York (04:59:59 UTC the next day)", () => {
    expect(derive({ now: LAST_SECOND })).toBe(I.ISSUED);
    expect(isPastDue(DUE, LAST_SECOND, NY)).toBe(false);
  });

  it("is OVERDUE from the first second of the next local day (05:00:00 UTC)", () => {
    expect(derive({ now: FIRST_OVERDUE_SECOND })).toBe(I.OVERDUE);
    expect(isPastDue(DUE, FIRST_OVERDUE_SECOND, NY)).toBe(true);
  });

  it("is not overdue at 9 pm New York time on the due date, though it is already tomorrow in UTC", () => {
    const nineAtNight = new Date("2026-11-11T02:00:00Z");
    expect(derive({ now: nineAtNight })).toBe(I.ISSUED);
  });

  it("is not overdue on the due date itself, from its first second", () => {
    expect(derive({ now: new Date("2026-11-10T05:00:00Z") })).toBe(I.ISSUED); // 00:00:00 local
  });

  it("uses summer time in the summer (UTC-4): 03:59:59 UTC is the last second", () => {
    const due = "2026-07-15";
    expect(derive({ dueDate: due, now: new Date("2026-07-16T03:59:59Z") })).toBe(I.ISSUED);
    expect(derive({ dueDate: due, now: new Date("2026-07-16T04:00:00Z") })).toBe(I.OVERDUE);
  });

  it("treats the day the clocks fall back as one day: due 1 Nov 2026 lasts until 05:00 UTC on the 2nd", () => {
    // 1 Nov 2026 has 25 hours in New York; local midnight at the end of it is 05:00 UTC (UTC-5).
    expect(derive({ dueDate: "2026-11-01", now: new Date("2026-11-02T04:59:59Z") })).toBe(I.ISSUED);
    expect(derive({ dueDate: "2026-11-01", now: new Date("2026-11-02T05:00:00Z") })).toBe(
      I.OVERDUE,
    );
  });

  it("treats the day the clocks spring forward as one day: due 8 Mar 2026 lasts until 04:00 UTC on the 9th", () => {
    // 8 Mar 2026 has 23 hours; local midnight at the end of it is 04:00 UTC (UTC-4).
    expect(derive({ dueDate: "2026-03-08", now: new Date("2026-03-09T03:59:59Z") })).toBe(I.ISSUED);
    expect(derive({ dueDate: "2026-03-08", now: new Date("2026-03-09T04:00:00Z") })).toBe(
      I.OVERDUE,
    );
  });

  it("follows the business zone, not the server's: the same instant is overdue in Tokyo and not in Los Angeles", () => {
    const now = new Date("2026-11-10T20:00:00Z"); // 05:00 on the 11th in Tokyo, noon on the 10th in LA
    expect(derive({ now, timeZone: "Asia/Tokyo" })).toBe(I.OVERDUE);
    expect(derive({ now, timeZone: "America/Los_Angeles" })).toBe(I.ISSUED);
  });

  it("an issued invoice without a due date can never be overdue", () => {
    expect(derive({ dueDate: null, now: new Date("2030-01-01T00:00:00Z") })).toBe(I.ISSUED);
  });
});

describe("daysOverdue", () => {
  const base = { dueDate: DUE, timeZone: NY };

  it("is 0 unless the status is OVERDUE", () => {
    for (const status of Object.values(I).filter((value) => value !== I.OVERDUE)) {
      expect(daysOverdue({ ...base, status, now: new Date("2027-01-01T12:00:00Z") })).toBe(0);
    }
  });

  it("counts calendar days past the due date in the business zone", () => {
    const at = (now: string) => daysOverdue({ ...base, status: I.OVERDUE, now: new Date(now) });
    expect(at("2026-11-11T05:00:00Z")).toBe(1); // first overdue second
    expect(at("2026-11-14T12:00:00Z")).toBe(4);
    expect(at("2026-11-15T04:59:59Z")).toBe(4); // still the 14th in New York
    expect(at("2026-11-15T05:00:00Z")).toBe(5);
  });

  it("is 0 for an overdue invoice with no due date, and never negative", () => {
    expect(
      daysOverdue({ ...base, dueDate: null, status: I.OVERDUE, now: new Date("2027-01-01") }),
    ).toBe(0);
    expect(daysOverdue({ ...base, status: I.OVERDUE, now: new Date("2026-11-01T12:00:00Z") })).toBe(
      0,
    );
  });
});

describe("status transitions (D-26)", () => {
  it("lists exactly the sixteen allowed changes: six by an admin or the system, ten by a payment", () => {
    expect(INVOICE_TRANSITIONS).toHaveLength(16);
    expect(
      INVOICE_TRANSITIONS.filter((transition) => transition.trigger === InvoiceTrigger.PAYMENT),
    ).toHaveLength(10);
  });

  const pairs = Object.values(I).flatMap((from) =>
    Object.values(I).flatMap((to) =>
      Object.values(InvoiceTrigger).map((trigger) => ({ from, to, trigger })),
    ),
  );

  it("covers every status pair for the three triggers (108)", () => {
    expect(pairs).toHaveLength(108);
    expect(
      pairs.filter((pair) => canTransitionInvoice(pair.from, pair.to, pair.trigger)),
    ).toHaveLength(16);
  });

  it.each([
    [I.DRAFT, I.ISSUED, InvoiceTrigger.ADMIN],
    [I.DRAFT, I.VOID, InvoiceTrigger.ADMIN],
    [I.ISSUED, I.VOID, InvoiceTrigger.ADMIN],
    [I.OVERDUE, I.VOID, InvoiceTrigger.ADMIN],
    [I.ISSUED, I.OVERDUE, InvoiceTrigger.SYSTEM],
    [I.PARTIALLY_PAID, I.OVERDUE, InvoiceTrigger.SYSTEM],
    [I.ISSUED, I.PARTIALLY_PAID, InvoiceTrigger.PAYMENT],
    [I.ISSUED, I.PAID, InvoiceTrigger.PAYMENT],
    [I.ISSUED, I.OVERDUE, InvoiceTrigger.PAYMENT],
    [I.PARTIALLY_PAID, I.PAID, InvoiceTrigger.PAYMENT],
    [I.PARTIALLY_PAID, I.OVERDUE, InvoiceTrigger.PAYMENT],
    [I.OVERDUE, I.PAID, InvoiceTrigger.PAYMENT],
    [I.PAID, I.PARTIALLY_PAID, InvoiceTrigger.PAYMENT],
    [I.PAID, I.ISSUED, InvoiceTrigger.PAYMENT],
    [I.PAID, I.OVERDUE, InvoiceTrigger.PAYMENT],
    [I.PARTIALLY_PAID, I.ISSUED, InvoiceTrigger.PAYMENT],
  ] as const)("allows %s → %s by %s", (from, to, trigger) => {
    expect(canTransitionInvoice(from, to, trigger)).toBe(true);
    expect(() => assertInvoiceTransition(from, to, trigger)).not.toThrow();
  });

  it("refuses every other pair with 409 INVALID_STATE_TRANSITION and the current status", () => {
    for (const { from, to, trigger } of pairs) {
      if (canTransitionInvoice(from, to, trigger)) {
        continue;
      }
      try {
        assertInvoiceTransition(from, to, trigger);
        expect.unreachable(`${from} → ${to} by ${trigger} should be refused`);
      } catch (error) {
        expect(isAppError(error) && error.status).toBe(409);
        expect(isAppError(error) && error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
        expect(isAppError(error) && error.details).toEqual({
          currentStatus: from,
          requestedStatus: to,
        });
      }
    }
  });

  it("an admin cannot make the system's change, and nobody leaves VOID", () => {
    expect(canTransitionInvoice(I.ISSUED, I.OVERDUE, InvoiceTrigger.ADMIN)).toBe(false);
    for (const to of Object.values(I)) {
      for (const trigger of Object.values(InvoiceTrigger)) {
        expect(canTransitionInvoice(I.VOID, to, trigger)).toBe(false);
      }
    }
  });

  it("only a voided payment takes a paid invoice back, and a payment never reaches VOID or DRAFT", () => {
    for (const to of Object.values(I)) {
      expect(canTransitionInvoice(I.PAID, to, InvoiceTrigger.ADMIN)).toBe(false);
      expect(canTransitionInvoice(I.PAID, to, InvoiceTrigger.SYSTEM)).toBe(false);
    }
    for (const from of Object.values(I)) {
      expect(canTransitionInvoice(from, I.VOID, InvoiceTrigger.PAYMENT)).toBe(false);
      expect(canTransitionInvoice(from, I.DRAFT, InvoiceTrigger.PAYMENT)).toBe(false);
    }
    expect(canTransitionInvoice(I.DRAFT, I.PAID, InvoiceTrigger.PAYMENT)).toBe(false);
  });

  it("says in words why, for a voided invoice and for a no-op", () => {
    try {
      assertInvoiceTransition(I.VOID, I.ISSUED, InvoiceTrigger.ADMIN);
    } catch (error) {
      expect(isAppError(error) && error.message).toBe(
        "This invoice is void, so it can no longer be changed.",
      );
    }
    try {
      assertInvoiceTransition(I.ISSUED, I.ISSUED, InvoiceTrigger.ADMIN);
    } catch (error) {
      expect(isAppError(error) && error.message).toBe("This invoice is already issued.");
    }
  });
});

describe("errors", () => {
  it("staleInvoiceError is 409 STALE_STATE with the current status", () => {
    const error = staleInvoiceError(I.ISSUED);
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.STALE_STATE);
    expect(error.details).toEqual({ currentStatus: I.ISSUED });
  });

  it("invoiceNotEditableError is 409 INVOICE_NOT_EDITABLE and differs for a void invoice", () => {
    const issued = invoiceNotEditableError(I.ISSUED);
    expect(issued.code).toBe(ErrorCode.INVOICE_NOT_EDITABLE);
    expect(issued.status).toBe(409);
    expect(issued.message).toContain("Void it");
    expect(invoiceNotEditableError(I.VOID).message).toContain("voided");
  });

  it("invoiceExistsError names the invoice and carries its id", () => {
    const error = invoiceExistsError({
      id: "11111111-1111-4111-8111-111111111111",
      invoiceNumber: "INV-2026-00007",
      status: I.ISSUED,
    });
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.INVOICE_EXISTS);
    expect(error.message).toContain("INV-2026-00007");
    expect(error.details).toEqual({
      invoiceId: "11111111-1111-4111-8111-111111111111",
      currentStatus: I.ISSUED,
    });
    expect(invoiceExistsError({ id: "x", invoiceNumber: null, status: I.DRAFT }).message).toContain(
      "draft invoice",
    );
  });

  it("invoiceHasPaymentsError is 409 INVOICE_HAS_PAYMENTS", () => {
    const error = invoiceHasPaymentsError(I.PARTIALLY_PAID);
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.INVOICE_HAS_PAYMENTS);
  });
});

describe("availableInvoiceActions (D-43)", () => {
  it("a draft can be edited, issued and voided, in that order", () => {
    expect(availableInvoiceActions(I.DRAFT)).toEqual([
      InvoiceAction.EDIT,
      InvoiceAction.ISSUE,
      InvoiceAction.VOID,
    ]);
  });

  it("an issued or overdue invoice with no payments can take a payment or be voided", () => {
    const both = [InvoiceAction.RECORD_PAYMENT, InvoiceAction.VOID];
    expect(availableInvoiceActions(I.ISSUED)).toEqual(both);
    expect(availableInvoiceActions(I.OVERDUE)).toEqual(both);
    expect(availableInvoiceActions(I.OVERDUE, { hasActivePayments: false })).toEqual(both);
  });

  it("an invoice with a payment on it offers to record another or to void a payment, not to void the invoice", () => {
    const withPayments = { hasActivePayments: true };
    const expected = [InvoiceAction.RECORD_PAYMENT, InvoiceAction.VOID_PAYMENT];
    expect(availableInvoiceActions(I.OVERDUE, withPayments)).toEqual(expected);
    expect(availableInvoiceActions(I.ISSUED, withPayments)).toEqual(expected);
    expect(availableInvoiceActions(I.PARTIALLY_PAID, withPayments)).toEqual(expected);
  });

  it("a paid invoice offers only the voiding of a payment; a void invoice nothing", () => {
    expect(availableInvoiceActions(I.PAID, { hasActivePayments: true })).toEqual([
      InvoiceAction.VOID_PAYMENT,
    ]);
    expect(availableInvoiceActions(I.PAID)).toEqual([]);
    expect(availableInvoiceActions(I.VOID)).toEqual([]);
    expect(availableInvoiceActions(I.VOID, { hasActivePayments: true })).toEqual([]);
  });

  it("agrees with the transition table: an action is offered only where its transition exists", () => {
    for (const status of Object.values(I)) {
      for (const action of availableInvoiceActions(status)) {
        const allowed = INVOICE_TRANSITIONS.some(
          (transition) => transition.from === status && transition.action === action,
        );
        // EDIT changes no status and the payment actions are the PAYMENT trigger's, so they have no row of their own.
        expect(
          action === InvoiceAction.EDIT ||
            action === InvoiceAction.RECORD_PAYMENT ||
            action === InvoiceAction.VOID_PAYMENT ||
            allowed,
        ).toBe(true);
      }
    }
  });
});

describe("dates for a new draft and for issuing", () => {
  it("defaultDueDate is today in the business zone plus the configured days", () => {
    // 02:00 UTC on the 11th is still the 10th in New York.
    expect(defaultDueDate(new Date("2026-11-11T02:00:00Z"), NY, 14)).toBe("2026-11-24");
    expect(defaultDueDate(new Date("2026-11-11T02:00:00Z"), "Asia/Tokyo", 14)).toBe("2026-11-25");
    expect(defaultDueDate(new Date("2026-11-10T12:00:00Z"), NY, 0)).toBe("2026-11-10");
  });

  it("defaultDueDate crosses a month and a year end", () => {
    expect(defaultDueDate(new Date("2026-12-24T12:00:00Z"), NY, 14)).toBe("2027-01-07");
  });

  it("effectiveIssueDate is the saved date, or today on the business's calendar", () => {
    expect(effectiveIssueDate("2026-11-02", new Date("2026-11-10T12:00:00Z"), NY)).toBe(
      "2026-11-02",
    );
    expect(effectiveIssueDate(null, new Date("2026-11-11T02:00:00Z"), NY)).toBe("2026-11-10");
  });
});

describe("issueProblems", () => {
  const ok = {
    lineCount: 1,
    totalAmount: "100.00",
    issueDate: "2026-11-10",
    dueDate: "2026-11-24",
  };

  it("is empty for a draft that can go", () => {
    expect(issueProblems(ok)).toEqual({});
    expect(issueProblems({ ...ok, dueDate: "2026-11-10" })).toEqual({}); // due the day it is issued
  });

  it("names each problem against its field", () => {
    expect(issueProblems({ ...ok, lineCount: 0 })).toEqual({ lines: ISSUE_NEEDS_LINES_MESSAGE });
    expect(issueProblems({ ...ok, totalAmount: "0.00" })).toEqual({
      totalAmount: ISSUE_NEEDS_TOTAL_MESSAGE,
    });
    expect(issueProblems({ ...ok, dueDate: "2026-11-09" })).toEqual({
      dueDate: DUE_BEFORE_ISSUE_MESSAGE,
    });
  });

  it("reports all of them together", () => {
    expect(
      Object.keys(
        issueProblems({
          lineCount: 0,
          totalAmount: "0.00",
          issueDate: "2026-11-10",
          dueDate: "2026-01-01",
        }),
      ).sort(),
    ).toEqual(["dueDate", "lines", "totalAmount"]);
  });
});

describe("the words of the history and the notifications", () => {
  const actor = { kind: "staff", name: "Morgan Reyes" } as const;

  it("fit the activity limits and end with a full stop", () => {
    const longNumber = "INV-2026-00001";
    const texts = [
      createdTexts({ jobReference: "JOB-2026-00001" }),
      issuedTexts({ invoiceNumber: longNumber, customerName: "A".repeat(100) }),
      voidedTexts({ invoiceNumber: longNumber, wasIssued: true }),
      voidedTexts({ invoiceNumber: null, wasIssued: false }),
      overdueTexts({ invoiceNumber: longNumber }),
    ];
    for (const text of texts) {
      const built = buildActivitySummaries({ actor, ...text });
      expect(built.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
      expect(built.summary.endsWith(".")).toBe(true);
      if (built.publicSummary !== null) {
        expect(built.publicSummary.length).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
      }
    }
  });

  it("a created draft and a voided draft are staff-only; an issued and a voided issued invoice are public", () => {
    expect(
      buildActivitySummaries({ actor, ...createdTexts({ jobReference: "J" }) }).publicSummary,
    ).toBeNull();
    expect(
      buildActivitySummaries({ actor, ...voidedTexts({ invoiceNumber: null, wasIssued: false }) })
        .publicSummary,
    ).toBeNull();
    expect(
      buildActivitySummaries({
        actor,
        ...issuedTexts({ invoiceNumber: "INV-2026-00001", customerName: "Alex" }),
      }).publicSummary,
    ).toBe("We issued invoice INV-2026-00001.");
    expect(
      buildActivitySummaries({
        actor,
        ...voidedTexts({ invoiceNumber: "INV-2026-00001", wasIssued: true }),
      }).publicSummary,
    ).toBe("We voided invoice INV-2026-00001.");
  });

  it("the customer's notifications carry the number and the service and nothing internal", () => {
    const issued = issuedNotification({
      invoiceNumber: "INV-2026-00001",
      serviceName: "AC Repair",
    });
    expect(issued.title).toBe("Invoice INV-2026-00001 is ready");
    expect(issued.message).toContain("AC Repair");
    const voided = voidedNotification({
      invoiceNumber: "INV-2026-00001",
      serviceName: "AC Repair",
    });
    expect(voided.title).toBe("Invoice INV-2026-00001 was voided");
    expect(voided.message).toContain("do not need to pay");
    // The internal reason is not an input of either function, so it cannot appear in them.
    expect(voidedNotification.length).toBe(1);
    expect(issuedNotification.length).toBe(1);
  });
});
