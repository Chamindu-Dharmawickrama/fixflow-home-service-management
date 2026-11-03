import {
  type AdminRequestDto,
  type AdminWorkOrderDto,
  type CustomerRequestDto,
  ErrorCode,
  RequestAction,
  ServiceRequestStatus,
  WorkOrderAction,
  WorkOrderStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import {
  ADMIN_QUOTATIONS,
  ADMIN_REQUESTS,
  dataOf,
  getAdminRequest,
  makeRequest,
  MISSING_ID,
  sentQuotation,
  voidRequest,
} from "../../test/quotation-world.js";
import {
  acceptedQuotation,
  ADMIN_QUOTATION_ROUTES,
  ADMIN_WORK_ORDERS,
  convertRequest,
  insertJob,
  workOrderWorld,
} from "../../test/work-order-world.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("POST /admin/quotations/:id/work-order (G.1)", () => {
  it("turns an accepted quotation into a job without re-entering anything", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { addressLine2: "Unit 4B", accessNotesSnapshot: "Side gate code is 4471." },
    });

    const response = await convertRequest(w, quotation.id);
    expect(response.status).toBe(201);
    const job = dataOf<AdminWorkOrderDto>(response);

    expect(job.reference).toMatch(/^JOB-2026-\d{5}$/);
    expect(job).toMatchObject({
      status: WorkOrderStatus.PENDING_SCHEDULING,
      statusLabel: "Pending scheduling",
      serviceName: "AC Repair",
      serviceId: w.service.id,
      scheduledStart: null,
      scheduledEnd: null,
      technician: null,
      startedAt: null,
      completedAt: null,
      customer: { id: w.alex.profile.id, name: "Alex Morgan", email: "alex.morgan@example.test" },
      address: {
        line1: "214 Larkspur Lane",
        line2: "Unit 4B",
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
        accessNotes: "Side gate code is 4471.",
      },
      request: { id: request.id, reference: request.reference },
      quotation: { id: quotation.id, reference: quotation.reference },
      createdBy: { name: "Morgan Reyes" },
      availableActions: [WorkOrderAction.SCHEDULE, WorkOrderAction.CANCEL],
    });
    // The agreed lines travel with the job, with the quotation's own totals.
    expect(job.quotation.lines.map((line) => line.description)).toEqual([
      "Diagnostic visit",
      "Run capacitor",
      "Labour",
    ]);
    expect(job.quotation.totalAmount).toBe(quotation.totalAmount);
    expect(job.quotation.currencyCode).toBe("USD");
  });

  it("writes the scope from the request's description and the accepted lines", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(job.scopeDescription).toBe(
      `${stored.description}\n\nAgreed work:\n- Diagnostic visit\n- Run capacitor\n- Labour`,
    );
  });

  it("copies the customer, service and address as columns of the job, so later edits do not move it", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    // The service is renamed and the request's own copy is edited afterwards.
    await prisma.service.update({ where: { id: w.service.id }, data: { name: "Renamed Service" } });
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { addressLine1: "9 Somewhere Else Road" },
    });

    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored).toMatchObject({
      customerId: w.alex.profile.id,
      serviceId: w.service.id,
      serviceNameSnapshot: "AC Repair",
      addressLine1: "214 Larkspur Lane",
      addressCity: "Harbor City",
      createdByUserId: w.admin.id,
      status: "PENDING_SCHEDULING",
    });
  });

  it("moves the request to CONVERTED_TO_JOB, and stops offering to create a job", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);

    const before = await getAdminRequest(w, request.id);
    expect(before.status).toBe(ServiceRequestStatus.ACCEPTED);
    expect(before.availableActions).toContain(RequestAction.CREATE_WORK_ORDER);

    await convertRequest(w, quotation.id);

    const after = await getAdminRequest(w, request.id);
    expect(after.status).toBe(ServiceRequestStatus.CONVERTED_TO_JOB);
    expect(after.availableActions).not.toContain(RequestAction.CREATE_WORK_ORDER);
    expect(after.availableActions).not.toContain(RequestAction.CANCEL);
    // The customer sees it too.
    const mine = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });
    expect(dataOf<CustomerRequestDto>(mine).status).toBe(ServiceRequestStatus.CONVERTED_TO_JOB);
  });

  it("reads back the same job from GET /admin/work-orders/:id", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const created = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    const read = await w.client.get(`${ADMIN_WORK_ORDERS}/${created.id}`, {
      cookie: w.adminCookie,
    });
    expect(read.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(read)).toEqual(created);
  });

  it("numbers jobs in sequence, from the business's calendar year", async () => {
    const w = await workOrderWorld(prisma);
    const first = dataOf<AdminWorkOrderDto>(
      await convertRequest(w, (await acceptedQuotation(w)).quotation.id),
    );
    const second = dataOf<AdminWorkOrderDto>(
      await convertRequest(w, (await acceptedQuotation(w, "priya")).quotation.id),
    );
    expect(first.reference).toBe("JOB-2026-00001");
    expect(second.reference).toBe("JOB-2026-00002");
  });

  it("belongs to the quotation's own customer", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w, "priya");
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));
    expect(job.customer.name).toBe("Priya Shah");
  });
});

