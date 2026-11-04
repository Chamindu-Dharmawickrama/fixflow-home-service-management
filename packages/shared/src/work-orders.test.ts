import { describe, expect, it } from "vitest";

import { WorkOrderStatus } from "./enums.js";
import * as shared from "./index.js";
import { LIMITS } from "./limits.js";
import {
  CUSTOMER_WORK_ORDER_GROUPS,
  SCHEDULE_RULES,
  TRANSITION_RULES,
  WORK_ORDER_CUSTOMER_EXPLANATIONS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TRANSITION_ACTIONS,
  WORK_ORDER_VIEW_STATUSES,
  WORK_ORDER_VIEWS,
  WorkOrderAction,
  workOrderCustomerExplanation,
  workOrderStatusLabel,
} from "./work-orders.js";

describe("work-order status labels", () => {
  it("name every status, in the words the badge uses", () => {
    expect(Object.keys(WORK_ORDER_STATUS_LABELS).sort()).toEqual(
      Object.values(WorkOrderStatus).sort(),
    );
    expect(workOrderStatusLabel(WorkOrderStatus.NEEDS_RESCHEDULING)).toBe("Needs rescheduling");
    expect(workOrderStatusLabel(WorkOrderStatus.PENDING_SCHEDULING)).toBe("Pending scheduling");
  });
});

describe("the jobs list views", () => {
  it("hold the working statuses, and `all` holds every one", () => {
    expect(WORK_ORDER_VIEW_STATUSES["needs-scheduling"]).toEqual([
      WorkOrderStatus.PENDING_SCHEDULING,
      WorkOrderStatus.NEEDS_RESCHEDULING,
    ]);
    expect(WORK_ORDER_VIEW_STATUSES.upcoming).toEqual([WorkOrderStatus.SCHEDULED]);
    expect(WORK_ORDER_VIEW_STATUSES["in-progress"]).toEqual([WorkOrderStatus.IN_PROGRESS]);
    expect(WORK_ORDER_VIEW_STATUSES.completed).toEqual([WorkOrderStatus.COMPLETED]);
    expect([...WORK_ORDER_VIEW_STATUSES.all].sort()).toEqual(Object.values(WorkOrderStatus).sort());
  });

  it("are defined for every tab", () => {
    expect(Object.keys(WORK_ORDER_VIEW_STATUSES).sort()).toEqual([...WORK_ORDER_VIEWS].sort());
  });
});

describe("the scheduling rules", () => {
  it("take the longest visit from the shared limits, so the two cannot disagree", () => {
    expect(SCHEDULE_RULES.maxDurationMinutes).toBe(LIMITS.appointment.maxDurationMinutes);
    expect(SCHEDULE_RULES.maxDurationMinutes).toBe(720);
  });

  it("allow a start 15 minutes in the past", () => {
    expect(SCHEDULE_RULES.startGraceMinutes).toBe(15);
  });
});

describe("the package entry point", () => {
  it("re-exports the work-order vocabulary", () => {
    expect(shared.WorkOrderAction).toBe(WorkOrderAction);
    expect(shared.SCHEDULE_RULES).toBe(SCHEDULE_RULES);
    expect(shared.WORK_ORDER_VIEWS).toBe(WORK_ORDER_VIEWS);
  });
});

describe("the customer's explanation of each status", () => {
  it("covers every status with a plain sentence", () => {
    expect(Object.keys(WORK_ORDER_CUSTOMER_EXPLANATIONS).sort()).toEqual(
      Object.values(WorkOrderStatus).sort(),
    );
    for (const status of Object.values(WorkOrderStatus)) {
      const text = workOrderCustomerExplanation(status);
      expect(text.length).toBeGreaterThan(20);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  it("says a technician has started only of an in-progress job", () => {
    const sayingStarted = Object.values(WorkOrderStatus).filter((status) =>
      /started work/i.test(workOrderCustomerExplanation(status)),
    );
    expect(sayingStarted).toEqual([WorkOrderStatus.IN_PROGRESS]);
  });

  it("never promises a time or a person the business has not given", () => {
    for (const status of [WorkOrderStatus.PENDING_SCHEDULING, WorkOrderStatus.NEEDS_RESCHEDULING]) {
      expect(workOrderCustomerExplanation(status)).not.toMatch(
        /tomorrow|today|this week|technician/i,
      );
    }
  });
});

describe("the transition actions", () => {
  it("are the four that change a job's status, and not the scheduling ones", () => {
    expect([...WORK_ORDER_TRANSITION_ACTIONS].sort()).toEqual(
      [
        WorkOrderAction.START,
        WorkOrderAction.MARK_NEEDS_RESCHEDULING,
        WorkOrderAction.COMPLETE,
        WorkOrderAction.CANCEL,
      ].sort(),
    );
  });

  it("keep the reasons within what the history line and the column can hold", () => {
    expect(TRANSITION_RULES.completionNote).toEqual({ minLength: 10, maxLength: 2000 });
    expect(TRANSITION_RULES.needsReschedulingReason.maxLength).toBe(
      SCHEDULE_RULES.rescheduleReasonMaxLength,
    );
    expect(TRANSITION_RULES.cancelReason.maxLength).toBe(LIMITS.reason.maxLength);
  });
});

describe("the ready-to-invoice view", () => {
  it("reads completed jobs, which the server narrows to those without an invoice", () => {
    expect(WORK_ORDER_VIEW_STATUSES["ready-to-invoice"]).toEqual([WorkOrderStatus.COMPLETED]);
  });
});

describe("the customer's job sections", () => {
  it("are upcoming and past", () => {
    expect([...CUSTOMER_WORK_ORDER_GROUPS]).toEqual(["upcoming", "past"]);
  });
});
