import {
  type AdminWorkOrderDto,
  type AdminWorkOrderListResponse,
  ErrorCode,
  type SchedulingConflictDto,
  WORK_ORDER_VIEWS,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";
import {
  ADMIN_WORK_ORDERS,
  at,
  bookedJob,
  insertJob,
  newJob,
  schedule,
  type WorkOrderWorld,
  workOrderWorld,
} from "../../test/work-order-world.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const DAY = "2026-03-03";

async function list(w: WorkOrderWorld, query = "", cookie = w.adminCookie) {
  return w.client.get(`${ADMIN_WORK_ORDERS}${query === "" ? "" : `?${query}`}`, { cookie });
}

const rowsOf = (response: { body: unknown }) =>
  bodyOf<AdminWorkOrderListResponse>(response as never).data;
const referencesOf = (response: { body: unknown }) => rowsOf(response).map((row) => row.reference);

/** One job in every status, for Alex or Priya, with distinct times. Returns the references by name. */
async function seedEveryStatus(w: WorkOrderWorld) {
  const pending = await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });
  const needs = await insertJob(w, {
    status: WorkOrderStatus.NEEDS_RESCHEDULING,
    owner: "priya",
    technicianId: w.sam.id,
    start: at("2026-03-02", "14:00"),
    end: at("2026-03-02", "15:00"),
  });
  const scheduledJordan = await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
  const scheduledSam = await insertJob(w, {
    status: WorkOrderStatus.SCHEDULED,
    owner: "priya",
    technicianId: w.sam.id,
    start: at("2026-03-04", "09:00"),
    end: at("2026-03-04", "11:00"),
  });
  const underWay = await bookedJob(
    w,
    w.jordan.id,
    at("2026-03-02", "09:00"),
    at("2026-03-02", "11:00"),
    WorkOrderStatus.IN_PROGRESS,
  );
  const done = await insertJob(w, {
    status: WorkOrderStatus.COMPLETED,
    technicianId: w.jordan.id,
    start: at("2026-03-01", "09:00"),
    end: at("2026-03-01", "11:00"),
  });
  const cancelled = await insertJob(w, { status: WorkOrderStatus.CANCELLED });
  return {
    pending: pending.reference,
    needs: needs.reference,
    scheduledJordan: scheduledJordan.reference,
    scheduledSam: scheduledSam.reference,
    underWay: underWay.reference,
    done: done.reference,
    cancelled: cancelled.reference,
  };
}

