import {
  type AdminQuotationDto,
  type AdminRequestDto,
  type CustomerQuotationDto,
  type CustomerQuotationListResponse,
  type CustomerRequestDto,
  ErrorCode,
} from "@fixflow/shared";
import type { Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../lib/clock.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createUser } from "../../test/fixtures.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_QUOTATIONS,
  ALEX,
  CUSTOMER_QUOTATIONS,
  dataOf,
  footprint,
  getAdminRequest,
  makeRequest,
  MISSING_ID,
  quotationSnapshot,
  type QuotationWorld,
  quotationWorld,
  readyDraft,
  sentQuotation,
  startDraft,
  voidRequest,
} from "../../test/quotation-world.js";
import { acceptQuotation } from "./quotations.decision.service.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/**
 * The customer's answer to a quotation (T15, workflow 7.3, FR-044, FR-045, BR-08). The clock starts
 * at 2 March 2026, 04:00 in New York. A quotation valid until 5 March can be answered until
 * 23:59:59 that day in New York, which is 04:59:59 UTC on the 6th.
 */
const VALID_UNTIL = "2026-03-05";
const LAST_SECOND = "2026-03-06T04:59:59.000Z";
const NEXT_MIDNIGHT = "2026-03-06T05:00:00.000Z";
const BUSINESS_EMAIL = "hello@coolbreeze.test";

const accept = (id: string) => `${CUSTOMER_QUOTATIONS}/${id}/accept`;
const decline = (id: string) => `${CUSTOMER_QUOTATIONS}/${id}/decline`;
const read = (id: string) => `${CUSTOMER_QUOTATIONS}/${id}`;

function acceptAs(w: QuotationWorld, id: string, cookie = w.alexCookie) {
  return w.client.post(accept(id), { cookie }).send({});
}

function declineAs(w: QuotationWorld, id: string, body: object = {}, cookie = w.alexCookie) {
  return w.client.post(decline(id), { cookie }).send(body);
}

/** A request with a sent quotation, valid until the 5th, for Alex unless said otherwise. */
async function sentWorld(
  w: QuotationWorld,
  owner: "alex" | "priya" = "alex",
  validUntil = VALID_UNTIL,
) {
  const request = await makeRequest(w, { owner });
  const sent = await sentQuotation(w, request.id, { validUntil });
  return { request, sent };
}

const storedQuotation = (id: string) => prisma.quotation.findUniqueOrThrow({ where: { id } });
const requestStatus = async (id: string) =>
  (await prisma.serviceRequest.findUniqueOrThrow({ where: { id } })).status;
const decisionNotifications = () =>
  prisma.notification.findMany({
    where: { type: { in: ["QUOTATION_ACCEPTED", "QUOTATION_DECLINED"] } },
  });
const decisionEvents = () =>
  prisma.activityEvent.findMany({
    where: { action: { in: ["quotation.accepted", "quotation.declined"] } },
  });