describe("converting twice (G.1: exactly one work order)", () => {
  it("returns the existing job with 200, the same id, and makes no second row or number", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);

    const first = await convertRequest(w, quotation.id);
    const second = await convertRequest(w, quotation.id);
    const third = await convertRequest(w, quotation.id);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    const ids = [first, second, third].map((r) => dataOf<AdminWorkOrderDto>(r).id);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.workOrder.count()).toBe(1);
    // No number was used up by the repeats: the next job is the second.
    const counter = await prisma.referenceCounter.findFirstOrThrow({
      where: { type: "WORK_ORDER" },
    });
    expect(counter.value).toBe(1);
  });

  it("records the creation once", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));
    await convertRequest(w, quotation.id);

    const created = await prisma.activityEvent.findMany({
      where: { action: "work_order.created" },
    });
    const converted = await prisma.activityEvent.findMany({
      where: { action: "request.converted_to_job" },
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.entityId).toBe(job.id);
    expect(converted).toHaveLength(1);
  });

  it("answers the same way after the job has moved on: it returns the job as it is now", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));
    await prisma.workOrder.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date("2026-03-02T12:00:00.000Z") },
    });

    const again = await convertRequest(w, quotation.id);
    expect(again.status).toBe(200);
    expect(dataOf<AdminWorkOrderDto>(again).status).toBe(WorkOrderStatus.COMPLETED);
  });

  it("makes one job when five conversions arrive together, and every answer names it", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => convertRequest(w, quotation.id)),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const ids = responses.map((r) => dataOf<AdminWorkOrderDto>(r).id);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.workOrder.count()).toBe(1);
    expect(await prisma.activityEvent.count({ where: { action: "work_order.created" } })).toBe(1);
    const counter = await prisma.referenceCounter.findFirstOrThrow({
      where: { type: "WORK_ORDER" },
    });
    expect(counter.value).toBe(1);
  });

  it("makes one job in each of several rounds of two simultaneous conversions", async () => {
    const w = await workOrderWorld(prisma);
    for (let round = 0; round < 4; round += 1) {
      const { quotation } = await acceptedQuotation(w);
      const [a, b] = await Promise.all([
        convertRequest(w, quotation.id),
        convertRequest(w, quotation.id),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(dataOf<AdminWorkOrderDto>(a).id).toBe(dataOf<AdminWorkOrderDto>(b).id);
    }
    expect(await prisma.workOrder.count()).toBe(4);
  });

  it("falls back to the winner when the database itself refuses a second job (unique quotation)", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);

    // Another conversion commits its job between our first look and our transaction, and our
    // insert then collides with it: the unique violation must be answered with that job.
    const original = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(w.deps.prisma, "$transaction").mockImplementationOnce(async () => {
      const rival = await insertJob(w, { status: "PENDING_SCHEDULING" });
      await prisma.workOrder.update({
        where: { id: rival.id },
        data: { quotationId: quotation.id },
      });
      throw Object.assign(new Error("Unique constraint failed on work_orders_quotation_id_key"), {
        code: "P2002",
      });
    });

    const response = await convertRequest(w, quotation.id);
    spy.mockRestore();
    void original;

    expect(response.status).toBe(200);
    const winner = await prisma.workOrder.findUniqueOrThrow({
      where: { quotationId: quotation.id },
    });
    expect(dataOf<AdminWorkOrderDto>(response).id).toBe(winner.id);
    expect(await prisma.workOrder.count()).toBe(1);
  });

  it("does not hide a unique violation that has no winner behind it", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const spy = vi
      .spyOn(w.deps.prisma, "$transaction")
      .mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error("boom"), { code: "P2002" })),
      );

    const response = await convertRequest(w, quotation.id);
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(await prisma.workOrder.count()).toBe(0);
  });
});