describe("GET /admin/work-orders: the tabs (FR-052)", () => {
  it("is empty with zero counts when there are no jobs", async () => {
    const w = await workOrderWorld(prisma);
    const response = await list(w);
    expect(response.status).toBe(200);
    expect(bodyOf<AdminWorkOrderListResponse>(response)).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      meta: {
        viewCounts: {
          "needs-scheduling": 0,
          upcoming: 0,
          "in-progress": 0,
          "ready-to-invoice": 0,
          completed: 0,
          all: 0,
        },
      },
    });
  });

  it("shows each tab's own jobs", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);

    expect(referencesOf(await list(w, "view=needs-scheduling")).sort()).toEqual(
      [jobs.pending, jobs.needs].sort(),
    );
    expect(referencesOf(await list(w, "view=upcoming")).sort()).toEqual(
      [jobs.scheduledJordan, jobs.scheduledSam].sort(),
    );
    expect(referencesOf(await list(w, "view=in-progress"))).toEqual([jobs.underWay]);
    expect(referencesOf(await list(w, "view=completed"))).toEqual([jobs.done]);
    expect(referencesOf(await list(w, "view=all"))).toHaveLength(7);
    expect(referencesOf(await list(w))).toHaveLength(7);
  });

  it("counts every tab under the other filters, whichever tab and page is showing", async () => {
    const w = await workOrderWorld(prisma);
    await seedEveryStatus(w);
    const everyone = {
      "needs-scheduling": 2,
      upcoming: 2,
      "in-progress": 1,
      // The one completed job has no invoice, so it is ready to invoice.
      "ready-to-invoice": 1,
      completed: 1,
      all: 7,
    };

    for (const query of [
      "",
      "view=upcoming",
      "view=completed&page=2&pageSize=1",
      "status=CANCELLED",
    ]) {
      expect(bodyOf<AdminWorkOrderListResponse>(await list(w, query)).meta.viewCounts).toEqual(
        everyone,
      );
    }
    // A filter that is not the tab changes the counts to match.
    const jordans = bodyOf<AdminWorkOrderListResponse>(
      await list(w, `technicianId=${w.jordan.id}`),
    );
    expect(jordans.meta.viewCounts).toEqual({
      "needs-scheduling": 0,
      upcoming: 1,
      "in-progress": 1,
      "ready-to-invoice": 1,
      completed: 1,
      all: 3,
    });
  });

  it("names every tab in the counts", async () => {
    const w = await workOrderWorld(prisma);
    const { meta } = bodyOf<AdminWorkOrderListResponse>(await list(w));
    expect(Object.keys(meta.viewCounts).sort()).toEqual([...WORK_ORDER_VIEWS].sort());
  });

  it("narrows a tab by status, and a status that is not in the tab leaves it empty", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);

    expect(referencesOf(await list(w, "view=needs-scheduling&status=NEEDS_RESCHEDULING"))).toEqual([
      jobs.needs,
    ]);
    expect(referencesOf(await list(w, "view=upcoming&status=COMPLETED"))).toEqual([]);
  });

  it("takes several statuses, repeated or comma-separated", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);
    const expected = [jobs.done, jobs.cancelled].sort();

    expect(referencesOf(await list(w, "status=COMPLETED&status=CANCELLED")).sort()).toEqual(
      expected,
    );
    expect(referencesOf(await list(w, "status=COMPLETED,CANCELLED")).sort()).toEqual(expected);
    expect(referencesOf(await list(w, "status=COMPLETED,,COMPLETED")).sort()).toEqual([jobs.done]);
  });

  it("refuses a view or a status it does not know, naming the field", async () => {
    const w = await workOrderWorld(prisma);
    for (const [query, field] of [
      ["view=nonsense", "view"],
      ["status=FINISHED", "status"],
      ["technicianId=jordan", "technicianId"],
      ["customerId=1", "customerId"],
      ["scheduledFrom=tomorrow", "scheduledFrom"],
      ["sort=reference", "sort"],
      ["order=sideways", "order"],
      ["pageSize=101", "pageSize"],
      ["page=0", "page"],
    ] as const) {
      const response = await list(w, query);
      expect(response.status, `query: ${query}`).toBe(422);
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      // (An invalid entry of a list is reported against its place in it: `status.0`.)
      expect(
        Object.keys(error.fieldErrors ?? {}).some(
          (key) => key === field || key.startsWith(`${field}.`),
        ),
        `query: ${query}`,
      ).toBe(true);
    }
  });
});