describe("POST /quotations/:id/accept (G.1)", () => {
  it("accepts a sent quotation the customer owns and records who, when and what follows", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.clock.set("2026-03-03T15:30:00.000Z");

    const response = await acceptAs(w, sent.id);

    expect(response.status).toBe(200);
    expect(dataOf<CustomerQuotationDto>(response)).toMatchObject({
      id: sent.id,
      status: "ACCEPTED",
      statusLabel: "Accepted",
      respondedAt: "2026-03-03T15:30:00.000Z",
      totalAmount: "255.64",
    });
    expect(await storedQuotation(sent.id)).toMatchObject({
      status: "ACCEPTED",
      respondedAt: new Date("2026-03-03T15:30:00.000Z"),
      respondedByUserId: w.alex.user.id,
      declineReason: null,
    });
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
  });

  it("writes the quotation's event in both voices, and the request's as the system, staff only", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);

    await acceptAs(w, sent.id);

    const events = await prisma.activityEvent.findMany({
      where: { action: { in: ["quotation.accepted", "request.accepted"] } },
      orderBy: { action: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual(["quotation.accepted", "request.accepted"]);
    const [quotationEvent, requestEvent] = events;
    expect(quotationEvent).toMatchObject({
      actorUserId: w.alex.user.id,
      entityType: "QUOTATION",
      entityId: sent.id,
      requestId: request.id,
      customerId: w.alex.profile.id,
      fromStatus: "SENT",
      toStatus: "ACCEPTED",
      summary: `Alex Morgan accepted quotation ${sent.reference}.`,
      publicSummary: `You accepted quotation ${sent.reference}.`,
    });
    expect(requestEvent).toMatchObject({
      actorUserId: null,
      entityType: "SERVICE_REQUEST",
      fromStatus: "QUOTED",
      toStatus: "ACCEPTED",
      publicSummary: null,
    });
    // The customer's timeline reads the first and never the second.
    const timeline = dataOf<CustomerRequestDto>(
      await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
    ).timeline;
    expect(timeline.map((event) => event.publicSummary)).toContain(
      `You accepted quotation ${sent.reference}.`,
    );
    expect(JSON.stringify(timeline)).not.toContain("moved request");
  });

  it("tells every admin in the app, with a link to the quotation, and emails the business once", async () => {
    const w = await quotationWorld(prisma);
    const secondAdmin = await createUser(prisma, {
      email: "second.admin@example.test",
      name: "Second Admin",
      role: "BUSINESS_ADMIN",
    });
    const { request, sent } = await sentWorld(w);
    const before = w.emails.sent.length;

    await acceptAs(w, sent.id);
    await w.deps.emailDispatcher.idle();

    const notifications = await decisionNotifications();
    expect(notifications.map((notification) => notification.recipientUserId).sort()).toEqual(
      [w.admin.id, secondAdmin.id].sort(),
    );
    for (const notification of notifications) {
      expect(notification).toMatchObject({
        type: "QUOTATION_ACCEPTED",
        title: `Quotation ${sent.reference} accepted`,
        linkPath: `/app/quotations/${sent.id}`,
        entityType: "QUOTATION",
        entityId: sent.id,
        readAt: null,
      });
      expect(notification.message).toContain("Alex Morgan accepted the quotation for AC Repair");
    }
    // One email to the business's own address, not one per admin and not to the customer.
    const emails = w.emails.sent.slice(before);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: BUSINESS_EMAIL });
    expect(emails[0]?.subject).toBe(`Alex Morgan accepted quotation ${sent.reference}`);
    expect(emails[0]?.text).toContain(`/app/requests/${request.id}`);
    expect(emails[0]?.text).toContain("$255.64");
  });

  it("accepts up to 23:59:59 on the last valid day in New York, though UTC is already tomorrow", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    w.clock.set(LAST_SECOND);
    expect(w.clock.now().toISOString().slice(0, 10)).toBe("2026-03-06");

    const response = await acceptAs(w, sent.id);

    expect(response.status).toBe(200);
    expect((await storedQuotation(sent.id)).status).toBe("ACCEPTED");
  });

  it("stands even when the email cannot be sent", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.emails.failWith = new Error("SMTP is down");

    const response = await acceptAs(w, sent.id);
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect((await storedQuotation(sent.id)).status).toBe("ACCEPTED");
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
    expect(await decisionNotifications()).toHaveLength(1);
  });

  it("shows the business the decision: on the quotation, in the request's list and in the request's status", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.clock.set("2026-03-03T15:30:00.000Z");
    await acceptAs(w, sent.id);

    const quotation = dataOf<AdminQuotationDto>(
      await w.client.get(`${ADMIN_QUOTATIONS}/${sent.id}`, { cookie: w.adminCookie }),
    );
    const adminRequest: AdminRequestDto = await getAdminRequest(w, request.id);

    expect(quotation).toMatchObject({
      status: "ACCEPTED",
      respondedAt: "2026-03-03T15:30:00.000Z",
      declineReason: null,
      requestStatus: "ACCEPTED",
      // T17: an accepted quotation whose request is still accepted can become a job (D-43).
      availableActions: ["CREATE_WORK_ORDER"],
    });
    expect(quotation.timeline.map((event) => event.summary)).toContain(
      `Alex Morgan accepted quotation ${sent.reference}.`,
    );
    expect(adminRequest.status).toBe("ACCEPTED");
    expect(adminRequest.quotations).toEqual([
      expect.objectContaining({ id: sent.id, status: "ACCEPTED", statusLabel: "Accepted" }),
    ]);
  });

  it("takes no body: an unknown field is refused and nothing changes", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    const before = await quotationSnapshot(prisma, sent.id);

    const response = await w.client
      .post(accept(sent.id), { cookie: w.alexCookie })
      .send({ status: "ACCEPTED", respondedAt: "2020-01-01T00:00:00.000Z" });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
  });
});

