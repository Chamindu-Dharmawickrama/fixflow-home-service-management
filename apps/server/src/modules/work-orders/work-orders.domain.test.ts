import { ErrorCode, SCHEDULE_RULES, WorkOrderAction, WorkOrderStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { isAppError } from "../../lib/errors.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { MAX_PUBLIC_SUMMARY_LENGTH, MAX_SUMMARY_LENGTH } from "../activity/activity.service.js";
import {
  assertWorkOrderAction,
  availableWorkOrderActions,
  buildScopeDescription,
  canPerformWorkOrderAction,
  conversionTexts,
  invalidWorkOrderAction,
  overlaps,
  SCHEDULE_END_AFTER_START_MESSAGE,
  SCHEDULE_IN_THE_PAST_MESSAGE,
  SCHEDULE_TOO_LONG_MESSAGE,
  scheduleActionFor,
  scheduledRange,
  scheduleNotification,
  scheduleTexts,
  schedulingConflictError,
  staleWorkOrderError,
  startsBeforeSchedule,
  technicianInactiveError,
  transitionNotification,
  transitionTexts,
  validateSchedule,
  WORK_ORDER_ACTION_TARGET,
  WORK_ORDER_TRANSITIONS,
} from "./work-orders.domain.js";

const S = WorkOrderStatus;
const A = WorkOrderAction;
const NEW_YORK = "America/New_York";

/** An interval from "HH:mm" to "HH:mm" on 3 March 2026, UTC (the date does not matter to the rule). */
function at(from: string, to: string) {
  return {
    start: new Date(`2026-03-03T${from}:00.000Z`),
    end: new Date(`2026-03-03T${to}:00.000Z`),
  };
}

describe("overlaps (half-open intervals)", () => {
  it("is false for appointments that touch: one ends the moment the next starts", () => {
    expect(overlaps(at("10:00", "12:00"), at("12:00", "14:00"))).toBe(false);
    expect(overlaps(at("12:00", "14:00"), at("10:00", "12:00"))).toBe(false);
  });

  it("is true when one is inside the other", () => {
    expect(overlaps(at("09:00", "17:00"), at("10:00", "12:00"))).toBe(true);
    expect(overlaps(at("10:00", "12:00"), at("09:00", "17:00"))).toBe(true);
  });

  it("is true for identical intervals", () => {
    expect(overlaps(at("10:00", "12:00"), at("10:00", "12:00"))).toBe(true);
  });

  it("is true when they cross, from either side", () => {
    expect(overlaps(at("10:00", "12:00"), at("11:00", "13:00"))).toBe(true);
    expect(overlaps(at("11:00", "13:00"), at("10:00", "12:00"))).toBe(true);
  });

  it("is true for a single millisecond of shared time, and false for none", () => {
    const first = { start: new Date(0), end: new Date(1000) };
    expect(overlaps(first, { start: new Date(999), end: new Date(2000) })).toBe(true);
    expect(overlaps(first, { start: new Date(1000), end: new Date(2000) })).toBe(false);
  });

  it("is false for intervals that are apart", () => {
    expect(overlaps(at("08:00", "09:00"), at("10:00", "12:00"))).toBe(false);
    expect(overlaps(at("13:00", "14:00"), at("10:00", "12:00"))).toBe(false);
  });

  it("is the same whichever way round the two are given", () => {
    const pairs = [
      [at("10:00", "12:00"), at("12:00", "14:00")],
      [at("10:00", "12:00"), at("11:59", "14:00")],
      [at("10:00", "12:00"), at("10:00", "10:01")],
    ] as const;
    for (const [a, b] of pairs) {
      expect(overlaps(a, b)).toBe(overlaps(b, a));
    }
  });
});

describe("validateSchedule", () => {
  const now = new Date("2026-03-03T15:00:00.000Z");
  const minutes = (n: number) => n * 60_000;
  const after = (n: number) => new Date(now.getTime() + minutes(n));

  it("accepts an ordinary appointment", () => {
    expect(validateSchedule({ start: after(60), end: after(180), now })).toEqual({});
  });

  it("accepts a visit that starts right now", () => {
    expect(validateSchedule({ start: now, end: after(60), now })).toEqual({});
  });

  it("accepts a start exactly 15 minutes ago, and refuses one a millisecond earlier", () => {
    const grace = SCHEDULE_RULES.startGraceMinutes;
    expect(grace).toBe(15);
    const edge = after(-grace);
    expect(validateSchedule({ start: edge, end: after(60), now })).toEqual({});
    expect(validateSchedule({ start: new Date(edge.getTime() - 1), end: after(60), now })).toEqual({
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
    });
  });

  it("refuses a start in the past, whatever the end", () => {
    // A one-hour visit yesterday: only the start is wrong.
    expect(validateSchedule({ start: after(-24 * 60), end: after(-23 * 60), now })).toEqual({
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
    });
    // Stretched to reach into the future it is also too long; both problems are reported.
    expect(validateSchedule({ start: after(-24 * 60), end: after(60), now })).toEqual({
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
      scheduledEnd: SCHEDULE_TOO_LONG_MESSAGE,
    });
  });

  it("refuses an end that is not after the start", () => {
    expect(validateSchedule({ start: after(60), end: after(60), now })).toEqual({
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
    expect(validateSchedule({ start: after(60), end: after(30), now })).toEqual({
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
  });

  it("allows exactly 12 hours and refuses a millisecond more", () => {
    const start = after(60);
    const twelveHours = new Date(start.getTime() + minutes(12 * 60));
    expect(validateSchedule({ start, end: twelveHours, now })).toEqual({});
    expect(validateSchedule({ start, end: new Date(twelveHours.getTime() + 1), now })).toEqual({
      scheduledEnd: SCHEDULE_TOO_LONG_MESSAGE,
    });
  });

  it("says 12 hours in the message", () => {
    expect(SCHEDULE_TOO_LONG_MESSAGE).toContain("12 hours");
  });

  it("reports the start and the end together when both are wrong", () => {
    expect(validateSchedule({ start: after(-120), end: after(-180), now })).toEqual({
      scheduledStart: SCHEDULE_IN_THE_PAST_MESSAGE,
      scheduledEnd: SCHEDULE_END_AFTER_START_MESSAGE,
    });
  });
});

describe("the transition table (D-24)", () => {
  const allowed = new Set(
    WORK_ORDER_TRANSITIONS.map((transition) => `${transition.from}>${transition.to}`),
  );

  it("allows exactly the changes D-24 lists", () => {
    expect([...allowed].sort()).toEqual(
      [
        "PENDING_SCHEDULING>SCHEDULED",
        "NEEDS_RESCHEDULING>SCHEDULED",
        "SCHEDULED>SCHEDULED",
        "SCHEDULED>IN_PROGRESS",
        "SCHEDULED>NEEDS_RESCHEDULING",
        "IN_PROGRESS>NEEDS_RESCHEDULING",
        "IN_PROGRESS>COMPLETED",
        "PENDING_SCHEDULING>CANCELLED",
        "SCHEDULED>CANCELLED",
        "NEEDS_RESCHEDULING>CANCELLED",
      ].sort(),
    );
  });

  it("has no way out of a completed or a cancelled job", () => {
    for (const status of [S.COMPLETED, S.CANCELLED]) {
      expect(WORK_ORDER_TRANSITIONS.some((transition) => transition.from === status)).toBe(false);
      expect(availableWorkOrderActions(status)).toEqual([]);
    }
  });

  it("does not let a job in progress be cancelled: it is completed with a note instead", () => {
    expect(canPerformWorkOrderAction(S.IN_PROGRESS, A.CANCEL)).toBe(false);
    expect(allowed.has("IN_PROGRESS>CANCELLED")).toBe(false);
  });

  it("makes every action lead to the status its transitions lead to", () => {
    for (const transition of WORK_ORDER_TRANSITIONS) {
      expect(WORK_ORDER_ACTION_TARGET[transition.action]).toBe(transition.to);
    }
  });

  it("never lets a job go back to pending scheduling", () => {
    expect([...allowed].some((pair) => pair.endsWith(">PENDING_SCHEDULING"))).toBe(false);
  });
});

describe("availableWorkOrderActions (D-43)", () => {
  it.each([
    [S.PENDING_SCHEDULING, [A.SCHEDULE, A.CANCEL]],
    [S.NEEDS_RESCHEDULING, [A.SCHEDULE, A.CANCEL]],
    [S.SCHEDULED, [A.RESCHEDULE, A.START, A.MARK_NEEDS_RESCHEDULING, A.CANCEL]],
    [S.IN_PROGRESS, [A.COMPLETE, A.MARK_NEEDS_RESCHEDULING]],
    [S.COMPLETED, []],
    [S.CANCELLED, []],
  ])("lists, for %s, the actions in order of likelihood", (status, expected) => {
    expect(availableWorkOrderActions(status)).toEqual(expected);
  });

  it("offers Schedule to a job with no appointment and Reschedule to one that has one", () => {
    expect(scheduleActionFor(S.PENDING_SCHEDULING)).toBe(A.SCHEDULE);
    expect(scheduleActionFor(S.NEEDS_RESCHEDULING)).toBe(A.SCHEDULE);
    expect(scheduleActionFor(S.SCHEDULED)).toBe(A.RESCHEDULE);
    expect(scheduleActionFor(S.IN_PROGRESS)).toBeUndefined();
    expect(scheduleActionFor(S.COMPLETED)).toBeUndefined();
    expect(scheduleActionFor(S.CANCELLED)).toBeUndefined();
  });

  it("agrees with canPerformWorkOrderAction for every status and action", () => {
    for (const status of Object.values(S)) {
      for (const action of Object.values(A)) {
        expect(availableWorkOrderActions(status).includes(action)).toBe(
          canPerformWorkOrderAction(status, action),
        );
      }
    }
  });
});

describe("refusals", () => {
  it("assertWorkOrderAction passes for an allowed action and throws a 409 for another", () => {
    expect(() => assertWorkOrderAction(S.PENDING_SCHEDULING, A.SCHEDULE)).not.toThrow();
    try {
      assertWorkOrderAction(S.IN_PROGRESS, A.SCHEDULE);
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.status).toBe(409);
      expect(isAppError(error) && error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    }
  });

  it("says why, in words an admin can act on", () => {
    expect(invalidWorkOrderAction(S.IN_PROGRESS, A.RESCHEDULE).message).toBe(
      "A job that is in progress cannot be rescheduled.",
    );
    expect(invalidWorkOrderAction(S.COMPLETED, A.SCHEDULE).message).toBe(
      "This job is completed, so it can no longer be changed.",
    );
    expect(invalidWorkOrderAction(S.CANCELLED, A.SCHEDULE).message).toBe(
      "This job is cancelled, so it can no longer be changed.",
    );
  });

  it("carries the two statuses for the client", () => {
    expect(invalidWorkOrderAction(S.IN_PROGRESS, A.SCHEDULE).details).toEqual({
      currentStatus: S.IN_PROGRESS,
      requestedStatus: S.SCHEDULED,
    });
  });

  it("builds the stale-state error with the status the job has now", () => {
    const error = staleWorkOrderError(S.SCHEDULED);
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.STALE_STATE);
    expect(error.details).toEqual({ currentStatus: S.SCHEDULED });
  });
});

describe("schedulingConflictError", () => {
  const first = {
    id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    reference: "JOB-2026-00031",
    // 10:00 to 12:00 in New York on 3 March 2026 (UTC-5).
    start: new Date("2026-03-03T15:00:00.000Z"),
    end: new Date("2026-03-03T17:00:00.000Z"),
  };

  it("is a 409 that names the job and when it is, on the business's clocks", () => {
    const error = schedulingConflictError({
      technicianName: "Jordan Lee",
      conflicts: [first],
      timeZone: NEW_YORK,
    });
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.SCHEDULING_CONFLICT);
    expect(error.message).toBe(
      "Jordan Lee is already booked for JOB-2026-00031 on Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST. Choose another time or technician.",
    );
  });

  it("carries the first conflicting job for the client, and how many there are", () => {
    const error = schedulingConflictError({
      technicianName: "Jordan Lee",
      conflicts: [first, { ...first, id: "x", reference: "JOB-2026-00032" }],
      timeZone: NEW_YORK,
    });
    expect(error.details).toEqual({
      conflictJobId: first.id,
      conflictReference: "JOB-2026-00031",
      conflictStart: "2026-03-03T15:00:00.000Z",
      conflictEnd: "2026-03-03T17:00:00.000Z",
      conflictCount: 2,
    });
    expect(error.message).toContain("(and 1 more)");
  });
});

describe("technicianInactiveError", () => {
  it("is a 422 against the technician field", () => {
    const error = technicianInactiveError("Sam Ortiz");
    expect(error.status).toBe(422);
    expect(error.code).toBe(ErrorCode.TECHNICIAN_INACTIVE);
    expect(error.fieldErrors?.technicianId).toContain("Sam Ortiz is inactive");
  });
});

describe("buildScopeDescription", () => {
  it("is the customer's description followed by the agreed work, one line each", () => {
    expect(
      buildScopeDescription({
        requestDescription: "The outdoor unit hums and the house does not cool.",
        lineDescriptions: ["Diagnostic visit", "Replace run capacitor"],
      }),
    ).toBe(
      "The outdoor unit hums and the house does not cool.\n\nAgreed work:\n- Diagnostic visit\n- Replace run capacitor",
    );
  });

  it("is just the description when the quotation has no usable lines", () => {
    expect(
      buildScopeDescription({ requestDescription: "  Leaking gutter  ", lineDescriptions: [] }),
    ).toBe("Leaking gutter");
    expect(
      buildScopeDescription({ requestDescription: "Leaking gutter", lineDescriptions: ["  ", ""] }),
    ).toBe("Leaking gutter");
  });
});

describe("conversionTexts", () => {
  const texts = conversionTexts({
    jobReference: "JOB-2026-00007",
    requestReference: "FF-2026-00012",
    quotationReference: "QT-2026-00009",
  });

  it("tells the customer the job was created, and nothing internal", () => {
    expect(texts.job.customer).toBe("created job JOB-2026-00007 for your request");
    expect(texts.job.customer).not.toContain("QT-");
  });

  it("tells staff where the job came from", () => {
    expect(texts.job.staff).toBe(
      "created job JOB-2026-00007 from quotation QT-2026-00009 for request FF-2026-00012",
    );
    expect(texts.request.staff).toContain("FF-2026-00012");
  });
});

describe("scheduleTexts", () => {
  const start = new Date("2026-03-03T15:00:00.000Z");
  const end = new Date("2026-03-03T17:00:00.000Z");
  const previous = {
    start: new Date("2026-03-02T15:00:00.000Z"),
    end: new Date("2026-03-02T16:00:00.000Z"),
  };

  it("gives the customer the date and window of a first booking, and no technician", () => {
    const texts = scheduleTexts({
      kind: "scheduled",
      reference: "JOB-2026-00007",
      start,
      end,
      timeZone: NEW_YORK,
      technicianName: "Jordan Lee",
    });
    expect(texts.customer).toBe(
      "scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST",
    );
    expect(texts.staff).toContain("with Jordan Lee");
    expect(texts.customer).not.toContain("Jordan");
  });

  it("keeps the old and the new time and the reason for staff, and only the new time for the customer", () => {
    const texts = scheduleTexts({
      kind: "rescheduled",
      reference: "JOB-2026-00007",
      start,
      end,
      timeZone: NEW_YORK,
      technicianName: "Jordan Lee",
      previous,
      reason: "The part arrives a day late.",
    });
    expect(texts.staff).toContain("Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(texts.staff).toContain("was Mon, Mar 2, 2026, 10:00 – 11:00 AM EST");
    expect(texts.staff).toContain("Reason: The part arrives a day late.");
    expect(texts.customer).toBe("moved your visit to Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(texts.customer).not.toContain("part");
    expect(texts.customer).not.toContain("Jordan");
  });

  it("leaves a change of technician alone with staff: the customer sees no technician", () => {
    const texts = scheduleTexts({
      kind: "reassigned",
      reference: "JOB-2026-00007",
      start,
      end,
      timeZone: NEW_YORK,
      technicianName: "Sam Ortiz",
      previousTechnicianName: "Jordan Lee",
      reason: "Jordan is off sick.",
    });
    expect(texts.customer).toBeUndefined();
    expect(texts.staff).toContain("to Sam Ortiz (was Jordan Lee)");
  });

  it("always fits the activity limits, however long the names and the reason are", () => {
    const longName = "N".repeat(100);
    const reason = "r".repeat(SCHEDULE_RULES.rescheduleReasonMaxLength);
    for (const kind of ["scheduled", "rescheduled", "reassigned"] as const) {
      const { staff, customer } = scheduleTexts({
        kind,
        reference: "JOB-2026-00007",
        start,
        end,
        timeZone: NEW_YORK,
        technicianName: longName,
        previousTechnicianName: longName,
        previous,
        reason,
      });
      const built = buildActivitySummaries({
        actor: { kind: "staff", name: longName },
        staff,
        ...(customer !== undefined && { customer }),
      });
      expect(built.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
      expect((built.publicSummary ?? "").length).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
    }
  });

  it("builds the sentences the customer's timeline reads", () => {
    const built = buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      ...scheduleTexts({
        kind: "scheduled",
        reference: "JOB-2026-00007",
        start,
        end,
        timeZone: NEW_YORK,
        technicianName: "Jordan Lee",
      }),
    });
    expect(built.publicSummary).toBe(
      "We scheduled your visit for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    );
  });
});

describe("scheduleNotification", () => {
  const start = new Date("2026-03-03T15:00:00.000Z");
  const end = new Date("2026-03-03T17:00:00.000Z");

  it("says only the reference and the date and window", () => {
    expect(
      scheduleNotification({
        rescheduled: false,
        reference: "JOB-2026-00007",
        start,
        end,
        timeZone: NEW_YORK,
      }),
    ).toEqual({
      title: "Visit for JOB-2026-00007 scheduled",
      message: "Your visit is scheduled for Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    });
  });

  it("says moved for a reschedule", () => {
    const texts = scheduleNotification({
      rescheduled: true,
      reference: "JOB-2026-00007",
      start,
      end,
      timeZone: NEW_YORK,
    });
    expect(texts.title).toBe("Visit for JOB-2026-00007 rescheduled");
    expect(texts.message).toBe(
      "Your visit has moved to Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST.",
    );
  });

  it("stays inside the notification limits (120 and 300 characters)", () => {
    const texts = scheduleNotification({
      rescheduled: true,
      reference: "JOB-2026-99999",
      start: new Date("2026-12-31T23:30:00.000Z"),
      end: new Date("2027-01-01T11:30:00.000Z"),
      timeZone: NEW_YORK,
    });
    expect(texts.title.length).toBeLessThanOrEqual(120);
    expect(texts.message.length).toBeLessThanOrEqual(300);
  });
});

describe("scheduledRange (the list's date filter)", () => {
  it("is empty when no date is given", () => {
    expect(scheduledRange(undefined, undefined, NEW_YORK)).toEqual({});
  });

  it("starts at midnight on the first day and stops at midnight after the last, on the business's clocks", () => {
    const range = scheduledRange("2026-03-03", "2026-03-04", NEW_YORK);
    // 3 March 00:00 EST is 05:00 UTC; the end is 5 March 00:00 EST.
    expect(range.from?.toISOString()).toBe("2026-03-03T05:00:00.000Z");
    expect(range.before?.toISOString()).toBe("2026-03-05T05:00:00.000Z");
  });

  it("is inclusive of the last day: one day is a day long", () => {
    const range = scheduledRange("2026-03-03", "2026-03-03", NEW_YORK);
    expect((range.before?.getTime() ?? 0) - (range.from?.getTime() ?? 0)).toBe(24 * 3_600_000);
  });

  it("is 23 hours on the day the clocks go forward", () => {
    const range = scheduledRange("2026-03-08", "2026-03-08", NEW_YORK);
    expect((range.before?.getTime() ?? 0) - (range.from?.getTime() ?? 0)).toBe(23 * 3_600_000);
  });

  it("can be open at either end", () => {
    expect(scheduledRange("2026-03-03", undefined, NEW_YORK)).toEqual({
      from: new Date("2026-03-03T05:00:00.000Z"),
    });
    expect(scheduledRange(undefined, "2026-03-03", NEW_YORK)).toEqual({
      before: new Date("2026-03-04T05:00:00.000Z"),
    });
  });
});

describe("every status against every action (D-24, the whole table)", () => {
  // The rows are the statuses, the columns the actions. Anything not listed is refused with 409.
  const MATRIX: Record<WorkOrderStatus, readonly WorkOrderAction[]> = {
    [S.PENDING_SCHEDULING]: [A.SCHEDULE, A.CANCEL],
    [S.NEEDS_RESCHEDULING]: [A.SCHEDULE, A.CANCEL],
    [S.SCHEDULED]: [A.RESCHEDULE, A.START, A.MARK_NEEDS_RESCHEDULING, A.CANCEL],
    [S.IN_PROGRESS]: [A.COMPLETE, A.MARK_NEEDS_RESCHEDULING],
    [S.COMPLETED]: [],
    [S.CANCELLED]: [],
  };

  const pairs = Object.values(S).flatMap((status) =>
    Object.values(A).map((action) => ({
      status,
      action,
      allowed: MATRIX[status].includes(action),
    })),
  );

  it("covers all 36 pairs, ten of them allowed", () => {
    expect(pairs).toHaveLength(36);
    expect(pairs.filter((pair) => pair.allowed)).toHaveLength(10);
  });

  it.each(pairs)("$action from $status is allowed: $allowed", ({ status, action, allowed }) => {
    expect(canPerformWorkOrderAction(status, action)).toBe(allowed);
    expect(availableWorkOrderActions(status).includes(action)).toBe(allowed);
    if (allowed) {
      expect(() => assertWorkOrderAction(status, action)).not.toThrow();
    } else {
      try {
        assertWorkOrderAction(status, action);
        expect.unreachable();
      } catch (error) {
        expect(isAppError(error) && error.status).toBe(409);
        expect(isAppError(error) && error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      }
    }
  });

  it("never lets a job jump to completed without being started (spec 6.4)", () => {
    expect(canPerformWorkOrderAction(S.PENDING_SCHEDULING, A.COMPLETE)).toBe(false);
    expect(canPerformWorkOrderAction(S.SCHEDULED, A.COMPLETE)).toBe(false);
    expect(canPerformWorkOrderAction(S.NEEDS_RESCHEDULING, A.COMPLETE)).toBe(false);
  });

  it("only lets a job be started from scheduled, and completed from in progress", () => {
    const startable = Object.values(S).filter((status) =>
      canPerformWorkOrderAction(status, A.START),
    );
    const completable = Object.values(S).filter((status) =>
      canPerformWorkOrderAction(status, A.COMPLETE),
    );
    expect(startable).toEqual([S.SCHEDULED]);
    expect(completable).toEqual([S.IN_PROGRESS]);
  });
});

describe("startsBeforeSchedule", () => {
  const start = new Date("2026-03-03T15:00:00.000Z");

  it("is true before the scheduled start and false from that moment on", () => {
    expect(startsBeforeSchedule(start, new Date("2026-03-03T14:59:59.999Z"))).toBe(true);
    expect(startsBeforeSchedule(start, new Date("2026-03-03T15:00:00.000Z"))).toBe(false);
    expect(startsBeforeSchedule(start, new Date("2026-03-03T15:30:00.000Z"))).toBe(false);
  });

  it("is false for a job with no appointment, which cannot be early", () => {
    expect(startsBeforeSchedule(null, new Date("2026-03-03T10:00:00.000Z"))).toBe(false);
  });
});

describe("transitionTexts", () => {
  const previous = at("15:00", "17:00");
  const REASON = "The part will not arrive before Friday, so the visit cannot go ahead.";
  const lifecycleActions = [A.START, A.MARK_NEEDS_RESCHEDULING, A.COMPLETE, A.CANCEL] as const;

  it("tells the customer one fixed sentence per action, with no reason in it", () => {
    for (const action of lifecycleActions) {
      const texts = transitionTexts({
        action,
        reference: "JOB-2026-00042",
        timeZone: NEW_YORK,
        previous,
        reason: REASON,
        messageSent: true,
      });
      expect(texts.customer).not.toContain("part");
      expect(texts.customer).not.toContain("Friday");
      expect(texts.customer).not.toContain("JOB-");
      expect(texts.customer.length).toBeGreaterThan(10);
    }
  });

  it("builds the sentences the customer's timeline reads", () => {
    const customerLine = (action: (typeof lifecycleActions)[number]) =>
      buildActivitySummaries({
        actor: { kind: "staff", name: "Morgan Reyes" },
        ...transitionTexts({ action, reference: "JOB-2026-00042", timeZone: NEW_YORK }),
      }).publicSummary;
    expect(customerLine(A.START)).toBe("We started work on your job.");
    expect(customerLine(A.MARK_NEEDS_RESCHEDULING)).toBe(
      "We need to find a new time for your visit.",
    );
    expect(customerLine(A.COMPLETE)).toBe("We marked your job as complete.");
    expect(customerLine(A.CANCEL)).toBe("We cancelled your job.");
  });

  it("gives staff the reason, the old time and that a message was sent", () => {
    const needs = transitionTexts({
      action: A.MARK_NEEDS_RESCHEDULING,
      reference: "JOB-2026-00042",
      timeZone: NEW_YORK,
      previous,
      reason: REASON,
      messageSent: true,
    }).staff;
    expect(needs).toContain("marked job JOB-2026-00042 as needing a new time");
    expect(needs).toContain("it was Tue, Mar 3, 2026, 10:00 AM – 12:00 PM EST");
    expect(needs).toContain(`Reason: ${REASON}`);
    expect(needs).toContain("The customer was sent a message.");

    const cancelled = transitionTexts({
      action: A.CANCEL,
      reference: "JOB-2026-00042",
      timeZone: NEW_YORK,
      reason: REASON,
    }).staff;
    expect(cancelled).toBe(`cancelled job JOB-2026-00042. Reason: ${REASON}.`);
  });

  it("says a job was started early only when it was", () => {
    const base = { action: A.START, reference: "JOB-2026-00042", timeZone: NEW_YORK } as const;
    expect(transitionTexts({ ...base, early: true }).staff).toBe(
      "started job JOB-2026-00042 before its scheduled start",
    );
    expect(transitionTexts({ ...base, early: false }).staff).toBe("started job JOB-2026-00042");
  });

  it("does not put the completion note anywhere in the history line", () => {
    expect(
      transitionTexts({ action: A.COMPLETE, reference: "JOB-2026-00042", timeZone: NEW_YORK }),
    ).toEqual({
      staff: "completed job JOB-2026-00042",
      customer: "marked your job as complete",
    });
  });

  it("always fits the activity limits, whatever the reason and the times", () => {
    const long = "x".repeat(500);
    for (const action of lifecycleActions) {
      const { summary, publicSummary } = buildActivitySummaries({
        actor: { kind: "staff", name: "N".repeat(100) },
        ...transitionTexts({
          action,
          reference: "JOB-2026-00042",
          timeZone: NEW_YORK,
          previous,
          reason: long,
          messageSent: true,
          early: true,
        }),
      });
      expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
      expect(publicSummary?.length ?? 0).toBeLessThanOrEqual(MAX_PUBLIC_SUMMARY_LENGTH);
    }
  });
});

describe("transitionNotification", () => {
  const notifiable = [A.MARK_NEEDS_RESCHEDULING, A.COMPLETE, A.CANCEL] as const;

  it.each([
    [A.MARK_NEEDS_RESCHEDULING, "Visit for JOB-2026-00042 needs a new time"],
    [A.COMPLETE, "Job JOB-2026-00042 is complete"],
    [A.CANCEL, "Job JOB-2026-00042 was cancelled"],
  ] as const)("says what happened for %s, naming the job and the service", (action, title) => {
    const note = transitionNotification({
      action,
      reference: "JOB-2026-00042",
      serviceName: "AC Repair",
    });
    expect(note.title).toBe(title);
    expect(note.message).toContain("AC Repair");
  });

  it("carries nothing but the job and the service: no reason, no technician, no address", () => {
    for (const action of notifiable) {
      const note = transitionNotification({
        action,
        reference: "JOB-2026-00042",
        serviceName: "AC Repair",
      });
      expect(`${note.title} ${note.message}`).not.toMatch(/reason|technician|jordan|street|lane/i);
    }
  });

  it("stays inside the notification limits (120 and 300 characters), even for a long service name", () => {
    for (const action of notifiable) {
      const note = transitionNotification({
        action,
        reference: "JOB-2026-00042",
        serviceName: "S".repeat(300),
      });
      expect(note.title.length).toBeLessThanOrEqual(120);
      expect(note.message.length).toBeLessThanOrEqual(300);
    }
  });
});