describe("GET /admin/work-orders: filters", () => {
  it("filters by technician and by customer", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);

    expect(referencesOf(await list(w, `technicianId=${w.sam.id}`)).sort()).toEqual(
      [jobs.needs, jobs.scheduledSam].sort(),
    );
    expect(referencesOf(await list(w, `customerId=${w.priya.profile.id}`)).sort()).toEqual(
      [jobs.needs, jobs.scheduledSam].sort(),
    );
    expect(
      referencesOf(await list(w, `customerId=${w.priya.profile.id}&technicianId=${w.jordan.id}`)),
    ).toEqual([]);
  });

  it("filters by the day the visit starts, on the business's calendar and inclusive at both ends", async () => {
    const w = await workOrderWorld(prisma);
    // 22:30 in New York on 3 March is already 4 March in UTC.
    const lateEvening = await bookedJob(
      w,
      w.jordan.id,
      at(DAY, "22:30"),
      at("2026-03-04", "00:30"),
    );
    const early = await bookedJob(
      w,
      w.sam.id,
      at("2026-03-04", "00:00"),
      at("2026-03-04", "01:00"),
    );
    const unscheduled = await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });

    expect(referencesOf(await list(w, "scheduledFrom=2026-03-03&scheduledTo=2026-03-03"))).toEqual([
      lateEvening.reference,
    ]);
    expect(referencesOf(await list(w, "scheduledFrom=2026-03-04&scheduledTo=2026-03-04"))).toEqual([
      early.reference,
    ]);
    expect(
      referencesOf(await list(w, "scheduledFrom=2026-03-03&scheduledTo=2026-03-04")).sort(),
    ).toEqual([lateEvening.reference, early.reference].sort());
    // A job with no appointment is in no date range.
    expect(
      referencesOf(await list(w, "scheduledFrom=2026-01-01&scheduledTo=2026-12-31")),
    ).not.toContain(unscheduled.reference);
    // Open-ended ranges.
    expect(referencesOf(await list(w, "scheduledFrom=2026-03-04"))).toEqual([early.reference]);
    expect(referencesOf(await list(w, "scheduledTo=2026-03-03"))).toEqual([lateEvening.reference]);
  });

  it("refuses a range that ends before it starts", async () => {
    const w = await workOrderWorld(prisma);
    const error = expectApiError(await list(w, "scheduledFrom=2026-03-05&scheduledTo=2026-03-04"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(error.fieldErrors?.scheduledTo).toContain("must not be before");
  });

  it("searches the reference and the customer's name and email, ignoring case", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);

    expect(referencesOf(await list(w, `q=${jobs.pending.toLowerCase()}`))).toEqual([jobs.pending]);
    expect(referencesOf(await list(w, `q=${jobs.pending.slice(-5)}`))).toEqual([jobs.pending]);
    expect(referencesOf(await list(w, "q=PRIYA")).sort()).toEqual(
      [jobs.needs, jobs.scheduledSam].sort(),
    );
    expect(referencesOf(await list(w, "q=alex.morgan@example")).length).toBe(5);
    expect(referencesOf(await list(w, "q=nobody%20by%20this%20name"))).toEqual([]);
  });

  it("reads the percent sign and the underscore in a search as themselves", async () => {
    const w = await workOrderWorld(prisma);
    await seedEveryStatus(w);
    expect(referencesOf(await list(w, "q=%25"))).toEqual([]);
    expect(referencesOf(await list(w, "q=_"))).toEqual([]);
  });
});