describe("POST /quotations/:id/decline (G.2)", () => {
  it("declines with the customer's reason: the quotation and the request become declined, admins are told", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.clock.set("2026-03-03T15:30:00.000Z");
    const before = w.emails.sent.length;

    const response = await declineAs(w, sent.id, { reason: "  Found a cheaper option.  " });
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect(dataOf<CustomerQuotationDto>(response)).toMatchObject({
      status: "DECLINED",
      respondedAt: "2026-03-03T15:30:00.000Z",
    });
    expect(await storedQuotation(sent.id)).toMatchObject({
      status: "DECLINED",
      respondedAt: new Date("2026-03-03T15:30:00.000Z"),
      respondedByUserId: w.alex.user.id,
      declineReason: "Found a cheaper option.",
    });
    expect(await requestStatus(request.id)).toBe("DECLINED");
    expect(await decisionNotifications()).toEqual([
      expect.objectContaining({
        recipientUserId: w.admin.id,
        type: "QUOTATION_DECLINED",
        title: `Quotation ${sent.reference} declined`,
        linkPath: `/app/quotations/${sent.id}`,
      }),
    ]);
    const emails = w.emails.sent.slice(before);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: BUSINESS_EMAIL,
      subject: `Alex Morgan declined quotation ${sent.reference}`,
    });
  });

  it("declines without a reason, and treats a blank one as none", async () => {
    const w = await quotationWorld(prisma);
    const first = await sentWorld(w);
    const second = await sentWorld(w);

    expect((await declineAs(w, first.sent.id)).status).toBe(200);
    expect((await declineAs(w, second.sent.id, { reason: "   " })).status).toBe(200);

    expect((await storedQuotation(first.sent.id)).declineReason).toBeNull();
    expect((await storedQuotation(second.sent.id)).declineReason).toBeNull();
  });

  it("keeps the reason where the business reads it, and out of the history, the notification and the email", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    const reason = "Too expensive compared with Harbor Cooling's offer.";

    await declineAs(w, sent.id, { reason });
    await w.deps.emailDispatcher.idle();

    const quotation = dataOf<AdminQuotationDto>(
      await w.client.get(`${ADMIN_QUOTATIONS}/${sent.id}`, { cookie: w.adminCookie }),
    );
    expect(quotation.declineReason).toBe(reason);
    const elsewhere = JSON.stringify([
      await decisionEvents(),
      await decisionNotifications(),
      w.emails.sent,
    ]);
    expect(elsewhere).not.toContain("Harbor Cooling");
  });

  it("refuses a reason over 500 characters, naming the field, and changes nothing", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    const before = await quotationSnapshot(prisma, sent.id);
    const events = await footprint(w);

    const response = await declineAs(w, sent.id, { reason: "x".repeat(501) });

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors).toHaveProperty("reason");
    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
    expect(await footprint(w)).toEqual(events);
  });

  it("accepts a reason of exactly 500 characters", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);

    expect((await declineAs(w, sent.id, { reason: "x".repeat(500) })).status).toBe(200);
  });

  it("refuses an unknown field", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);

    const response = await declineAs(w, sent.id, { reason: "No", status: "ACCEPTED" });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect((await storedQuotation(sent.id)).status).toBe("SENT");
  });

  it("lets the business reopen a declined request and quote again (D-21)", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    await declineAs(w, sent.id, { reason: "Too dear." });

    const reopened = await w.client
      .patch(`/api/v1/admin/requests/${request.id}/status`, { cookie: w.adminCookie })
      .send({
        action: "REOPEN",
        expectedStatus: "DECLINED",
        reason: "Customer asked for a lower offer.",
      });

    expect(reopened.status).toBe(200);
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
    expect(await startDraft(w, request.id)).toMatchObject({ status: "DRAFT" });
  });
});

