import { SCHEDULE_RULES } from "@fixflow/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  adminWorkOrdersQuerySchema,
  conflictsQuerySchema,
  quotationIdParamsSchema,
  scheduleWorkOrderBodySchema,
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