describe("a quotation that cannot be converted (G.1)", () => {
  async function unchanged(
    w: Awaited<ReturnType<typeof workOrderWorld>>,
    requestId: string,
    quotationId: string,
  ) {
    expect(await prisma.workOrder.count()).toBe(0);
    expect(await prisma.activityEvent.count({ where: { action: "work_order.created" } })).toBe(0);
    const request = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    return { requestStatus: request.status, quotationStatus: quotation.status, w };
  }

  it("refuses a quotation that was sent but not accepted", async () => {
    const w = await workOrderWorld(prisma);
    const request = await makeRequest(w);
    const quotation = await sentQuotation(w, request.id);

    const response = await convertRequest(w, quotation.id);
    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.message).toContain(quotation.reference);
    expect(error.message).toContain("accepted");
    expect(error.details).toMatchObject({ currentStatus: "SENT", requestStatus: "QUOTED" });
    expect(await unchanged(w, request.id, quotation.id)).toMatchObject({
      requestStatus: "QUOTED",
      quotationStatus: "SENT",
    });
  });

  it("refuses a draft", async () => {
    const w = await workOrderWorld(prisma);
    const request = await makeRequest(w);
    const draft = dataOf<{ id: string }>(
      await w.client
        .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
        .send({}),
    );

    expectApiError(await convertRequest(w, draft.id), {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect((await unchanged(w, request.id, draft.id)).quotationStatus).toBe("DRAFT");
  });

  it("refuses a declined quotation", async () => {
    const w = await workOrderWorld(prisma);
    const request = await makeRequest(w);
    const quotation = await sentQuotation(w, request.id);
    await w.client
      .post(`/api/v1/quotations/${quotation.id}/decline`, { cookie: w.alexCookie })
      .send({});

    expectApiError(await convertRequest(w, quotation.id), {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(await unchanged(w, request.id, quotation.id)).toMatchObject({
      requestStatus: "DECLINED",
      quotationStatus: "DECLINED",
    });
  });

  it("refuses a voided quotation", async () => {
    const w = await workOrderWorld(prisma);
    const request = await makeRequest(w);
    const quotation = await sentQuotation(w, request.id);
    const voided = await voidRequest(w, quotation.id, {
      expectedStatus: "SENT",
      reason: "Priced the wrong unit.",
    });
    expect(voided.status).toBe(200);

    expectApiError(await convertRequest(w, quotation.id), {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect((await unchanged(w, request.id, quotation.id)).quotationStatus).toBe("VOID");
  });

  it("refuses an accepted quotation whose request was cancelled afterwards", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const cancelled = await w.client
      .patch(`${ADMIN_REQUESTS}/${request.id}/status`, { cookie: w.adminCookie })
      .send({
        action: "CANCEL",
        expectedStatus: "ACCEPTED",
        reason: "The customer called to cancel.",
      });
    expect(cancelled.status).toBe(200);

    const error = expectApiError(await convertRequest(w, quotation.id), {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.message).toContain(request.reference);
    expect((await unchanged(w, request.id, quotation.id)).requestStatus).toBe("CANCELLED");
  });

  it("answers an unknown quotation with 404 and a malformed id with 422", async () => {
    const w = await workOrderWorld(prisma);
    expectApiError(await convertRequest(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(await convertRequest(w, "not-an-id"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("leaves a quotation of the same request that is not the accepted one alone", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    // Reopening is impossible here, so the older, voided draft stands for "another quotation".
    const other = await prisma.quotation.create({
      data: {
        reference: "QT-2026-77777",
        requestId: request.id,
        customerId: w.alex.profile.id,
        createdByUserId: w.admin.id,
        status: "VOID",
        voidedAt: new Date("2026-03-01T10:00:00.000Z"),
        voidReason: "Replaced by a better offer.",
        currencyCode: "USD",
        taxRate: "8.00",
        subtotal: "10.00",
        discountAmount: "0.00",
        taxableBase: "10.00",
        taxAmount: "0.80",
        totalAmount: "10.80",
        validUntil: new Date("2026-12-01"),
      },
    });
    expect((await convertRequest(w, other.id)).status).toBe(409);
    expect((await convertRequest(w, quotation.id)).status).toBe(201);
  });
});

describe("who may convert", () => {
  it("is for the business only: a customer gets 403, a visitor 401, a cross-origin write 403, and nothing is made", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const url = `${ADMIN_QUOTATION_ROUTES}/${quotation.id}/work-order`;

    expectApiError(await w.client.post(url, { cookie: w.alexCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(await w.client.post(url), { status: 401, code: ErrorCode.UNAUTHENTICATED });
    expectApiError(
      await w.client.post(url, { cookie: w.adminCookie, origin: "https://evil.example" }),
      {
        status: 403,
        code: ErrorCode.CSRF_ORIGIN_MISMATCH,
      },
    );
    expect(await prisma.workOrder.count()).toBe(0);
  });

  it("is not limited by the customer's ownership: the quotation's owner cannot convert their own", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w, "priya");
    // Alex is another customer; Priya, the owner, is still a customer.
    expect((await convertRequest(w, quotation.id, w.priyaCookie)).status).toBe(403);
    expect((await convertRequest(w, quotation.id, w.alexCookie)).status).toBe(403);
  });
});

describe("the history of a conversion", () => {
  it("writes the job's event in both voices and the request's as the system, staff only", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    const jobEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "work_order.created" },
    });
    expect(jobEvent).toMatchObject({
      actorUserId: w.admin.id,
      entityType: "WORK_ORDER",
      entityId: job.id,
      requestId: request.id,
      customerId: w.alex.profile.id,
      fromStatus: null,
      toStatus: "PENDING_SCHEDULING",
      summary: `Morgan Reyes created job ${job.reference} from quotation ${quotation.reference} for request ${request.reference}.`,
      publicSummary: `We created job ${job.reference} for your request.`,
    });
    expect(jobEvent.metadata).toEqual({
      workOrderReference: job.reference,
      requestReference: request.reference,
      quotationReference: quotation.reference,
      serviceName: "AC Repair",
    });

    const requestEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "request.converted_to_job" },
    });
    expect(requestEvent).toMatchObject({
      actorUserId: null,
      entityType: "SERVICE_REQUEST",
      entityId: request.id,
      fromStatus: "ACCEPTED",
      toStatus: "CONVERTED_TO_JOB",
      publicSummary: null,
    });
  });

  it("shows the customer that the job was created, and nothing of the system's own step", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    const mine = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });
    const timeline = dataOf<CustomerRequestDto>(mine).timeline.map((event) => event.publicSummary);
    expect(timeline).toContain(`We created job ${job.reference} for your request.`);
    expect(JSON.stringify(timeline)).not.toContain("moved request");
    expect(JSON.stringify(timeline)).not.toContain(quotation.reference.replace("QT", "XX"));
  });

  it("shows the business the job's own history and the request's", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const job = dataOf<AdminWorkOrderDto>(await convertRequest(w, quotation.id));

    expect(job.timeline.map((event) => event.action)).toEqual(["work_order.created"]);
    const admin = await getAdminRequest(w, request.id);
    expect(admin.timeline.map((event) => event.action)).toEqual(
      expect.arrayContaining(["work_order.created", "request.converted_to_job"]),
    );
  });

  it("sends the customer nothing yet: they are told when the visit is scheduled", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    const before = await prisma.notification.count({ where: { recipientUserId: w.alex.user.id } });
    await convertRequest(w, quotation.id);
    await w.deps.emailDispatcher.idle();

    expect(await prisma.notification.count({ where: { recipientUserId: w.alex.user.id } })).toBe(
      before,
    );
    expect(w.emails.sent.filter((mail) => mail.to === "alex.morgan@example.test")).toHaveLength(1);
    // (that one is the quotation sent earlier.)
  });
});