describe("a quotation that cannot be answered (G.3)", () => {
  async function expectRefused(
    w: QuotationWorld,
    send: () => PromiseLike<Response>,
    sent: { id: string },
    messagePattern: RegExp,
    currentStatus: string,
  ) {
    // Emails go out in the background after the response: let the earlier decision's settle before
    // counting (a slow run once counted it late, T25), and the refused call's too, so an email it
    // wrongly queued would be counted.
    await w.deps.emailDispatcher.idle();
    const before = await quotationSnapshot(prisma, sent.id);
    const events = await footprint(w);

    const response = await send();
    await w.deps.emailDispatcher.idle();

    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.QUOTATION_NOT_AVAILABLE,
    });
    expect(error.message).toMatch(messagePattern);
    expect(error).toMatchObject({ details: { currentStatus } });
    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
    expect(await footprint(w)).toEqual(events);
  }

  it("accepting twice is 409 naming the day, and the record is unchanged", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    w.clock.set("2026-03-03T15:30:00.000Z");
    await acceptAs(w, sent.id);
    w.clock.set("2026-03-04T10:00:00.000Z");

    await expectRefused(
      w,
      () => acceptAs(w, sent.id),
      sent,
      /already accepted this quotation on Mar 3, 2026/,
      "ACCEPTED",
    );
    expect(await decisionNotifications()).toHaveLength(1);
  });

  it("declining an accepted quotation is 409", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    await acceptAs(w, sent.id);

    await expectRefused(
      w,
      () => declineAs(w, sent.id, { reason: "Changed my mind." }),
      sent,
      /already accepted this quotation.*can't be declined/,
      "ACCEPTED",
    );
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
  });

  it("accepting a declined quotation is 409, and declining twice says so", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    await declineAs(w, sent.id, { reason: "No thanks." });

    await expectRefused(
      w,
      () => acceptAs(w, sent.id),
      sent,
      /declined this quotation.*can't be accepted/,
      "DECLINED",
    );
    await expectRefused(
      w,
      () => declineAs(w, sent.id),
      sent,
      /already declined this quotation/,
      "DECLINED",
    );
    expect(await requestStatus(request.id)).toBe("DECLINED");
  });

  it("an expired quotation is 409 with the day it ran out, and the expiry is saved anyway", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.clock.set(NEXT_MIDNIGHT);

    const response = await acceptAs(w, sent.id);

    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.QUOTATION_NOT_AVAILABLE,
    });
    expect(error.message).toBe(
      "This quotation was valid until Mar 5, 2026 and has expired. Contact us and we'll send an updated quotation.",
    );
    expect(error).toMatchObject({ details: { currentStatus: "EXPIRED" } });
    // The refusal did not undo the sync: the quotation is expired and the request is back in review.
    expect(await storedQuotation(sent.id)).toMatchObject({ status: "EXPIRED", respondedAt: null });
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
    expect(await decisionNotifications()).toHaveLength(0);
  });

  it("declining an expired quotation is refused the same way", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    w.clock.set("2026-03-07T12:00:00.000Z");

    const response = await declineAs(w, sent.id, { reason: "Too late." });

    expectApiError(response, { status: 409, code: ErrorCode.QUOTATION_NOT_AVAILABLE });
    expect((await storedQuotation(sent.id)).status).toBe("EXPIRED");
  });

  it("a quotation the business withdrew is 409, and says it was withdrawn", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    await voidRequest(w, sent.id, {
      expectedStatus: "SENT",
      reason: "Wrong unit priced, internal only.",
    });

    await expectRefused(
      w,
      () => acceptAs(w, sent.id),
      sent,
      /was withdrawn, so you can't accept it/,
      "VOID",
    );
    await expectRefused(
      w,
      () => declineAs(w, sent.id),
      sent,
      /was withdrawn, so you can't decline it/,
      "VOID",
    );
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
  });

  it("a quotation replaced by a newer one cannot be answered; the new one can", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    const replacement = await startDraft(w, request.id, { replacesQuotationId: sent.id });
    await w.client
      .post(`${ADMIN_QUOTATIONS}/${replacement.id}/send`, { cookie: w.adminCookie })
      .send({ expectedStatus: "DRAFT" });

    await expectRefused(w, () => acceptAs(w, sent.id), sent, /withdrawn/, "VOID");
    const response = await acceptAs(w, replacement.id);

    expect(response.status).toBe(200);
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
  });

  it("leaves no secret of the business in a refusal", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);
    await voidRequest(w, sent.id, {
      expectedStatus: "SENT",
      reason: "Internal: the margin was far too low.",
    });

    const response = await acceptAs(w, sent.id);

    expect(JSON.stringify(response.body)).not.toContain("margin");
  });
});