describe("GET /admin/work-orders: order and pages", () => {
  async function sortedByTime(w: WorkOrderWorld) {
    const late = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-05", "10:00"),
      at("2026-03-05", "11:00"),
    );
    const early = await bookedJob(
      w,
      w.jordan.id,
      at("2026-03-03", "10:00"),
      at("2026-03-03", "11:00"),
    );
    const none = await insertJob(w, { status: WorkOrderStatus.PENDING_SCHEDULING });
    return { late: late.reference, early: early.reference, none: none.reference };
  }

  it("sorts by the start of the visit, with unscheduled jobs last in either direction", async () => {
    const w = await workOrderWorld(prisma);
    const { late, early, none } = await sortedByTime(w);
    expect(referencesOf(await list(w, "sort=scheduledStart&order=asc"))).toEqual([
      early,
      late,
      none,
    ]);
    expect(referencesOf(await list(w, "sort=scheduledStart&order=desc"))).toEqual([
      late,
      early,
      none,
    ]);
  });

  it("sorts by when the job was made", async () => {
    const w = await workOrderWorld(prisma);
    const older = await insertJob(w, { createdAt: new Date("2026-02-20T10:00:00.000Z") });
    const newer = await insertJob(w, { createdAt: new Date("2026-02-25T10:00:00.000Z") });
    expect(referencesOf(await list(w, "sort=createdAt&order=asc"))).toEqual([
      older.reference,
      newer.reference,
    ]);
    expect(referencesOf(await list(w))).toEqual([newer.reference, older.reference]);
  });

  it("sorts by status in the order of the workflow", async () => {
    const w = await workOrderWorld(prisma);
    const jobs = await seedEveryStatus(w);
    const rows = rowsOf(await list(w, "sort=status&order=asc"));
    expect(rows[0]?.reference).toBe(jobs.pending);
    expect(rows.map((row) => row.status).slice(0, 3)).toEqual([
      "PENDING_SCHEDULING",
      "SCHEDULED",
      "SCHEDULED",
    ]);
    expect(rows[rows.length - 1]?.status).toBe("NEEDS_RESCHEDULING");
  });

  it("pages without repeating or losing a job, and reports the totals", async () => {
    const w = await workOrderWorld(prisma);
    await seedEveryStatus(w);
    const seen: string[] = [];
    for (const page of [1, 2, 3, 4]) {
      const response = await list(w, `sort=scheduledStart&order=asc&pageSize=2&page=${page}`);
      const body = bodyOf<AdminWorkOrderListResponse>(response);
      expect(body.pagination).toEqual({ page, pageSize: 2, totalItems: 7, totalPages: 4 });
      seen.push(...body.data.map((row) => row.reference));
    }
    expect(new Set(seen).size).toBe(7);
    expect(rowsOf(await list(w, "pageSize=2&page=5"))).toEqual([]);
  });
});

