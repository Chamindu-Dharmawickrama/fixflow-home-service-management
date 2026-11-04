import { SCHEDULE_RULES } from "@fixflow/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  adminWorkOrdersQuerySchema,
  conflictsQuerySchema,
  listMyWorkOrdersQuerySchema,
  quotationIdParamsSchema,
  scheduleWorkOrderBodySchema,
  transitionWorkOrderBodySchema,
  workOrderIdParamsSchema,
} from "./work-orders.schemas.js";

const ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

function errorsOf(schema: z.ZodType, input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

const validBody = {
  scheduledStart: "2026-03-03T15:00:00Z",
  scheduledEnd: "2026-03-03T17:00:00Z",
  technicianId: ID,
  expectedStatus: "PENDING_SCHEDULING",
};

describe("scheduleWorkOrderBodySchema", () => {
  it("reads the times into dates and keeps the rest", () => {
    const body = scheduleWorkOrderBodySchema.parse(validBody);
    expect(body.scheduledStart).toEqual(new Date("2026-03-03T15:00:00.000Z"));
    expect(body.scheduledEnd).toEqual(new Date("2026-03-03T17:00:00.000Z"));
    expect(body.technicianId).toBe(ID);
    expect(body.expectedStatus).toBe("PENDING_SCHEDULING");
    expect(body.reason).toBeUndefined();
  });

  it.each([
    ["Z", "2026-03-03T15:00:00Z"],
    ["milliseconds", "2026-03-03T15:00:00.500Z"],
    ["a negative offset", "2026-03-03T10:00:00-05:00"],
    ["a positive offset", "2026-03-03T20:30:00+05:30"],
  ])("accepts an instant written with %s", (_name, value) => {
    expect(errorsOf(scheduleWorkOrderBodySchema, { ...validBody, scheduledStart: value })).toEqual(
      {},
    );
  });

  it("reads an offset as the same instant", () => {
    const body = scheduleWorkOrderBodySchema.parse({
      ...validBody,
      scheduledStart: "2026-03-03T10:00:00-05:00",
    });
    expect(body.scheduledStart.toISOString()).toBe("2026-03-03T15:00:00.000Z");
  });

  it.each([
    ["a local time with no zone", "2026-03-03T10:00:00"],
    ["a date alone", "2026-03-03"],
    ["words", "tomorrow at ten"],
    ["nothing", ""],
    ["a number", 1772550000000],
    ["an impossible day", "2026-02-30T10:00:00Z"],
  ])("refuses %s as a start, beside the field", (_name, value) => {
    const errors = errorsOf(scheduleWorkOrderBodySchema, { ...validBody, scheduledStart: value });
    expect(Object.keys(errors)).toEqual(["scheduledStart"]);
    expect(errors.scheduledStart).toContain("must be a date and time");
  });

  it("names every missing field", () => {
    expect(Object.keys(errorsOf(scheduleWorkOrderBodySchema, {})).sort()).toEqual([
      "expectedStatus",
      "scheduledEnd",
      "scheduledStart",
      "technicianId",
    ]);
  });

  it("refuses a technician that is not an id, and a status that is not one", () => {
    expect(
      Object.keys(errorsOf(scheduleWorkOrderBodySchema, { ...validBody, technicianId: "jordan" })),
    ).toEqual(["technicianId"]);
    expect(
      Object.keys(errorsOf(scheduleWorkOrderBodySchema, { ...validBody, expectedStatus: "DONE" })),
    ).toEqual(["expectedStatus"]);
  });

  it("refuses any field it does not know: a status, a reference, a customer", () => {
    for (const extra of [{ status: "COMPLETED" }, { reference: "JOB-1" }, { customerId: ID }]) {
      expect(scheduleWorkOrderBodySchema.safeParse({ ...validBody, ...extra }).success).toBe(false);
    }
  });

  it("trims a reason and holds it to 5 to 200 characters", () => {
    const parse = (reason: string) =>
      scheduleWorkOrderBodySchema.safeParse({ ...validBody, reason });
    expect(parse("  The part is late.  ").data?.reason).toBe("The part is late.");
    expect(parse("a".repeat(SCHEDULE_RULES.rescheduleReasonMinLength - 1)).success).toBe(false);
    expect(parse("a".repeat(SCHEDULE_RULES.rescheduleReasonMinLength)).success).toBe(true);
    expect(parse("a".repeat(SCHEDULE_RULES.rescheduleReasonMaxLength)).success).toBe(true);
    expect(parse("a".repeat(SCHEDULE_RULES.rescheduleReasonMaxLength + 1)).success).toBe(false);
    expect(parse("      ").success).toBe(false);
  });
});

describe("conflictsQuerySchema", () => {
  const valid = {
    technicianId: ID,
    start: "2026-03-03T15:00:00Z",
    end: "2026-03-03T17:00:00Z",
  };

  it("reads the window into dates; the job to leave out is optional", () => {
    const query = conflictsQuerySchema.parse(valid);
    expect(query.start).toEqual(new Date("2026-03-03T15:00:00.000Z"));
    expect(query.end).toEqual(new Date("2026-03-03T17:00:00.000Z"));
    expect(query.excludeId).toBeUndefined();
    expect(conflictsQuerySchema.parse({ ...valid, excludeId: ID }).excludeId).toBe(ID);
  });

  it("needs an end after the start", () => {
    expect(errorsOf(conflictsQuerySchema, { ...valid, end: valid.start }).end).toBe(
      "end must be after start.",
    );
    expect(
      errorsOf(conflictsQuerySchema, { ...valid, start: valid.end, end: valid.start }).end,
    ).toBe("end must be after start.");
  });

  it("holds the window to a week, and allows exactly a week", () => {
    expect(
      errorsOf(conflictsQuerySchema, { ...valid, end: "2026-03-10T15:00:00.001Z" }).end,
    ).toContain("at most 7 days");
    expect(errorsOf(conflictsQuerySchema, { ...valid, end: "2026-03-10T15:00:00Z" })).toEqual({});
  });

  it("answers a bad instant with 422 and never reaches the window check with text for a date", () => {
    // Regression: a refined-but-kept string used to reach the object-level check and throw.
    for (const bad of [
      { ...valid, start: "yesterday" },
      { ...valid, end: "tomorrow" },
      { ...valid, start: "yesterday", end: "tomorrow" },
      { ...valid, start: undefined },
      { technicianId: ID },
    ]) {
      expect(() => conflictsQuerySchema.safeParse(bad)).not.toThrow();
      expect(conflictsQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("names the technician and the excluded job when they are not ids", () => {
    expect(Object.keys(errorsOf(conflictsQuerySchema, { ...valid, technicianId: "x" }))).toEqual([
      "technicianId",
    ]);
    expect(Object.keys(errorsOf(conflictsQuerySchema, { ...valid, excludeId: "x" }))).toEqual([
      "excludeId",
    ]);
  });
});

describe("adminWorkOrdersQuerySchema", () => {
  it("defaults to the newest jobs first, twenty to a page", () => {
    expect(adminWorkOrdersQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("takes only the sort fields the list offers", () => {
    for (const sort of ["scheduledStart", "createdAt", "status"]) {
      expect(adminWorkOrdersQuerySchema.safeParse({ sort }).success).toBe(true);
    }
    expect(adminWorkOrdersQuerySchema.safeParse({ sort: "reference" }).success).toBe(false);
    expect(adminWorkOrdersQuerySchema.safeParse({ sort: "technician" }).success).toBe(false);
  });

  it("takes each view and refuses another", () => {
    for (const view of ["needs-scheduling", "upcoming", "in-progress", "completed", "all"]) {
      expect(adminWorkOrdersQuerySchema.parse({ view }).view).toBe(view);
    }
    expect(adminWorkOrdersQuerySchema.safeParse({ view: "overdue" }).success).toBe(false);
  });

  it("reads one status, a repeated one or a comma-separated list, once each", () => {
    expect(adminWorkOrdersQuerySchema.parse({ status: "SCHEDULED" }).status).toEqual(["SCHEDULED"]);
    expect(adminWorkOrdersQuerySchema.parse({ status: ["SCHEDULED", "COMPLETED"] }).status).toEqual(
      ["SCHEDULED", "COMPLETED"],
    );
    expect(
      adminWorkOrdersQuerySchema.parse({ status: "SCHEDULED,COMPLETED,SCHEDULED" }).status,
    ).toEqual(["SCHEDULED", "COMPLETED"]);
    expect(adminWorkOrdersQuerySchema.parse({ status: "" }).status).toBeUndefined();
    expect(adminWorkOrdersQuerySchema.safeParse({ status: "FINISHED" }).success).toBe(false);
  });

  it("trims the search and treats a blank one as none", () => {
    expect(adminWorkOrdersQuerySchema.parse({ q: "  priya  " }).q).toBe("priya");
    expect(adminWorkOrdersQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(adminWorkOrdersQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });

  it("holds the dates to real days and the range to its order", () => {
    expect(
      adminWorkOrdersQuerySchema.safeParse({
        scheduledFrom: "2026-03-03",
        scheduledTo: "2026-03-03",
      }).success,
    ).toBe(true);
    expect(
      Object.keys(errorsOf(adminWorkOrdersQuerySchema, { scheduledFrom: "2026-02-30" })),
    ).toEqual(["scheduledFrom"]);
    expect(
      errorsOf(adminWorkOrdersQuerySchema, {
        scheduledFrom: "2026-03-05",
        scheduledTo: "2026-03-04",
      }).scheduledTo,
    ).toContain("must not be before scheduledFrom");
  });

  it("takes the technician and the customer as ids", () => {
    expect(adminWorkOrdersQuerySchema.parse({ technicianId: ID, customerId: ID })).toMatchObject({
      technicianId: ID,
      customerId: ID,
    });
    expect(adminWorkOrdersQuerySchema.safeParse({ technicianId: "jordan" }).success).toBe(false);
  });
});

describe("the id parameters", () => {
  it("take an id and nothing else", () => {
    expect(workOrderIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(quotationIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(workOrderIdParamsSchema.safeParse({ id: "JOB-2026-00001" }).success).toBe(false);
    expect(quotationIdParamsSchema.safeParse({ id: "QT-2026-00001" }).success).toBe(false);
  });
});

describe("transitionWorkOrderBodySchema (T18)", () => {
  const NOTE = "Replaced the run capacitor and checked the cooling.";
  const REASON = "The part will not arrive this week.";

  const start = { action: "START", expectedStatus: "SCHEDULED" };
  const complete = { action: "COMPLETE", expectedStatus: "IN_PROGRESS", completionNote: NOTE };
  const needs = { action: "MARK_NEEDS_RESCHEDULING", expectedStatus: "SCHEDULED", reason: REASON };
  const cancel = { action: "CANCEL", expectedStatus: "SCHEDULED", reason: REASON };

  it("accepts each action with the fields it needs", () => {
    for (const body of [start, complete, needs, cancel]) {
      expect(errorsOf(transitionWorkOrderBodySchema, body)).toEqual({});
    }
  });

  it("accepts the optional fields each action may carry", () => {
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, internalNote: "Quote the filter." }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, {
        ...needs,
        customerMessage: "Sorry, new time soon.",
      }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...cancel, customerMessage: "Sorry about this." }),
    ).toEqual({});
  });

  it("trims the text and turns a blank optional one into null", () => {
    const body = transitionWorkOrderBodySchema.parse({
      ...complete,
      completionNote: `   ${NOTE}  `,
      internalNote: "   ",
    });
    expect(body.completionNote).toBe(NOTE);
    expect(body.internalNote).toBeNull();
  });

  it("requires a completion summary of 10 to 2000 characters to complete", () => {
    const { completionNote: _omitted, ...without } = complete;
    expect(errorsOf(transitionWorkOrderBodySchema, without).completionNote).toMatch(
      /completion summary of 10 to 2000 characters/,
    );
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, completionNote: "Done." })
        .completionNote,
    ).toMatch(/at least 10 characters/);
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, completionNote: "         " })
        .completionNote,
    ).toBeDefined();
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, completionNote: "a".repeat(10) }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, completionNote: "a".repeat(2000) }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, completionNote: "a".repeat(2001) })
        .completionNote,
    ).toMatch(/2000 characters or fewer/);
  });

  it("limits the internal note to 2000 characters", () => {
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, internalNote: "a".repeat(2000) }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...complete, internalNote: "a".repeat(2001) })
        .internalNote,
    ).toMatch(/2000 characters or fewer/);
  });

  it.each(["MARK_NEEDS_RESCHEDULING", "CANCEL"])("requires a reason to %s", (action) => {
    const body = { action, expectedStatus: "SCHEDULED" };
    expect(errorsOf(transitionWorkOrderBodySchema, body).reason).toMatch(/Enter a reason/);
    expect(errorsOf(transitionWorkOrderBodySchema, { ...body, reason: "no" }).reason).toMatch(
      /at least 5 characters/,
    );
    expect(errorsOf(transitionWorkOrderBodySchema, { ...body, reason: "  " }).reason).toBeDefined();
    expect(errorsOf(transitionWorkOrderBodySchema, { ...body, reason: "fives" })).toEqual({});
  });

  it("allows a cancellation reason of 500 characters and a new-time reason of 200", () => {
    expect(errorsOf(transitionWorkOrderBodySchema, { ...cancel, reason: "r".repeat(500) })).toEqual(
      {},
    );
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...cancel, reason: "r".repeat(501) }).reason,
    ).toMatch(/500 characters or fewer/);
    expect(errorsOf(transitionWorkOrderBodySchema, { ...needs, reason: "r".repeat(200) })).toEqual(
      {},
    );
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...needs, reason: "r".repeat(201) }).reason,
    ).toMatch(/200 characters or fewer/);
  });

  it("limits the message for the customer to 500 characters", () => {
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...cancel, customerMessage: "m".repeat(500) }),
    ).toEqual({});
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...cancel, customerMessage: "m".repeat(501) })
        .customerMessage,
    ).toMatch(/500 characters or fewer/);
  });

  it("refuses a field that does not belong to the action", () => {
    const refused = (body: object) => errorsOf(transitionWorkOrderBodySchema, body);
    // Starting takes nothing.
    for (const field of ["completionNote", "internalNote", "reason", "customerMessage"]) {
      expect(refused({ ...start, [field]: "Some words here." })[field]).toMatch(/does not take/);
    }
    // Completing takes no reason and no message for the customer.
    expect(refused({ ...complete, reason: REASON }).reason).toMatch(/does not take a reason/);
    expect(refused({ ...complete, customerMessage: "Hello there." }).customerMessage).toMatch(
      /does not take a message for the customer/,
    );
    // Cancelling and rescheduling take no completion summary and no internal note.
    for (const body of [needs, cancel]) {
      expect(refused({ ...body, completionNote: NOTE }).completionNote).toMatch(
        /does not take a completion summary/,
      );
      expect(refused({ ...body, internalNote: "Some note." }).internalNote).toMatch(
        /does not take an internal note/,
      );
    }
  });

  it("does not count a blank optional text as present", () => {
    expect(errorsOf(transitionWorkOrderBodySchema, { ...start, internalNote: "" })).toEqual({});
    expect(errorsOf(transitionWorkOrderBodySchema, { ...complete, customerMessage: "  " })).toEqual(
      {},
    );
  });

  it("names the action and the status, and only the four actions exist", () => {
    expect(errorsOf(transitionWorkOrderBodySchema, { expectedStatus: "SCHEDULED" }).action).toMatch(
      /action must be one of: START, MARK_NEEDS_RESCHEDULING, COMPLETE, CANCEL/,
    );
    for (const action of ["SCHEDULE", "RESCHEDULE", "start", "COMPLETED", ""]) {
      expect(errorsOf(transitionWorkOrderBodySchema, { ...start, action }).action).toBeDefined();
    }
    expect(errorsOf(transitionWorkOrderBodySchema, { action: "START" }).expectedStatus).toMatch(
      /expectedStatus must be the status/,
    );
    expect(
      errorsOf(transitionWorkOrderBodySchema, { ...start, expectedStatus: "DONE" }).expectedStatus,
    ).toBeDefined();
  });

  it("refuses a status, a timestamp or any other key the client should not send", () => {
    for (const extra of [
      { status: "COMPLETED" },
      { completedAt: "2026-03-03T15:00:00Z" },
      { startedAt: "2026-03-03T15:00:00Z" },
      { cancelReason: "Hidden." },
      { internalCompletionNote: "Hidden." },
      { technicianId: ID },
    ]) {
      expect(
        transitionWorkOrderBodySchema.safeParse({ ...start, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe("listMyWorkOrdersQuerySchema (T18)", () => {
  it("defaults to the first page of the whole list", () => {
    const query = listMyWorkOrdersQuerySchema.parse({});
    expect(query).toMatchObject({ page: 1, pageSize: 20 });
    expect(query.group).toBeUndefined();
  });

  it("takes one section, and refuses another word", () => {
    expect(listMyWorkOrdersQuerySchema.parse({ group: "upcoming" }).group).toBe("upcoming");
    expect(listMyWorkOrdersQuerySchema.parse({ group: "past" }).group).toBe("past");
    expect(errorsOf(listMyWorkOrdersQuerySchema, { group: "soon" }).group).toMatch(
      /group must be one of: upcoming, past/,
    );
  });

  it("bounds the page size at 100 and refuses a sort that is not offered", () => {
    expect(errorsOf(listMyWorkOrdersQuerySchema, { pageSize: "101" }).pageSize).toBeDefined();
    expect(errorsOf(listMyWorkOrdersQuerySchema, { sort: "customerId" }).sort).toBeDefined();
  });
});

describe("the admin list's new view and sort (T18)", () => {
  it("accepts the ready-to-invoice view and sorting by completion", () => {
    const query = adminWorkOrdersQuerySchema.parse({
      view: "ready-to-invoice",
      sort: "completedAt",
    });
    expect(query.view).toBe("ready-to-invoice");
    expect(query.sort).toBe("completedAt");
  });
});