describe("whose quotation it is (G.4)", () => {
  it("answers another customer's quotation with 404 on GET, accept and decline, and changes nothing", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w, "alex");
    const before = await quotationSnapshot(prisma, sent.id);
    const events = await footprint(w);

    const missing = await w.client.get(read(MISSING_ID), { cookie: w.priyaCookie });
    const get = await w.client.get(read(sent.id), { cookie: w.priyaCookie });
    const acceptResponse = await acceptAs(w, sent.id, w.priyaCookie);
    const declineResponse = await declineAs(w, sent.id, { reason: "Not mine" }, w.priyaCookie);

    for (const response of [get, acceptResponse, declineResponse]) {
      const error = expectApiError(response, { status: 404, code: ErrorCode.NOT_FOUND });
      // The same words as an id that does not exist: it cannot be told apart.
      expect(error.message).toBe((missing.body as { error: { message: string } }).error.message);
    }
    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
    expect(await requestStatus(request.id)).toBe("QUOTED");
    expect(await footprint(w)).toEqual(events);
  });

  it("answers a quotation that does not exist with 404, and a malformed id with 422", async () => {
    const w = await quotationWorld(prisma);

    expectApiError(await acceptAs(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(await declineAs(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(await acceptAs(w, "not-an-id"), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("answers its own owner 404 for a draft and for a draft that was voided, never accepting it", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);
    const before = await quotationSnapshot(prisma, draft.id);

    for (const response of [
      await w.client.get(read(draft.id), { cookie: w.alexCookie }),
      await acceptAs(w, draft.id),
      await declineAs(w, draft.id),
    ]) {
      expectApiError(response, { status: 404, code: ErrorCode.NOT_FOUND });
    }
    expect(await quotationSnapshot(prisma, draft.id)).toBe(before);

    await voidRequest(w, draft.id, { expectedStatus: "DRAFT", reason: "Started by mistake." });
    expectApiError(await acceptAs(w, draft.id), { status: 404, code: ErrorCode.NOT_FOUND });
    expect((await storedQuotation(draft.id)).status).toBe("VOID");
  });

  it("refuses an admin with 403 on accept and decline, and on the customer's list", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    const before = await quotationSnapshot(prisma, sent.id);
    const events = await footprint(w);

    expectApiError(await acceptAs(w, sent.id, w.adminCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(await declineAs(w, sent.id, {}, w.adminCookie), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
    expectApiError(await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.adminCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });

    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
    expect(await requestStatus(request.id)).toBe("QUOTED");
    expect(await footprint(w)).toEqual(events);
  });

  it("refuses a visitor with 401", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);

    for (const response of [
      await w.client.post(accept(sent.id)).send({}),
      await w.client.post(decline(sent.id)).send({}),
      await w.client.get(`${CUSTOMER_QUOTATIONS}/me`),
    ]) {
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
    expect((await storedQuotation(sent.id)).status).toBe("SENT");
  });

  it("refuses an answer from a page on another origin (CSRF)", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w);

    const response = await w.client
      .post(accept(sent.id), { cookie: w.alexCookie, origin: "https://evil.example.com" })
      .send({});

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect((await storedQuotation(sent.id)).status).toBe("SENT");
  });

  it("takes the customer from the session: a body cannot name another", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentWorld(w, "alex");

    const response = await w.client
      .post(decline(sent.id), { cookie: w.priyaCookie })
      .send({ customerId: w.alex.profile.id });

    expect([404, 422]).toContain(response.status);
    expect((await storedQuotation(sent.id)).status).toBe("SENT");
  });
});

describe("one answer only, however many arrive at once (G.5, SEC-TXN-02)", () => {
  it("lets exactly one of an accept and a decline sent together succeed, over and over", async () => {
    const w = await quotationWorld(prisma);

    for (let round = 0; round < 6; round += 1) {
      const { request, sent } = await sentWorld(w);
      const notificationsBefore = (await decisionNotifications()).length;
      const emailsBefore = w.emails.sent.length;

      const [accepted, declined] = await Promise.all([
        acceptAs(w, sent.id),
        declineAs(w, sent.id, { reason: "Decided against it." }),
      ]);
      await w.deps.emailDispatcher.idle();

      const outcomes = [accepted.status, declined.status].sort();
      expect(outcomes, `round ${round}`).toEqual([200, 409]);
      const loser = accepted.status === 409 ? accepted : declined;
      expectApiError(loser, { status: 409, code: ErrorCode.QUOTATION_NOT_AVAILABLE });

      // Whichever won, the quotation, the request, the history, the notification and the email agree.
      const winner = accepted.status === 200 ? "ACCEPTED" : "DECLINED";
      const stored = await storedQuotation(sent.id);
      expect(stored.status).toBe(winner);
      expect(stored.respondedAt).not.toBeNull();
      expect(stored.declineReason).toBe(winner === "DECLINED" ? "Decided against it." : null);
      expect(await requestStatus(request.id)).toBe(winner);
      const events = await prisma.activityEvent.findMany({
        where: { entityId: sent.id, action: { in: ["quotation.accepted", "quotation.declined"] } },
      });
      expect(events).toHaveLength(1);
      const notifications = (await decisionNotifications()).slice(notificationsBefore);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.type).toBe(
        winner === "ACCEPTED" ? "QUOTATION_ACCEPTED" : "QUOTATION_DECLINED",
      );
      expect(w.emails.sent.length - emailsBefore).toBe(1);
    }
  });

  it("lets exactly one of five identical accepts succeed", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);

    const responses = await Promise.all(Array.from({ length: 5 }, () => acceptAs(w, sent.id)));
    await w.deps.emailDispatcher.idle();

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
    expect(await decisionNotifications()).toHaveLength(1);
    expect(await decisionEvents()).toHaveLength(1);
    expect(w.emails.sent.filter((email) => email.to === BUSINESS_EMAIL)).toHaveLength(1);
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
  });

  it("lets the business's void and the customer's accept race: one wins and the state is consistent", async () => {
    const w = await quotationWorld(prisma);

    for (let round = 0; round < 4; round += 1) {
      const { request, sent } = await sentWorld(w);

      const [accepted, voided] = await Promise.all([
        acceptAs(w, sent.id),
        voidRequest(w, sent.id, { expectedStatus: "SENT", reason: "Priced the wrong unit." }),
      ]);

      expect([accepted.status, voided.status].sort(), `round ${round}`).toEqual([200, 409]);
      const stored = await storedQuotation(sent.id);
      if (accepted.status === 200) {
        expect(stored.status).toBe("ACCEPTED");
        expect(await requestStatus(request.id)).toBe("ACCEPTED");
      } else {
        expect(stored.status).toBe("VOID");
        expect(stored.respondedAt).toBeNull();
        expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
      }
    }
  });
});