describe("GET /admin/work-orders: the rows", () => {
  it("gives a row what the table needs and nothing the table must not show", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const [row] = rowsOf(await list(w));
    expect(row).toEqual({
      id: job.id,
      reference: job.reference,
      status: "SCHEDULED",
      statusLabel: "Scheduled",
      serviceName: "AC Repair",
      customerName: "Alex Morgan",
      city: "Harbor City",
      scheduledStart: "2026-03-03T15:00:00.000Z",
      scheduledEnd: "2026-03-03T17:00:00.000Z",
      technician: { id: w.jordan.id, name: "Jordan Lee", calendarColor: "blue" },
      completedAt: null,
      createdAt: row?.createdAt,
    });
    expect(Number.isNaN(Date.parse(row?.createdAt ?? ""))).toBe(false);
    // No contact details or notes in a list row.
    const text = JSON.stringify(row);
    for (const secret of [
      "555-0151",
      "jordan.lee@coolbreeze.test",
      "Larkspur Lane",
      "alex.morgan@",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("shows an unscheduled job with no times and no technician", async () => {
    const w = await workOrderWorld(prisma);
    await newJob(w);
    expect(rowsOf(await list(w))[0]).toMatchObject({
      status: "PENDING_SCHEDULING",
      scheduledStart: null,
      scheduledEnd: null,
      technician: null,
    });
  });
});

describe("GET /admin/work-orders/:id (FR-051)", () => {
  it("gives the whole job, and only these fields", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await prisma.serviceRequest.update({
      where: { id: job.request.id },
      data: { accessNotesSnapshot: "Side gate code is 4471." },
    });
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { accessNotesSnapshot: "Side gate code is 4471." },
    });
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const response = await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, {
      cookie: w.adminCookie,
    });
    const dto = dataOf<AdminWorkOrderDto>(response);

    expect(Object.keys(dto).sort()).toEqual(
      [
        "address",
        "availableActions",
        "cancelReason",
        "cancelledAt",
        "completedAt",
        "completionNote",
        "createdAt",
        "createdBy",
        "customer",
        "id",
        "internalCompletionNote",
        "invoice",
        "quotation",
        "reference",
        "request",
        "scheduledEnd",
        "scheduledStart",
        "scopeDescription",
        "serviceId",
        "serviceName",
        "startedAt",
        "status",
        "statusLabel",
        "technician",
        "timeline",
        "updatedAt",
      ].sort(),
    );
    expect(Object.keys(dto.technician ?? {}).sort()).toEqual(
      ["calendarColor", "email", "id", "isActive", "name", "phone"].sort(),
    );
    expect(Object.keys(dto.quotation).sort()).toEqual(
      [
        "currencyCode",
        "discountAmount",
        "id",
        "lines",
        "reference",
        "subtotal",
        "taxAmount",
        "taxRate",
        "totalAmount",
      ].sort(),
    );
    expect(dto.customer).toEqual({
      id: w.alex.profile.id,
      name: "Alex Morgan",
      email: "alex.morgan@example.test",
      phone: dto.customer.phone,
    });
    expect(dto.customer.phone).toMatch(/\d{3}/);
    expect(dto.address.accessNotes).toBe("Side gate code is 4471.");
    // The technician's private notes are not part of a job's technician.
    expect(JSON.stringify(dto)).not.toContain("Larkspur Lane job");
    // Money is a decimal string beside its currency, never a float.
    expect(dto.quotation.lines.every((line) => /^\d+\.\d{2}$/.test(line.lineTotal))).toBe(true);
    expect(dto.quotation.totalAmount).toMatch(/^\d+\.\d{2}$/);
  });

  it("includes the internal history, with who did what", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const dto = dataOf<AdminWorkOrderDto>(
      await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, { cookie: w.adminCookie }),
    );

    expect(dto.timeline.map((event) => event.action)).toEqual([
      "work_order.created",
      "work_order.scheduled",
    ]);
    expect(dto.timeline[1]).toMatchObject({
      customerVisible: true,
      actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    });
    expect(dto.timeline[1]?.summary).toContain("with Jordan Lee");
  });

  it("lists the actions that fit the job's status", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const read = async () =>
      dataOf<AdminWorkOrderDto>(
        await w.client.get(`${ADMIN_WORK_ORDERS}/${job.id}`, { cookie: w.adminCookie }),
      ).availableActions;

    expect(await read()).toEqual(["SCHEDULE", "CANCEL"]);
    await schedule(w, job, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    expect(await read()).toEqual(["RESCHEDULE", "START", "MARK_NEEDS_RESCHEDULING", "CANCEL"]);
    await prisma.workOrder.update({ where: { id: job.id }, data: { status: "IN_PROGRESS" } });
    expect(await read()).toEqual(["COMPLETE", "MARK_NEEDS_RESCHEDULING"]);
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date("2026-03-03T18:00:00.000Z") },
    });
    // A completed job with no invoice is ready for one (T20).
    expect(await read()).toEqual(["CREATE_INVOICE"]);
  });

  it("answers an unknown job with 404 and a malformed id with 422", async () => {
    const w = await workOrderWorld(prisma);
    expectApiError(
      await w.client.get(`${ADMIN_WORK_ORDERS}/${MISSING_ID}`, { cookie: w.adminCookie }),
      {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      },
    );
    expectApiError(await w.client.get(`${ADMIN_WORK_ORDERS}/nope`, { cookie: w.adminCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

describe("the conflicts pre-check", () => {
  function check(w: WorkOrderWorld, query: string, cookie = w.adminCookie) {
    return w.client.get(`${ADMIN_WORK_ORDERS}/conflicts?${query}`, { cookie });
  }
  const params = (technicianId: string, from: string, to: string, extra = "") =>
    `technicianId=${technicianId}&start=${encodeURIComponent(at(DAY, from))}&end=${encodeURIComponent(at(DAY, to))}${extra}`;

  it("lists the jobs that overlap, earliest first, with what the dialog shows", async () => {
    const w = await workOrderWorld(prisma);
    const second = await bookedJob(w, w.jordan.id, at(DAY, "13:00"), at(DAY, "14:00"));
    const first = await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    const response = await check(w, params(w.jordan.id, "09:00", "15:00"));

    expect(response.status).toBe(200);
    expect(dataOf<SchedulingConflictDto[]>(response)).toEqual([
      {
        id: first.id,
        reference: first.reference,
        status: "SCHEDULED",
        scheduledStart: "2026-03-03T15:00:00.000Z",
        scheduledEnd: "2026-03-03T17:00:00.000Z",
        serviceName: "AC Repair",
        customerName: "Alex Morgan",
      },
      expect.objectContaining({ id: second.id }),
    ]);
  });

  it("says nothing clashes for a back-to-back visit, and for another technician", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    expect(dataOf<unknown[]>(await check(w, params(w.jordan.id, "12:00", "14:00")))).toEqual([]);
    expect(dataOf<unknown[]>(await check(w, params(w.jordan.id, "08:00", "10:00")))).toEqual([]);
    expect(dataOf<unknown[]>(await check(w, params(w.sam.id, "10:00", "12:00")))).toEqual([]);
  });

  it("reports exactly what the schedule endpoint would refuse", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const job = await newJob(w);
    for (const [from, to] of [
      ["09:00", "10:00"],
      ["09:00", "10:01"],
      ["11:59", "13:00"],
      ["12:00", "13:00"],
      ["10:00", "12:00"],
      ["10:30", "11:30"],
    ] as const) {
      const checked = dataOf<unknown[]>(await check(w, params(w.jordan.id, from, to)));
      const tried = await w.client
        .patch(`${ADMIN_WORK_ORDERS}/${job.id}/schedule`, { cookie: w.adminCookie })
        .send({
          scheduledStart: at(DAY, from),
          scheduledEnd: at(DAY, to),
          technicianId: w.jordan.id,
          expectedStatus: "PENDING_SCHEDULING",
        });
      expect(tried.status === 409).toBe(checked.length > 0);
      if (tried.status === 200) {
        // Put the job back so the next window is judged against the same single booking.
        await prisma.workOrder.update({
          where: { id: job.id },
          data: {
            status: "PENDING_SCHEDULING",
            technicianId: null,
            scheduledStart: null,
            scheduledEnd: null,
          },
        });
      }
    }
  });

  it("leaves the job being scheduled out, so it never clashes with itself", async () => {
    const w = await workOrderWorld(prisma);
    const own = await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));

    expect(dataOf<unknown[]>(await check(w, params(w.jordan.id, "10:30", "11:30")))).toHaveLength(
      1,
    );
    expect(
      dataOf<unknown[]>(
        await check(w, params(w.jordan.id, "10:30", "11:30", `&excludeId=${own.id}`)),
      ),
    ).toEqual([]);
  });

  it("ignores jobs that hold no time", async () => {
    const w = await workOrderWorld(prisma);
    for (const status of [
      WorkOrderStatus.PENDING_SCHEDULING,
      WorkOrderStatus.NEEDS_RESCHEDULING,
      WorkOrderStatus.COMPLETED,
      WorkOrderStatus.CANCELLED,
    ]) {
      await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"), status);
    }
    expect(dataOf<unknown[]>(await check(w, params(w.jordan.id, "10:00", "12:00")))).toEqual([]);
    await bookedJob(
      w,
      w.jordan.id,
      at(DAY, "10:00"),
      at(DAY, "12:00"),
      WorkOrderStatus.IN_PROGRESS,
    );
    expect(dataOf<unknown[]>(await check(w, params(w.jordan.id, "10:00", "12:00")))).toHaveLength(
      1,
    );
  });

  it("shows a whole day's jobs for one technician when asked about the day", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "08:00"), at(DAY, "09:00"));
    await bookedJob(w, w.jordan.id, at(DAY, "15:00"), at(DAY, "16:00"));
    await bookedJob(w, w.jordan.id, at("2026-03-04", "08:00"), at("2026-03-04", "09:00"));
    await bookedJob(w, w.sam.id, at(DAY, "08:00"), at(DAY, "09:00"));

    const query = `technicianId=${w.jordan.id}&start=${encodeURIComponent(at(DAY, "00:00"))}&end=${encodeURIComponent(at("2026-03-04", "00:00"))}`;
    const day = dataOf<SchedulingConflictDto[]>(await check(w, query));
    expect(day.map((job) => job.scheduledStart)).toEqual([
      "2026-03-03T13:00:00.000Z",
      "2026-03-03T20:00:00.000Z",
    ]);
  });

  it("changes nothing", async () => {
    const w = await workOrderWorld(prisma);
    await bookedJob(w, w.jordan.id, at(DAY, "10:00"), at(DAY, "12:00"));
    const before = {
      jobs: JSON.stringify(await prisma.workOrder.findMany({ orderBy: { id: "asc" } })),
      events: await prisma.activityEvent.count(),
      notifications: await prisma.notification.count(),
    };
    await check(w, params(w.jordan.id, "09:00", "15:00"));
    expect(JSON.stringify(await prisma.workOrder.findMany({ orderBy: { id: "asc" } }))).toBe(
      before.jobs,
    );
    expect(await prisma.activityEvent.count()).toBe(before.events);
    expect(await prisma.notification.count()).toBe(before.notifications);
  });

  it("refuses a query that is incomplete or does not make sense, naming the field", async () => {
    const w = await workOrderWorld(prisma);
    const start = encodeURIComponent(at(DAY, "10:00"));
    const end = encodeURIComponent(at(DAY, "12:00"));
    for (const [query, field] of [
      ["", "technicianId"],
      [`technicianId=${w.jordan.id}`, "start"],
      [`technicianId=${w.jordan.id}&start=${start}`, "end"],
      [`technicianId=${w.jordan.id}&start=${end}&end=${start}`, "end"],
      [`technicianId=${w.jordan.id}&start=${start}&end=${start}`, "end"],
      [`technicianId=${w.jordan.id}&start=yesterday&end=${end}`, "start"],
      [`technicianId=${w.jordan.id}&start=${start}&end=tomorrow`, "end"],
      [`technicianId=${w.jordan.id}&start=yesterday&end=tomorrow`, "start"],
      [`technicianId=nope&start=${start}&end=${end}`, "technicianId"],
      [`technicianId=${w.jordan.id}&start=${start}&end=${end}&excludeId=x`, "excludeId"],
      [
        `technicianId=${w.jordan.id}&start=${start}&end=${encodeURIComponent(at("2026-03-20", "10:00"))}`,
        "end",
      ],
    ] as const) {
      const response = await check(w, query);
      expect(response.status, `query: ${query}`).toBe(422);
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {}), `query: ${query}`).toContain(field);
    }
  });

  it("answers an unknown technician with 404", async () => {
    const w = await workOrderWorld(prisma);
    expectApiError(await check(w, params(MISSING_ID, "10:00", "12:00")), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe("who may read", () => {
  it("is for the business only: a customer gets 403 on every read, even of their own job, and a visitor 401", async () => {
    const w = await workOrderWorld(prisma);
    const job = await newJob(w);
    const urls = [
      ADMIN_WORK_ORDERS,
      `${ADMIN_WORK_ORDERS}/${job.id}`,
      `${ADMIN_WORK_ORDERS}/conflicts?technicianId=${w.jordan.id}&start=${encodeURIComponent(at(DAY, "10:00"))}&end=${encodeURIComponent(at(DAY, "12:00"))}`,
    ];
    for (const url of urls) {
      expectApiError(await w.client.get(url, { cookie: w.alexCookie }), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
      expectApiError(await w.client.get(url, { cookie: w.priyaCookie }), {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
      expectApiError(await w.client.get(url), { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
  });
});
