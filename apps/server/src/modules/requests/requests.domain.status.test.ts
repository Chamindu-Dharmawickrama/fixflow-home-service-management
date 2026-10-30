import {
  ErrorCode,
  RequestAction,
  type RequestStatusCounts,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/errors.js";
import {
  ACTIONS_REQUIRING_REASON,
  ADMIN_ACTION_TARGET,
  assertAdminAction,
  assertRequestTransition,
  availableAdminActions,
  canPerformAdminAction,
  canTransition,
  isNewRequest,
  REQUEST_TRANSITIONS,
  RequestTrigger,
  STALE_REQUEST_MESSAGE,
  staleRequestError,
  submittedRange,
  toStatusCounts,
} from "./requests.domain.js";

const STATUSES = Object.values(ServiceRequestStatus);
const TRIGGERS = Object.values(RequestTrigger);

/**
 * D-21 written out by hand, one line per allowed change. The test compares every possible pair with
 * THIS list, not with `REQUEST_TRANSITIONS`, so a slip in the map cannot also be a slip in the test.
 */
const ALLOWED: ReadonlyArray<
  readonly [ServiceRequestStatus, ServiceRequestStatus, RequestTrigger]
> = [
  // Admin
  ["SUBMITTED", "UNDER_REVIEW", "ADMIN"], // Start review
  ["SUBMITTED", "CANCELLED", "ADMIN"],
  ["UNDER_REVIEW", "CANCELLED", "ADMIN"],
  ["QUOTED", "CANCELLED", "ADMIN"],
  ["ACCEPTED", "CANCELLED", "ADMIN"],
  ["DECLINED", "CANCELLED", "ADMIN"],
  ["DECLINED", "UNDER_REVIEW", "ADMIN"], // Reopen
  // System
  ["UNDER_REVIEW", "QUOTED", "SYSTEM"], // a quotation was sent
  ["QUOTED", "ACCEPTED", "SYSTEM"], // the customer accepted
  ["QUOTED", "DECLINED", "SYSTEM"], // the customer declined
  ["QUOTED", "UNDER_REVIEW", "SYSTEM"], // the only sent quotation was voided or expired
  ["ACCEPTED", "CONVERTED_TO_JOB", "SYSTEM"], // a work order was created
];

const isAllowed = (from: string, to: string, trigger: string) =>
  ALLOWED.some(([f, t, g]) => f === from && t === to && g === trigger);

describe("the status table (D-21, spec §6.2)", () => {
  it("has exactly the twelve changes D-21 lists, and no others", () => {
    expect(REQUEST_TRANSITIONS).toHaveLength(ALLOWED.length);
    for (const { from, to, trigger } of REQUEST_TRANSITIONS) {
      expect(isAllowed(from, to, trigger), `${from} → ${to} by ${trigger}`).toBe(true);
    }
  });

  it("has no change listed twice", () => {
    const keys = REQUEST_TRANSITIONS.map(({ from, to, trigger }) => `${from}>${to}>${trigger}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  // Every status, to every status (itself included), for each trigger: 7 x 7 x 2 = 98 cases.
  const PAIRS = STATUSES.flatMap((from) =>
    STATUSES.flatMap((to) => TRIGGERS.map((trigger) => [from, to, trigger] as const)),
  );

  it("covers every pair and both triggers", () => {
    expect(PAIRS).toHaveLength(STATUSES.length * STATUSES.length * TRIGGERS.length);
    expect(PAIRS).toHaveLength(98);
  });

  it.each(PAIRS)("%s → %s by %s", (from, to, trigger) => {
    const allowed = isAllowed(from, to, trigger);

    expect(canTransition(from, to, trigger)).toBe(allowed);
    if (allowed) {
      expect(() => {
        assertRequestTransition(from, to, trigger);
      }).not.toThrow();
      return;
    }

    let thrown: unknown;
    try {
      assertRequestTransition(from, to, trigger);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const error = thrown as AppError;
    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect(error.details).toEqual({ currentStatus: from, requestedStatus: to });
    expect(error.message.length).toBeGreaterThan(10);
  });

  it("never lets a request leave CANCELLED or CONVERTED_TO_JOB", () => {
    for (const from of ["CANCELLED", "CONVERTED_TO_JOB"] as const) {
      for (const to of STATUSES) {
        for (const trigger of TRIGGERS) {
          expect(canTransition(from, to, trigger), `${from} → ${to} by ${trigger}`).toBe(false);
        }
      }
    }
  });

  it("lets only the admin start a review, cancel and reopen, and only the system do the rest", () => {
    for (const { action, trigger } of REQUEST_TRANSITIONS) {
      expect(action !== undefined).toBe(trigger === "ADMIN");
    }
  });
});

describe("the messages of a refused change", () => {
  const messageOf = (
    from: ServiceRequestStatus,
    to: ServiceRequestStatus,
    trigger: RequestTrigger,
  ) => {
    try {
      assertRequestTransition(from, to, trigger);
    } catch (error) {
      return (error as AppError).message;
    }
    throw new Error("The change was allowed.");
  };

  it("says a closed request can no longer be changed", () => {
    expect(messageOf("CANCELLED", "UNDER_REVIEW", "ADMIN")).toBe(
      "This request is cancelled, so it can no longer be changed.",
    );
    expect(messageOf("CONVERTED_TO_JOB", "CANCELLED", "ADMIN")).toBe(
      "This request is converted to job, so it can no longer be changed.",
    );
  });

  it("explains that a change made by the system cannot be made by hand", () => {
    expect(messageOf("UNDER_REVIEW", "QUOTED", "ADMIN")).toMatch(/happens automatically/);
    expect(messageOf("QUOTED", "ACCEPTED", "ADMIN")).toMatch(/cannot be made by hand/);
  });

  it("names both statuses otherwise", () => {
    expect(messageOf("UNDER_REVIEW", "UNDER_REVIEW", "ADMIN")).toBe(
      "A request that is under review cannot be moved to under review.",
    );
    expect(messageOf("SUBMITTED", "ACCEPTED", "SYSTEM")).toBe(
      "A request that is submitted cannot be moved to accepted.",
    );
  });
});

describe("availableAdminActions (D-43)", () => {
  const EXPECTED: Record<ServiceRequestStatus, RequestAction[]> = {
    SUBMITTED: ["START_REVIEW", "CANCEL"],
    UNDER_REVIEW: ["CANCEL"],
    QUOTED: ["CANCEL"],
    ACCEPTED: ["CANCEL"],
    DECLINED: ["REOPEN", "CANCEL"],
    CONVERTED_TO_JOB: [],
    CANCELLED: [],
  };

  it.each(STATUSES)("lists what an admin may do to a %s request", (status) => {
    expect(availableAdminActions(status)).toEqual(EXPECTED[status]);
  });

  it("offers an action exactly when it is allowed, never otherwise", () => {
    for (const status of STATUSES) {
      for (const action of Object.values(RequestAction)) {
        expect(availableAdminActions(status).includes(action)).toBe(
          EXPECTED[status].includes(action),
        );
        expect(canPerformAdminAction(status, action)).toBe(EXPECTED[status].includes(action));
      }
    }
  });

  it("keeps Start review and Reopen apart although both lead to UNDER_REVIEW", () => {
    expect(ADMIN_ACTION_TARGET.START_REVIEW).toBe(ADMIN_ACTION_TARGET.REOPEN);
    expect(canPerformAdminAction("SUBMITTED", "REOPEN")).toBe(false);
    expect(canPerformAdminAction("DECLINED", "START_REVIEW")).toBe(false);
    expect(() => {
      assertAdminAction("SUBMITTED", "REOPEN");
    }).toThrow(/cannot be moved/);
    expect(() => {
      assertAdminAction("DECLINED", "START_REVIEW");
    }).toThrow(AppError);
  });

  it("refuses every action on a closed request, with a message that says it is closed", () => {
    for (const status of ["CANCELLED", "CONVERTED_TO_JOB"] as const) {
      for (const action of Object.values(RequestAction)) {
        expect(() => {
          assertAdminAction(status, action);
        }).toThrow(/can no longer be changed/);
      }
    }
  });

  it("allows an action in the statuses D-21 names, and no assertion fires for them", () => {
    expect(() => {
      assertAdminAction("SUBMITTED", "START_REVIEW");
    }).not.toThrow();
    expect(() => {
      assertAdminAction("DECLINED", "REOPEN");
    }).not.toThrow();
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "ACCEPTED", "DECLINED"] as const) {
      expect(() => {
        assertAdminAction(status, "CANCEL");
      }).not.toThrow();
    }
  });

  it("puts the most likely next step first and the destructive one last", () => {
    for (const status of STATUSES) {
      const actions = availableAdminActions(status);
      if (actions.includes("CANCEL")) {
        expect(actions.at(-1)).toBe("CANCEL");
      }
    }
  });

  it("offers no system change: nothing in the list leads to QUOTED, ACCEPTED, DECLINED or CONVERTED_TO_JOB", () => {
    for (const action of Object.values(RequestAction)) {
      expect(["QUOTED", "ACCEPTED", "DECLINED", "CONVERTED_TO_JOB"]).not.toContain(
        ADMIN_ACTION_TARGET[action],
      );
    }
  });

  it("needs a reason for cancelling and reopening, not for starting a review", () => {
    expect([...ACTIONS_REQUIRING_REASON].sort()).toEqual(["CANCEL", "REOPEN"]);
  });
});

describe("a stale request", () => {
  it("is a 409 STALE_STATE that says to refresh and names the status it is in now", () => {
    const error = staleRequestError("UNDER_REVIEW");

    expect(error.status).toBe(409);
    expect(error.code).toBe(ErrorCode.STALE_STATE);
    expect(error.message).toBe(
      "This request was updated by someone else. Refresh to see the latest status.",
    );
    expect(error.message).toBe(STALE_REQUEST_MESSAGE);
    expect(error.details).toEqual({ currentStatus: "UNDER_REVIEW" });
  });
});

describe("small helpers", () => {
  it("marks only a SUBMITTED request as new", () => {
    for (const status of STATUSES) {
      expect(isNewRequest(status)).toBe(status === "SUBMITTED");
    }
  });

  it("counts every status, with zero for the ones that have none", () => {
    const counts: RequestStatusCounts = toStatusCounts([
      { status: "SUBMITTED", count: 3 },
      { status: "CANCELLED", count: 1 },
    ]);

    expect(counts).toEqual({
      SUBMITTED: 3,
      UNDER_REVIEW: 0,
      QUOTED: 0,
      ACCEPTED: 0,
      DECLINED: 0,
      CONVERTED_TO_JOB: 0,
      CANCELLED: 1,
    });
    expect(toStatusCounts([])).toEqual(Object.fromEntries(STATUSES.map((status) => [status, 0])));
  });
});

describe("submittedRange: the queue's date filter on the business's calendar", () => {
  const iso = (range: { from?: Date; before?: Date }) => ({
    from: range.from?.toISOString(),
    before: range.before?.toISOString(),
  });

  it("is open on a side that is not given", () => {
    expect(iso(submittedRange(undefined, undefined, "America/New_York"))).toEqual({
      from: undefined,
      before: undefined,
    });
    expect(iso(submittedRange("2026-12-15", undefined, "America/New_York"))).toEqual({
      from: "2026-12-15T05:00:00.000Z",
      before: undefined,
    });
    expect(iso(submittedRange(undefined, "2026-12-15", "America/New_York"))).toEqual({
      from: undefined,
      before: "2026-12-16T05:00:00.000Z",
    });
  });

  it("includes the whole of both days: from midnight starting the first to midnight ending the last", () => {
    expect(iso(submittedRange("2026-12-14", "2026-12-16", "America/New_York"))).toEqual({
      from: "2026-12-14T05:00:00.000Z",
      before: "2026-12-17T05:00:00.000Z",
    });
  });

  it("follows the business's zone, not UTC's", () => {
    expect(iso(submittedRange("2026-12-15", "2026-12-15", "UTC"))).toEqual({
      from: "2026-12-15T00:00:00.000Z",
      before: "2026-12-16T00:00:00.000Z",
    });
    expect(iso(submittedRange("2026-12-15", "2026-12-15", "Asia/Kolkata"))).toEqual({
      from: "2026-12-14T18:30:00.000Z",
      before: "2026-12-15T18:30:00.000Z",
    });
  });

  it("is a 23-hour day on the day the clocks go forward (2026-03-08)", () => {
    const range = submittedRange("2026-03-08", "2026-03-08", "America/New_York");

    expect(iso(range)).toEqual({
      from: "2026-03-08T05:00:00.000Z",
      before: "2026-03-09T04:00:00.000Z",
    });
    expect(((range.before?.getTime() ?? 0) - (range.from?.getTime() ?? 0)) / 3_600_000).toBe(23);
  });

  it("is a 25-hour day on the day the clocks go back (2026-11-01)", () => {
    const range = submittedRange("2026-11-01", "2026-11-01", "America/New_York");

    expect(iso(range)).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      before: "2026-11-02T05:00:00.000Z",
    });
    expect(((range.before?.getTime() ?? 0) - (range.from?.getTime() ?? 0)) / 3_600_000).toBe(25);
  });

  it("rolls over a month and a year end", () => {
    expect(iso(submittedRange(undefined, "2026-12-31", "America/New_York")).before).toBe(
      "2027-01-01T05:00:00.000Z",
    );
  });
});