describe("rate limit (D-12)", () => {
  it("answers the 21st decision in an hour with 429 and Retry-After, and changes nothing", async () => {
    const w = await quotationWorld(prisma, {
      rateLimits: { quotationDecision: { limit: 20, windowSeconds: 3600 } },
    });
    const { sent } = await sentWorld(w);
    // Twenty refused answers still count: they are requests.
    await acceptAs(w, sent.id);
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect((await acceptAs(w, sent.id)).status).toBe(409);
    }
    const before = await quotationSnapshot(prisma, sent.id);

    const response = await acceptAs(w, sent.id);

    expectApiError(response, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(response.headers["retry-after"]).toBeDefined();
    expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
  });

  it("counts per customer: one customer's limit leaves another free to answer", async () => {
    const w = await quotationWorld(prisma, {
      rateLimits: { quotationDecision: { limit: 1, windowSeconds: 3600 } },
    });
    const alex = await sentWorld(w, "alex");
    const priya = await sentWorld(w, "priya");

    expect((await acceptAs(w, alex.sent.id)).status).toBe(200);
    expect((await acceptAs(w, alex.sent.id)).status).toBe(429);
    expect((await declineAs(w, priya.sent.id, {}, w.priyaCookie)).status).toBe(200);
  });

  it("shares one allowance between accept and decline", async () => {
    const w = await quotationWorld(prisma, {
      rateLimits: { quotationDecision: { limit: 1, windowSeconds: 3600 } },
    });
    const { sent } = await sentWorld(w);

    expect((await acceptAs(w, sent.id)).status).toBe(200);
    expect((await declineAs(w, sent.id)).status).toBe(429);
  });
});

