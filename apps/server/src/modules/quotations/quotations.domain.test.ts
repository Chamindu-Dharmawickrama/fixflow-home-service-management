import { ErrorCode, QuotationAction, QuotationStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import type { AppError } from "../../lib/errors.js";
import {
  NOTIFICATION_MESSAGE_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
} from "../notifications/notifications.domain.js";
import {
  assertQuotationTransition,
  availableQuotationActions,
  canTransitionQuotation,
  createdTexts,
  decisionNotification,
  decisionTexts,
  defaultValidUntil,
  effectiveQuotationStatus,
  expiredTexts,
  expiryInstant,
  isPastValidity,
  notEditableError,
  QUOTATION_TRANSITIONS,
  quotationNotAvailableError,
  QuotationTrigger,
  requestDecidedTexts,
  sendProblems,
  sentNotification,
  sentTexts,
  staleQuotationError,
  starterLine,
  voidedTexts,
  withdrawnNotification,
} from "./quotations.domain.js";

const STATUSES = Object.values(QuotationStatus);
const TRIGGERS = Object.values(QuotationTrigger);
const NEW_YORK = "America/New_York";

/**
 * D-22 written out by hand, one line per allowed change. The test compares every possible pair with
 * THIS list, not with `QUOTATION_TRANSITIONS`, so a slip in the map cannot also be a slip in the test.
 */
const ALLOWED: ReadonlyArray<readonly [QuotationStatus, QuotationStatus, QuotationTrigger]> = [
  ["DRAFT", "SENT", "ADMIN"],
  ["DRAFT", "VOID", "ADMIN"],
  ["SENT", "VOID", "ADMIN"],
  ["SENT", "ACCEPTED", "CUSTOMER"],
  ["SENT", "DECLINED", "CUSTOMER"],
  ["SENT", "EXPIRED", "SYSTEM"],
];

describe("the quotation transition map (D-22)", () => {
  it("allows exactly the changes D-22 lists, for exactly the trigger it names", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const trigger of TRIGGERS) {
          const expected = ALLOWED.some(([f, t, g]) => f === from && t === to && g === trigger);
          expect(canTransitionQuotation(from, to, trigger), `${from} → ${to} by ${trigger}`).toBe(
            expected,
          );
        }
      }
    }
    expect(QUOTATION_TRANSITIONS).toHaveLength(ALLOWED.length);
  });

  it("gives ACCEPTED, DECLINED, EXPIRED and VOID no way out", () => {
    for (const closed of ["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const) {
      for (const to of STATUSES) {
        for (const trigger of TRIGGERS) {
          expect(canTransitionQuotation(closed, to, trigger)).toBe(false);
        }
      }
    }
  });

  it("never lets an admin accept, decline or expire a quotation by hand", () => {
    for (const to of ["ACCEPTED", "DECLINED", "EXPIRED"] as const) {
      expect(canTransitionQuotation("SENT", to, "ADMIN")).toBe(false);
    }
  });

  it("never lets a sent quotation go back to a draft", () => {
    for (const trigger of TRIGGERS) {
      expect(canTransitionQuotation("SENT", "DRAFT", trigger)).toBe(false);
    }
  });

  it("refuses a disallowed change with 409 INVALID_STATE_TRANSITION and says why", () => {
    const refused = (from: QuotationStatus, to: QuotationStatus, trigger: QuotationTrigger) => {
      try {
        assertQuotationTransition(from, to, trigger);
      } catch (error) {
        return error as AppError;
      }
      throw new Error("expected a refusal");
    };

    const closed = refused("VOID", "SENT", "ADMIN");
    expect(closed.status).toBe(409);
    expect(closed.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect(closed.message).toBe("This quotation is void, so it can no longer be changed.");
    expect(closed.details).toEqual({ currentStatus: "VOID", requestedStatus: "SENT" });

    expect(refused("SENT", "ACCEPTED", "ADMIN").message).toBe(
      "That change happens when the customer answers or the quotation expires.",
    );
    expect(refused("SENT", "SENT", "ADMIN").message).toBe("This quotation is already sent.");
    expect(refused("DRAFT", "ACCEPTED", "ADMIN").message).toBe(
      "A quotation that is draft cannot be moved to accepted.",
    );
    expect(() => {
      assertQuotationTransition("DRAFT", "SENT", "ADMIN");
    }).not.toThrow();
  });

  it("describes a stale quotation and one that can't be edited", () => {
    const stale = staleQuotationError("SENT");
    expect(stale.status).toBe(409);
    expect(stale.code).toBe(ErrorCode.STALE_STATE);
    expect(stale.details).toEqual({ currentStatus: "SENT" });

    const sent = notEditableError("SENT");
    expect(sent.status).toBe(409);
    expect(sent.code).toBe(ErrorCode.QUOTATION_NOT_EDITABLE);
    expect(sent.message).toBe(
      "A sent quotation can't be edited. Replace it with a new draft instead.",
    );
    expect(notEditableError("VOID").message).toBe("This quotation is void, so it can't be edited.");
  });
});