describe("atomicity", () => {
  it("leaves nothing behind when a step fails: no job, no number, the request still accepted", async () => {
    const w = await workOrderWorld(prisma);
    const { request, quotation } = await acceptedQuotation(w);
    const countersBefore = await prisma.referenceCounter.findMany({
      where: { type: "WORK_ORDER" },
    });

    // A trigger that refuses the request's own history event, which is written last.
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION refuse_conversion_event() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'request.converted_to_job' THEN RAISE EXCEPTION 'refused for the test'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER refuse_conversion_event BEFORE INSERT ON activity_events
       FOR EACH ROW EXECUTE FUNCTION refuse_conversion_event()`,
    );
    try {
      const failed = await convertRequest(w, quotation.id);
      expect(failed.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER refuse_conversion_event ON activity_events");
      await prisma.$executeRawUnsafe("DROP FUNCTION refuse_conversion_event()");
    }

    expect(await prisma.workOrder.count()).toBe(0);
    expect(await prisma.activityEvent.count({ where: { action: "work_order.created" } })).toBe(0);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("ACCEPTED");
    expect(await prisma.referenceCounter.findMany({ where: { type: "WORK_ORDER" } })).toEqual(
      countersBefore,
    );

    // And the same conversion then goes through once.
    const retry = await convertRequest(w, quotation.id);
    expect(retry.status).toBe(201);
    expect(dataOf<AdminWorkOrderDto>(retry).reference).toBe("JOB-2026-00001");
  });
});

describe("the request's actions", () => {
  it("lists CREATE_WORK_ORDER only for an accepted request", async () => {
    const w = await workOrderWorld(prisma);
    const queued = await makeRequest(w);
    const queuedView = bodyOf<{ data: AdminRequestDto }>(
      await w.client.get(`${ADMIN_REQUESTS}/${queued.id}`, { cookie: w.adminCookie }),
    ).data;
    expect(queuedView.availableActions).not.toContain(RequestAction.CREATE_WORK_ORDER);

    const { request } = await acceptedQuotation(w);
    const acceptedView = await getAdminRequest(w, request.id);
    expect(acceptedView.availableActions[0]).toBe(RequestAction.CREATE_WORK_ORDER);
  });

  it("is not a status action: the request's status endpoint refuses it", async () => {
    const w = await workOrderWorld(prisma);
    const { request } = await acceptedQuotation(w);
    const response = await w.client
      .patch(`${ADMIN_REQUESTS}/${request.id}/status`, { cookie: w.adminCookie })
      .send({ action: "CREATE_WORK_ORDER", expectedStatus: "ACCEPTED" });
    expect(response.status).toBe(422);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("ACCEPTED");
  });

  it("keeps the quotation page's own status unchanged by conversion", async () => {
    const w = await workOrderWorld(prisma);
    const { quotation } = await acceptedQuotation(w);
    await convertRequest(w, quotation.id);
    const read = await w.client.get(`${ADMIN_QUOTATIONS}/${quotation.id}`, {
      cookie: w.adminCookie,
    });
    expect(dataOf<{ status: string }>(read).status).toBe("ACCEPTED");
  });
});

describe("the order of the waiting (SEC-TXN-02)", () => {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("waits for the request before it takes anything else, so two conversions take turns cleanly", async () => {
    const w = await workOrderWorld(prisma);
    // A first job, so the work-order reference counter row for the year exists to be probed.
    await convertRequest(w, (await acceptedQuotation(w)).quotation.id);
    const { request, quotation } = await acceptedQuotation(w, "priya");

    // Another connection holds the request's row, as a conversion in flight would.
    let release: () => void = () => undefined;
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${request.id}::uuid FOR UPDATE`;
        held();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      { timeout: 60_000 },
    );
    await holding;

    const conversion = convertRequest(w, quotation.id);
    const early = await Promise.race([
      conversion.then(() => "finished"),
      pause(600).then(() => "waiting"),
    ]);
    expect(early).toBe("waiting");

    // While it waits it has taken nothing else: the reference counter is free for anyone to use.
    // (A conversion that took the counter first would hold it, and would make every other new
    // job, request and quotation of the year queue behind this one.)
    const probe =
      await prisma.$queryRaw`SELECT value FROM reference_counters WHERE type = 'WORK_ORDER'::"reference_type" FOR UPDATE NOWAIT`.then(
        () => "free",
        () => "locked",
      );
    expect(probe).toBe("free");

    release();
    await holder;
    const finished = await conversion;
    expect(finished.status).toBe(201);
    expect(await prisma.workOrder.count()).toBe(2);
  });
});