describe("GET /quotations/me", () => {
  it("lists what the customer was sent, never a draft, a voided draft or another customer's", async () => {
    const w = await quotationWorld(prisma);
    const sentRequest = await makeRequest(w);
    const sent = await sentQuotation(w, sentRequest.id);
    const draftRequest = await makeRequest(w);
    await readyDraft(w, draftRequest.id);
    const voidedDraftRequest = await makeRequest(w);
    const voidedDraft = await startDraft(w, voidedDraftRequest.id);
    await voidRequest(w, voidedDraft.id, { expectedStatus: "DRAFT", reason: "Started in error." });
    const others = await makeRequest(w, { owner: "priya" });
    await sentQuotation(w, others.id);

    const response = await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const body = response.body as CustomerQuotationListResponse;
    expect(body.data.map((item) => item.id)).toEqual([sent.id]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual(
      [
        "currencyCode",
        "id",
        "reference",
        "replacedBy",
        "requestId",
        "requestReference",
        "respondedAt",
        "sentAt",
        "serviceName",
        "status",
        "statusLabel",
        "totalAmount",
        "validUntil",
      ].sort(),
    );
    expect(body.data[0]).toMatchObject({
      requestId: sentRequest.id,
      requestReference: sentRequest.reference,
      serviceName: "AC Repair",
      status: "SENT",
      totalAmount: "255.64",
      currencyCode: "USD",
    });
  });

  it("puts the quotations awaiting an answer first, the soonest to run out leading, then the rest newest first", async () => {
    const w = await quotationWorld(prisma);
    const late = await sentWorld(w, "alex", "2026-03-20");
    const answered = await sentWorld(w, "alex", "2026-03-18");
    await acceptAs(w, answered.sent.id);
    w.clock.set("2026-03-02T10:00:00.000Z");
    const soon = await sentWorld(w, "alex", "2026-03-08");
    w.clock.set("2026-03-02T11:00:00.000Z");
    const declined = await sentWorld(w, "alex", "2026-03-25");
    await declineAs(w, declined.sent.id);

    const response = await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.alexCookie });

    expect((response.body as CustomerQuotationListResponse).data.map((item) => item.id)).toEqual([
      soon.sent.id,
      late.sent.id,
      declined.sent.id,
      answered.sent.id,
    ]);
  });

  it("pages across the boundary between the two groups without repeating or losing a row", async () => {
    const w = await quotationWorld(prisma);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      w.clock.set(`2026-03-02T1${index}:00:00.000Z`);
      const { sent } = await sentWorld(w, "alex", `2026-03-1${index}`);
      ids.push(sent.id);
    }
    // Two of the three are answered, so one awaits and two follow.
    await acceptAs(w, ids[1] as string);
    await declineAs(w, ids[2] as string);

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const response = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?pageSize=1&page=${page}`, {
        cookie: w.alexCookie,
      });
      const body = response.body as CustomerQuotationListResponse;
      expect(body.pagination).toMatchObject({ page, pageSize: 1, totalItems: 3, totalPages: 3 });
      seen.push(...body.data.map((item) => item.id));
    }
    const wholeList = await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.alexCookie });

    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual((wholeList.body as CustomerQuotationListResponse).data.map((i) => i.id));
    expect(seen[0]).toBe(ids[0]);

    const pageTwo = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?pageSize=2&page=2`, {
      cookie: w.alexCookie,
    });
    expect((pageTwo.body as CustomerQuotationListResponse).data).toHaveLength(1);
  });

  it("narrows to one status, and rejects one a customer cannot have", async () => {
    const w = await quotationWorld(prisma);
    const waiting = await sentWorld(w);
    const answered = await sentWorld(w);
    await acceptAs(w, answered.sent.id);

    const awaiting = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?status=SENT`, {
      cookie: w.alexCookie,
    });
    const accepted = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?status=ACCEPTED`, {
      cookie: w.alexCookie,
    });
    const draft = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?status=DRAFT`, {
      cookie: w.alexCookie,
    });

    expect((awaiting.body as CustomerQuotationListResponse).data.map((i) => i.id)).toEqual([
      waiting.sent.id,
    ]);
    expect((accepted.body as CustomerQuotationListResponse).data.map((i) => i.id)).toEqual([
      answered.sent.id,
    ]);
    expectApiError(draft, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("saves a due expiry before listing, so nothing expired is offered as awaiting a decision", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    w.clock.set(NEXT_MIDNIGHT);

    const awaiting = await w.client.get(`${CUSTOMER_QUOTATIONS}/me?status=SENT`, {
      cookie: w.alexCookie,
    });
    const all = await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.alexCookie });

    expect((awaiting.body as CustomerQuotationListResponse).data).toEqual([]);
    expect((all.body as CustomerQuotationListResponse).data[0]).toMatchObject({
      id: sent.id,
      status: "EXPIRED",
      statusLabel: "Expired",
    });
    expect((await storedQuotation(sent.id)).status).toBe("EXPIRED");
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
  });

  it("is empty for a customer with no quotation", async () => {
    const w = await quotationWorld(prisma);

    const response = await w.client.get(`${CUSTOMER_QUOTATIONS}/me`, { cookie: w.priyaCookie });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [],
      pagination: { totalItems: 0, totalPages: 0 },
    });
  });
});

describe("the customer's request and quotation after the business changes the offer", () => {
  it("lists the quotations on the request, newest first, without a draft", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    const replacement = await startDraft(w, request.id, { replacesQuotationId: sent.id });

    const beforeSend = dataOf<CustomerRequestDto>(
      await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
    );
    expect(beforeSend.quotations.map((q) => q.id)).toEqual([sent.id]);
    expect(JSON.stringify(beforeSend)).not.toContain(replacement.reference);

    // An hour later, as the business really would: the replacement is the newer quotation.
    w.clock.set("2026-03-02T10:00:00.000Z");
    await w.client
      .post(`${ADMIN_QUOTATIONS}/${replacement.id}/send`, { cookie: w.adminCookie })
      .send({ expectedStatus: "DRAFT" });
    const afterSend = dataOf<CustomerRequestDto>(
      await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
    );

    expect(afterSend.quotations.map((q) => [q.id, q.status])).toEqual([
      [replacement.id, "SENT"],
      [sent.id, "VOID"],
    ]);
    // The withdrawn one points to its replacement, and nothing more of the business's reasons.
    expect(afterSend.quotations[1]?.replacedBy).toEqual({
      id: replacement.id,
      reference: replacement.reference,
    });
    expect(JSON.stringify(afterSend)).not.toContain("Replaced by");
  });

  it("shows the decision on the request the customer opens afterwards", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    await acceptAs(w, sent.id);

    const detail = dataOf<CustomerRequestDto>(
      await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie }),
    );

    expect(detail).toMatchObject({ status: "ACCEPTED", statusLabel: "Accepted" });
    expect(detail.quotations[0]).toMatchObject({ id: sent.id, status: "ACCEPTED" });
    expect(detail.quotations[0]?.respondedAt).not.toBeNull();
  });

  it("names a withdrawn quotation's replacement only once the customer was sent it", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    const replacement = await startDraft(w, request.id, { replacesQuotationId: sent.id });

    const whileDraft = dataOf<CustomerQuotationDto>(
      await w.client.get(read(sent.id), { cookie: w.alexCookie }),
    );
    expect(whileDraft.replacedBy).toBeNull();

    await w.client
      .post(`${ADMIN_QUOTATIONS}/${replacement.id}/send`, { cookie: w.adminCookie })
      .send({ expectedStatus: "DRAFT" });
    const afterSend = dataOf<CustomerQuotationDto>(
      await w.client.get(read(sent.id), { cookie: w.alexCookie }),
    );
    expect(afterSend).toMatchObject({
      status: "VOID",
      replacedBy: { id: replacement.id, reference: replacement.reference },
    });
  });
});

describe("all or nothing, and the check made under the lock (TS-INT-03)", () => {
  it("leaves nothing behind when the last step fails, and the answer can be given again", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    const before = await quotationSnapshot(prisma, sent.id);
    const emailsBefore = w.emails.sent.length;

    // The admins' notification is written after the quotation, the request and both events: make it fail.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION zz_fail_decision_notice() RETURNS trigger AS $body$
       BEGIN RAISE EXCEPTION 'the notification could not be written'; END; $body$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER zz_fail_decision_notice BEFORE INSERT ON notifications
       FOR EACH ROW WHEN (NEW.type = 'QUOTATION_ACCEPTED') EXECUTE FUNCTION zz_fail_decision_notice()`,
    );
    try {
      const failed = await acceptAs(w, sent.id);
      await w.deps.emailDispatcher.idle();

      expect(failed.status).toBe(500);
      // Nothing was half done: not the status, the time, the person, the request, the history or an email.
      expect(await quotationSnapshot(prisma, sent.id)).toBe(before);
      expect(await requestStatus(request.id)).toBe("QUOTED");
      expect(await decisionEvents()).toHaveLength(0);
      expect(await prisma.activityEvent.count({ where: { action: "request.accepted" } })).toBe(0);
      expect(await decisionNotifications()).toHaveLength(0);
      expect(w.emails.sent.length).toBe(emailsBefore);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS zz_fail_decision_notice ON notifications`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zz_fail_decision_notice()`);
    }

    // The failure cost the customer nothing: the same answer now goes through, once.
    expect((await acceptAs(w, sent.id)).status).toBe(200);
    await w.deps.emailDispatcher.idle();
    expect((await storedQuotation(sent.id)).status).toBe("ACCEPTED");
    expect(await decisionEvents()).toHaveLength(1);
    expect(await decisionNotifications()).toHaveLength(1);
    expect(w.emails.sent.length - emailsBefore).toBe(1);
  });

  it("refuses an answer that arrives as the last day ends, even though the expiry was not yet due when it began", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentWorld(w);
    // The first reading of the clock (the expiry check made before the answer) is the last second of
    // the last day in New York; the next (inside the answer, under the lock) is the next midnight.
    const clock = clockThatMovesOn(LAST_SECOND, NEXT_MIDNIGHT);
    const auth = {
      userId: w.alex.user.id,
      role: "CUSTOMER" as const,
      email: ALEX,
      customerId: w.alex.profile.id,
      sessionId: "direct-call",
    };

    const refusal = await acceptQuotation({ ...w.deps, clock }, auth, sent.id).then(
      () => undefined,
      (error: unknown) => error,
    );

    // The right words, not the vaguer "changed by someone else" of a guard that caught it too late.
    expect(refusal).toMatchObject({ status: 409, code: ErrorCode.QUOTATION_NOT_AVAILABLE });
    expect((refusal as Error).message).toMatch(/has expired/);
    // Nothing was recorded: the quotation is still as sent (the next read saves its expiry).
    expect(await storedQuotation(sent.id)).toMatchObject({ status: "SENT", respondedAt: null });
    expect(await requestStatus(request.id)).toBe("QUOTED");
    expect(await decisionNotifications()).toHaveLength(0);
  });
});

/** A clock that says `first` once and `later` ever after: midnight passes while an answer is on its way. */
function clockThatMovesOn(first: string, later: string): Clock {
  let readings = 0;
  return {
    now() {
      readings += 1;
      return new Date(readings === 1 ? first : later);
    },
  };
}