describe("expiry in the business time zone (D-22, D-23)", () => {
  const sent = { status: QuotationStatus.SENT, validUntil: "2026-11-17" };

  it("is still valid at 23:59:59 on the last day and expired a second later", () => {
    // New York is UTC-5 on 17 November 2026 (the clocks went back on 1 November).
    expect(effectiveQuotationStatus(sent, new Date("2026-11-18T04:59:59.000Z"), NEW_YORK)).toBe(
      "SENT",
    );
    expect(effectiveQuotationStatus(sent, new Date("2026-11-18T05:00:00.000Z"), NEW_YORK)).toBe(
      "EXPIRED",
    );
  });

  it("is still valid when UTC is already the next day but the business is still on the last day", () => {
    // 22:30 in New York on the 17th is 03:30 UTC on the 18th.
    const now = new Date("2026-11-18T03:30:00.000Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-18");
    expect(isPastValidity("2026-11-17", now, NEW_YORK)).toBe(false);
    expect(effectiveQuotationStatus(sent, now, NEW_YORK)).toBe("SENT");
    // Judged by UTC alone it would have expired hours ago: that is the bug this guards.
    expect(isPastValidity("2026-11-17", now, "UTC")).toBe(true);
  });

  it("is valid all through the last day, from its first minute", () => {
    expect(effectiveQuotationStatus(sent, new Date("2026-11-17T05:00:00.000Z"), NEW_YORK)).toBe(
      "SENT",
    );
    expect(effectiveQuotationStatus(sent, new Date("2026-11-01T12:00:00.000Z"), NEW_YORK)).toBe(
      "SENT",
    );
  });

  it("follows a business ahead of UTC too", () => {
    // Tokyo is UTC+9: 14:59:59 UTC on the 17th is 23:59:59 in Tokyo.
    expect(effectiveQuotationStatus(sent, new Date("2026-11-17T14:59:59.000Z"), "Asia/Tokyo")).toBe(
      "SENT",
    );
    expect(effectiveQuotationStatus(sent, new Date("2026-11-17T15:00:00.000Z"), "Asia/Tokyo")).toBe(
      "EXPIRED",
    );
  });

  it("treats a day on which the clocks change as one day", () => {
    // New York fell back on 1 November 2026: that day has 25 hours, and 23:59:59 local is 04:59:59 UTC the next day.
    const dst = { status: QuotationStatus.SENT, validUntil: "2026-11-01" };
    expect(effectiveQuotationStatus(dst, new Date("2026-11-02T04:59:59.000Z"), NEW_YORK)).toBe(
      "SENT",
    );
    expect(effectiveQuotationStatus(dst, new Date("2026-11-02T05:00:00.000Z"), NEW_YORK)).toBe(
      "EXPIRED",
    );
  });

  it("only ever turns a SENT quotation into EXPIRED; every other status is as stored", () => {
    const later = new Date("2027-01-01T00:00:00.000Z");
    for (const status of STATUSES) {
      expect(effectiveQuotationStatus({ status, validUntil: "2026-11-17" }, later, NEW_YORK)).toBe(
        status === "SENT" ? "EXPIRED" : status,
      );
    }
  });

  it("records the expiry at the start of the day after the last day, whenever the sync runs", () => {
    expect(expiryInstant("2026-11-17", NEW_YORK).toISOString()).toBe("2026-11-18T05:00:00.000Z");
    expect(expiryInstant("2026-11-17", "UTC").toISOString()).toBe("2026-11-18T00:00:00.000Z");
    // Month and year ends are plain calendar arithmetic.
    expect(expiryInstant("2026-12-31", "UTC").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("starts a new draft's validity from the business's today", () => {
    // 22:30 in New York on 17 November is already the 18th in UTC: the default counts from the 17th.
    expect(defaultValidUntil(new Date("2026-11-18T03:30:00.000Z"), NEW_YORK, 14)).toBe(
      "2026-12-01",
    );
    expect(defaultValidUntil(new Date("2026-11-18T03:30:00.000Z"), "UTC", 14)).toBe("2026-12-02");
  });
});

describe("availableQuotationActions (D-43)", () => {
  it("offers a draft to be edited, sent or voided, with sending before voiding", () => {
    expect(availableQuotationActions("DRAFT")).toEqual(["EDIT", "SEND", "VOID"]);
  });

  it("offers a sent quotation to be replaced or voided, and never edited", () => {
    expect(availableQuotationActions("SENT")).toEqual(["REPLACE", "VOID"]);
    expect(availableQuotationActions("SENT")).not.toContain(QuotationAction.EDIT);
  });

  it("stops offering a replacement while the request already has a draft", () => {
    expect(availableQuotationActions("SENT", { requestHasDraft: true })).toEqual(["VOID"]);
    // A draft's own actions do not depend on it.
    expect(availableQuotationActions("DRAFT", { requestHasDraft: true })).toEqual([
      "EDIT",
      "SEND",
      "VOID",
    ]);
  });

  it("offers nothing on an answered, expired or voided quotation", () => {
    for (const status of ["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const) {
      expect(availableQuotationActions(status)).toEqual([]);
    }
  });
});

describe("sendProblems (D-22)", () => {
  const today = "2026-11-10";
  const ready = { lineCount: 2, totalAmount: "255.64", validUntil: "2026-11-24" };

  it("finds nothing wrong with a draft that has lines, a total and a date ahead", () => {
    expect(sendProblems(ready, today)).toEqual({});
  });

  it("accepts a last day of today", () => {
    expect(sendProblems({ ...ready, validUntil: today }, today)).toEqual({});
  });

  it("names the date when it is already behind us", () => {
    expect(Object.keys(sendProblems({ ...ready, validUntil: "2026-11-09" }, today))).toEqual([
      "validUntil",
    ]);
  });

  it("names the total when it is zero", () => {
    expect(Object.keys(sendProblems({ ...ready, totalAmount: "0.00" }, today))).toEqual([
      "totalAmount",
    ]);
  });

  it("names the lines when there are none, and reports every problem together", () => {
    expect(
      Object.keys(
        sendProblems({ lineCount: 0, totalAmount: "0.00", validUntil: "2026-01-01" }, today),
      ).sort(),
    ).toEqual(["lines", "totalAmount", "validUntil"]);
  });
});

describe("starterLine", () => {
  it("starts at the service's price when it has one fixed price", () => {
    expect(
      starterLine({
        serviceName: "AC Diagnostic Visit",
        pricingMode: "FIXED",
        startingPrice: "79.00",
      }),
    ).toEqual({
      description: "AC Diagnostic Visit",
      quantity: "1",
      unitPrice: "79.00",
      taxable: true,
    });
  });

  it("starts at zero when the service is quoted on request", () => {
    expect(
      starterLine({
        serviceName: "Deep Cleaning",
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: null,
      }).unitPrice,
    ).toBe("0.00");
    // A price that is only a leftover on a quote-required service is not used.
    expect(
      starterLine({
        serviceName: "Deep Cleaning",
        pricingMode: "QUOTE_REQUIRED",
        startingPrice: "120.00",
      }).unitPrice,
    ).toBe("0.00");
  });

  it("starts at zero rather than invent a price when a fixed price is missing", () => {
    expect(
      starterLine({ serviceName: "X service", pricingMode: "FIXED", startingPrice: null })
        .unitPrice,
    ).toBe("0.00");
  });
});

describe("the words of the history and the notifications", () => {
  it("keeps a draft internal and tells the customer when a quotation is sent", () => {
    expect(
      createdTexts({
        reference: "QT-2026-00004",
        requestReference: "FF-2026-00009",
        replacesReference: null,
      }),
    ).toEqual({
      staff: "created draft quotation QT-2026-00004 for request FF-2026-00009",
    });
    expect(
      createdTexts({
        reference: "QT-2026-00005",
        requestReference: "FF-2026-00009",
        replacesReference: "QT-2026-00004",
      }).customer,
    ).toBeUndefined();

    expect(
      sentTexts({
        reference: "QT-2026-00004",
        customerName: "Alex Morgan",
        replacesReference: null,
      }),
    ).toEqual({
      staff: "sent quotation QT-2026-00004 to Alex Morgan",
      customer: "sent you quotation QT-2026-00004",
    });
    expect(
      sentTexts({
        reference: "QT-2026-00005",
        customerName: "Alex Morgan",
        replacesReference: "QT-2026-00004",
      }).customer,
    ).toBe("sent you quotation QT-2026-00005, which replaces QT-2026-00004");
  });

  it("shows the customer a voided quotation only if they had been sent it", () => {
    expect(voidedTexts({ reference: "QT-1", wasSent: false, replacedByReference: null })).toEqual({
      staff: "voided draft quotation QT-1",
    });
    expect(voidedTexts({ reference: "QT-1", wasSent: true, replacedByReference: null })).toEqual({
      staff: "voided quotation QT-1",
      customer: "withdrew quotation QT-1",
    });
    expect(voidedTexts({ reference: "QT-1", wasSent: true, replacedByReference: "QT-2" })).toEqual({
      staff: "voided quotation QT-1 because QT-2 replaces it",
      customer: "replaced quotation QT-1 with QT-2",
    });
  });

  it("leaves a cancellation's voided quotations to the cancellation's own customer event", () => {
    const texts = voidedTexts({
      reference: "QT-1",
      wasSent: true,
      replacedByReference: null,
      requestCancelled: true,
    });
    expect(texts.customer).toBeUndefined();
    expect(texts.staff).toBe("voided quotation QT-1 because the request was cancelled");
  });

  it("words the expiry for staff and customer", () => {
    expect(expiredTexts({ reference: "QT-1" })).toEqual({
      staff: "marked quotation QT-1 as expired because its valid-until date passed",
      customer: "marked quotation QT-1 as expired",
    });
  });

  it("notifies the customer of a sent quotation without the price", () => {
    const texts = sentNotification({ reference: "QT-1", serviceName: "AC Diagnostic Visit" });
    expect(texts.title).toBe("Quotation QT-1 is ready");
    expect(texts.message).toContain("AC Diagnostic Visit");
  });

  it("tells the customer about a withdrawal in the business's words, or a standard line", () => {
    expect(
      withdrawnNotification({
        reference: "QT-1",
        serviceName: "AC Diagnostic Visit",
        customerMessage: "  We priced the wrong unit. A corrected quote is coming.  ",
      }).message,
    ).toBe("We priced the wrong unit. A corrected quote is coming.");
    for (const customerMessage of [undefined, "", "   "]) {
      expect(
        withdrawnNotification({
          reference: "QT-1",
          serviceName: "AC Diagnostic Visit",
          customerMessage,
        }),
      ).toEqual({
        title: "Quotation QT-1 was withdrawn",
        message: "We withdrew the quotation for AC Diagnostic Visit. It can no longer be accepted.",
      });
    }
  });
});

describe("the customer's answer (T15)", () => {
  const ANSWERED_AT = new Date("2026-11-03T15:30:00.000Z");

  function refusal(
    status: QuotationStatus,
    decision: "ACCEPTED" | "DECLINED",
    respondedAt: Date | null = ANSWERED_AT,
  ): AppError {
    return quotationNotAvailableError({
      status,
      decision,
      validUntil: "2026-11-17",
      respondedAt,
      timeZone: NEW_YORK,
    });
  }

  it("refuses with 409 QUOTATION_NOT_AVAILABLE and says which status it is now", () => {
    for (const status of ["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const) {
      const error = refusal(status, "ACCEPTED");
      expect(error.status).toBe(409);
      expect(error.code).toBe(ErrorCode.QUOTATION_NOT_AVAILABLE);
      expect(error.details).toEqual({ currentStatus: status });
    }
  });

  it("gives each status its own words, and the day it was answered in the business's calendar", () => {
    expect(refusal("ACCEPTED", "ACCEPTED").message).toBe(
      "You already accepted this quotation on Nov 3, 2026. There is nothing more to do: we'll contact you to schedule the work.",
    );
    expect(refusal("ACCEPTED", "DECLINED").message).toBe(
      "You already accepted this quotation on Nov 3, 2026, so it can't be declined now. Contact us if you need to change anything.",
    );
    expect(refusal("DECLINED", "DECLINED").message).toBe(
      "You already declined this quotation on Nov 3, 2026.",
    );
    expect(refusal("DECLINED", "ACCEPTED").message).toBe(
      "You declined this quotation on Nov 3, 2026, so it can't be accepted now. Contact us and we'll send a new quotation if you'd like one.",
    );
    expect(refusal("EXPIRED", "ACCEPTED").message).toBe(
      "This quotation was valid until Nov 17, 2026 and has expired. Contact us and we'll send an updated quotation.",
    );
    expect(refusal("VOID", "ACCEPTED").message).toBe(
      "This quotation was withdrawn, so you can't accept it. Check your request for an updated quotation, or contact us.",
    );
    expect(refusal("VOID", "DECLINED").message).toContain("you can't decline it");
  });

  it("reads the day an answer was given on the business calendar, not UTC", () => {
    // 02:00 UTC on 4 November is still the evening of the 3rd in New York.
    const error = refusal("ACCEPTED", "ACCEPTED", new Date("2026-11-04T02:00:00.000Z"));
    expect(error.message).toContain("on Nov 3, 2026");
  });

  it("leaves the day out when there is none to give", () => {
    expect(refusal("ACCEPTED", "ACCEPTED", null).message).toMatch(
      /^You already accepted this quotation\. /,
    );
  });

  it("never reveals the business's side: no internal word is in any refusal", () => {
    for (const status of ["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const) {
      for (const decision of ["ACCEPTED", "DECLINED"] as const) {
        expect(refusal(status, decision).message).not.toMatch(/internal|margin|admin/i);
      }
    }
  });

  it("writes the event as the customer: 'You accepted' to them, the customer's name to staff", () => {
    expect(decisionTexts({ reference: "QT-1", decision: "ACCEPTED" })).toEqual({
      staff: "accepted quotation QT-1",
      customer: "accepted quotation QT-1",
    });
    expect(decisionTexts({ reference: "QT-1", decision: "DECLINED" })).toEqual({
      staff: "declined quotation QT-1",
      customer: "declined quotation QT-1",
    });
  });

  it("keeps the request's own event for staff only", () => {
    expect(requestDecidedTexts({ requestReference: "FF-1", decision: "ACCEPTED" })).toEqual({
      staff: "moved request FF-1 to accepted: the customer answered the quotation",
    });
    expect(requestDecidedTexts({ requestReference: "FF-1", decision: "DECLINED" }).staff).toContain(
      "to declined",
    );
  });

  it("tells the admins what was decided, without the price or the customer's reason", () => {
    expect(
      decisionNotification({
        reference: "QT-1",
        customerName: "Alex Morgan",
        serviceName: "AC Repair",
        decision: "ACCEPTED",
      }),
    ).toEqual({
      title: "Quotation QT-1 accepted",
      message:
        "Alex Morgan accepted the quotation for AC Repair. The request is ready to be scheduled.",
    });
    const declined = decisionNotification({
      reference: "QT-1",
      customerName: "Alex Morgan",
      serviceName: "AC Repair",
      decision: "DECLINED",
    });
    expect(declined.title).toBe("Quotation QT-1 declined");
    expect(declined.message).toContain("No work will be scheduled");
  });

  it("fits a notification even with the longest name and service the business allows", () => {
    for (const decision of ["ACCEPTED", "DECLINED"] as const) {
      const texts = decisionNotification({
        reference: "QT-2026-00001",
        customerName: "N".repeat(80),
        serviceName: "S".repeat(80),
        decision,
      });
      expect(texts.title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX_LENGTH);
      expect(texts.message.length).toBeLessThanOrEqual(NOTIFICATION_MESSAGE_MAX_LENGTH);
    }
  });
});
