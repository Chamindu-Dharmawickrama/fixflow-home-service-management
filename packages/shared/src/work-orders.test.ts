import { describe, expect, it } from "vitest";

import { WorkOrderStatus } from "./enums.js";
import * as shared from "./index.js";
import { LIMITS } from "./limits.js";
import {
  SCHEDULE_RULES,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_VIEW_STATUSES,
  WORK_ORDER_VIEWS,
  WorkOrderAction,
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
