import { WorkOrderAction, WorkOrderStatus } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  JOB_ACTION_LABELS,
  jobProgress,
  layoutJobActions,
  NOTE_LIMITS,
  PROGRESS_STEPS,
  startsEarly,
} from "./job-lifecycle";

const A = WorkOrderAction;
const S = WorkOrderStatus;

describe("JOB_ACTION_LABELS", () => {
  it("names every action in words an admin reads on a button", () => {
    expect(Object.keys(JOB_ACTION_LABELS).sort()).toEqual(Object.values(A).sort());
    expect(JOB_ACTION_LABELS).toMatchObject({
      START: "Start job",
      COMPLETE: "Complete job",
      MARK_NEEDS_RESCHEDULING: "Needs rescheduling",
      CANCEL: "Cancel job",
    });
  });
});

describe("layoutJobActions (D-43)", () => {
  it.each([
    [[A.SCHEDULE, A.CANCEL], A.SCHEDULE, undefined, [A.CANCEL]],
    [
      [A.RESCHEDULE, A.START, A.MARK_NEEDS_RESCHEDULING, A.CANCEL],
      A.START,
      A.RESCHEDULE,
      [A.MARK_NEEDS_RESCHEDULING, A.CANCEL],
    ],
    [[A.COMPLETE, A.MARK_NEEDS_RESCHEDULING], A.COMPLETE, undefined, [A.MARK_NEEDS_RESCHEDULING]],
    [[A.CANCEL], undefined, undefined, [A.CANCEL]],
    [[], undefined, undefined, []],
  ])("lays out %j", (actions, primary, secondary, menu) => {
    expect(layoutJobActions(actions)).toEqual({ primary, secondary, menu });
  });

  it("puts the action that moves the job on on the main button, and every ending in the menu", () => {
    for (const status of Object.values(S)) {
      const actions = {
        [S.PENDING_SCHEDULING]: [A.SCHEDULE, A.CANCEL],
        [S.NEEDS_RESCHEDULING]: [A.SCHEDULE, A.CANCEL],
        [S.SCHEDULED]: [A.RESCHEDULE, A.START, A.MARK_NEEDS_RESCHEDULING, A.CANCEL],
        [S.IN_PROGRESS]: [A.COMPLETE, A.MARK_NEEDS_RESCHEDULING],
        [S.COMPLETED]: [],
        [S.CANCELLED]: [],
      }[status];
      const { primary, secondary, menu } = layoutJobActions(actions);
      expect(menu, status).not.toContain(A.START);
      expect(menu, status).not.toContain(A.COMPLETE);
      expect(menu, status).not.toContain(A.SCHEDULE);
      // Every action the server lists is drawn exactly once.
      const drawn = [primary, secondary, ...menu].filter((action) => action !== undefined);
      expect([...drawn].sort(), status).toEqual([...actions].sort());
    }
  });

  it("draws nothing for an action the server does not list", () => {
    const { primary, secondary, menu } = layoutJobActions([A.START]);
    expect(primary).toBe(A.START);
    expect(secondary).toBeUndefined();
    expect(menu).toEqual([]);
  });
});

describe("startsEarly", () => {
  const start = "2026-03-03T15:00:00.000Z";

  it("is true before the booked start and false from that moment", () => {
    expect(startsEarly(start, Date.parse(start) - 1)).toBe(true);
    expect(startsEarly(start, Date.parse(start))).toBe(false);
    expect(startsEarly(start, Date.parse(start) + 3_600_000)).toBe(false);
  });

  it("is false when there is no booked time, or it cannot be read", () => {
    expect(startsEarly(null, 0)).toBe(false);
    expect(startsEarly("not a date", 0)).toBe(false);
  });
});

describe("NOTE_LIMITS", () => {
  it("come from the shared rules the server enforces", () => {
    expect(NOTE_LIMITS.completionSummary).toEqual({ minLength: 10, maxLength: 2000 });
    expect(NOTE_LIMITS.needsReschedulingReason.maxLength).toBe(200);
    expect(NOTE_LIMITS.cancelReason.maxLength).toBe(500);
    expect(NOTE_LIMITS.customerMessage.maxLength).toBe(500);
    expect(NOTE_LIMITS.internalNote.maxLength).toBe(2000);
  });
});

describe("jobProgress", () => {
  const states = (job: Parameters<typeof jobProgress>[0]) =>
    jobProgress(job).steps.map((step) => step.state);

  it("walks the usual path: Pending scheduling, Scheduled, In progress, Completed", () => {
    expect(PROGRESS_STEPS).toEqual([S.PENDING_SCHEDULING, S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED]);
    expect(
      jobProgress({ status: S.PENDING_SCHEDULING, scheduledStart: null }).steps.map((s) => s.label),
    ).toEqual(["Pending scheduling", "Scheduled", "In progress", "Completed"]);
  });

  it.each([
    [S.PENDING_SCHEDULING, ["current", "upcoming", "upcoming", "upcoming"]],
    [S.SCHEDULED, ["done", "current", "upcoming", "upcoming"]],
    [S.IN_PROGRESS, ["done", "done", "current", "upcoming"]],
    [S.COMPLETED, ["done", "done", "done", "current"]],
  ] as const)("marks the steps of a %s job", (status, expected) => {
    expect(states({ status, scheduledStart: "2026-03-03T15:00:00.000Z" })).toEqual(expected);
    expect(jobProgress({ status, scheduledStart: null }).exit).toBeNull();
  });

  it("shows a job that needs a new time as having left the path after Scheduled", () => {
    const progress = jobProgress({
      status: S.NEEDS_RESCHEDULING,
      scheduledStart: "2026-03-03T15:00:00.000Z",
    });
    expect(progress.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "upcoming",
      "upcoming",
    ]);
    expect(progress.exit).toEqual({ status: S.NEEDS_RESCHEDULING, label: "Needs rescheduling" });
  });

  it("shows a cancelled job's exit, and only the steps it reached", () => {
    const neverBooked = jobProgress({ status: S.CANCELLED, scheduledStart: null });
    expect(neverBooked.steps.map((step) => step.state)).toEqual([
      "done",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(neverBooked.exit).toEqual({ status: S.CANCELLED, label: "Cancelled" });

    const booked = jobProgress({
      status: S.CANCELLED,
      scheduledStart: "2026-03-03T15:00:00.000Z",
    });
    expect(booked.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "upcoming",
      "upcoming",
    ]);
  });

  it("never claims a step is current for a job that has left the path", () => {
    for (const status of [S.NEEDS_RESCHEDULING, S.CANCELLED]) {
      expect(states({ status, scheduledStart: "2026-03-03T15:00:00.000Z" })).not.toContain(
        "current",
      );
    }
  });
});
