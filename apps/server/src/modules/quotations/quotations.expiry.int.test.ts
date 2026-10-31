import { type AdminQuotationDto, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_QUOTATIONS,
  ADMIN_REQUESTS,
  dataOf,
  getAdminRequest,
  makeRequest,
  quotationSnapshot,
  type QuotationWorld,
  quotationWorld,
  saveBody,
  sendRequest,
  sentQuotation,
  voidRequest,
} from "../../test/quotation-world.js";
import { syncExpiredQuotations } from "./quotations.transitions.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/**
 * The quotation is valid until 5 March 2026. New York is on standard time (UTC-5) until 8 March, so
 * its last second is 23:59:59 on the 5th, which is 04:59:59 UTC on the 6th.
 */
const VALID_UNTIL = "2026-03-05";
const LAST_SECOND = "2026-03-06T04:59:59.000Z";
const NEXT_MIDNIGHT = "2026-03-06T05:00:00.000Z";

const quotationPath = (id: string) => `${ADMIN_QUOTATIONS}/${id}`;

async function sentUntilFifth(w: QuotationWorld, owner: "alex" | "priya" = "alex") {
  const request = await makeRequest(w, { owner });
  const sent = await sentQuotation(w, request.id, { validUntil: VALID_UNTIL });
  return { request, sent };
}

async function readQuotation(w: QuotationWorld, id: string) {
  const response = await w.client.get(quotationPath(id), { cookie: w.adminCookie });
  expect(response.status).toBe(200);
  return dataOf<AdminQuotationDto>(response);
}

const expiryEvents = () =>
  prisma.activityEvent.findMany({ where: { action: "quotation.expired" } });
const requestStatus = async (id: string) =>
  (await prisma.serviceRequest.findUniqueOrThrow({ where: { id } })).status;

describe("a sent quotation expires after 23:59:59 on its last day, in the business's time zone (D-22, D-23, G.5)", () => {
  it("is still sent at the last second of the last day, though UTC is already the next day", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);

    w.clock.set(LAST_SECOND);
    expect(w.clock.now().toISOString().slice(0, 10)).toBe("2026-03-06"); // UTC has moved on

    const view = await readQuotation(w, sent.id);

    expect(view.status).toBe("SENT");
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe(
      "SENT",
    );
    expect(await requestStatus(request.id)).toBe("QUOTED");
    expect(await expiryEvents()).toHaveLength(0);
  });

  it("expires at the next local midnight: saved, recorded and the request goes back under review", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    const customerEvents = await prisma.notification.count();

    w.clock.set(NEXT_MIDNIGHT);
    const view = await readQuotation(w, sent.id);

    expect(view).toMatchObject({
      status: "EXPIRED",
      statusLabel: "Expired",
      requestStatus: "UNDER_REVIEW",
      availableActions: [],
      expiredAt: NEXT_MIDNIGHT,
    });
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(stored.status).toBe("EXPIRED");
    expect(stored.expiredAt?.toISOString()).toBe(NEXT_MIDNIGHT);
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");

    const events = await expiryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "QUOTATION",
      entityId: sent.id,
      requestId: request.id,
      customerId: w.alex.profile.id,
      actorUserId: null,
      fromStatus: "SENT",
      toStatus: "EXPIRED",
      publicSummary: `We marked quotation ${sent.reference} as expired.`,
      summary: `The system marked quotation ${sent.reference} as expired because its valid-until date passed.`,
    });
    expect(events[0]?.metadata).toMatchObject({
      quotationReference: sent.reference,
      validUntil: VALID_UNTIL,
    });
    const resumed = await prisma.activityEvent.findMany({
      where: { action: "request.review_resumed" },
    });
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      actorUserId: null,
      fromStatus: "QUOTED",
      toStatus: "UNDER_REVIEW",
      publicSummary: null,
    });
    // Nothing is sent to anyone when time passes.
    expect(await prisma.notification.count()).toBe(customerEvents);
  });

  it("expires at local midnight whatever the time zone: a business ahead of UTC", async () => {
    const w = await quotationWorld(prisma);
    await prisma.businessSettings.updateMany({ data: { timeZone: "Asia/Tokyo" } });
    const { sent } = await sentUntilFifth(w);

    // Tokyo is UTC+9: the last second of the 5th is 14:59:59 UTC the same day.
    w.clock.set("2026-03-05T14:59:59.000Z");
    expect((await readQuotation(w, sent.id)).status).toBe("SENT");
    w.clock.set("2026-03-05T15:00:00.000Z");
    expect((await readQuotation(w, sent.id)).status).toBe("EXPIRED");
  });

  it("does nothing the second time: the same event once, however often it is read", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    await readQuotation(w, sent.id);
    const afterFirst = await prisma.activityEvent.count();
    await readQuotation(w, sent.id);
    await readQuotation(w, sent.id);

    expect(await prisma.activityEvent.count()).toBe(afterFirst);
    expect(await expiryEvents()).toHaveLength(1);
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(stored.expiredAt?.toISOString()).toBe(NEXT_MIDNIGHT);
  });

  it("expires once when many reads arrive together", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        w.client.get(quotationPath(sent.id), { cookie: w.adminCookie }),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(dataOf<AdminQuotationDto>(response).status).toBe("EXPIRED");
    }
    expect(await expiryEvents()).toHaveLength(1);
    expect(await prisma.activityEvent.count({ where: { action: "request.review_resumed" } })).toBe(
      1,
    );
    expect(await requestStatus(request.id)).toBe("UNDER_REVIEW");
  });

  it("syncExpiredQuotations is idempotent when called directly, and says how many it expired", async () => {
    const w = await quotationWorld(prisma);
    await sentUntilFifth(w);
    await sentUntilFifth(w, "priya");

    expect(
      await prisma.$transaction((tx) => syncExpiredQuotations(tx, new Date(LAST_SECOND))),
    ).toEqual({
      expired: 0,
    });
    expect(
      await prisma.$transaction((tx) => syncExpiredQuotations(tx, new Date(NEXT_MIDNIGHT))),
    ).toEqual({
      expired: 2,
    });
    expect(
      await prisma.$transaction((tx) => syncExpiredQuotations(tx, new Date(NEXT_MIDNIGHT))),
    ).toEqual({
      expired: 0,
    });
    expect(await expiryEvents()).toHaveLength(2);
    expect(await prisma.quotation.count({ where: { status: "SENT" } })).toBe(0);
  });

  it("expires several requests' quotations together, even when two syncs run at once", async () => {
    const w = await quotationWorld(prisma);
    const first = await sentUntilFifth(w);
    const second = await sentUntilFifth(w, "priya");
    w.clock.set(NEXT_MIDNIGHT);

    const results = await Promise.all([
      prisma.$transaction((tx) => syncExpiredQuotations(tx, new Date(NEXT_MIDNIGHT))),
      prisma.$transaction((tx) => syncExpiredQuotations(tx, new Date(NEXT_MIDNIGHT))),
    ]);

    expect(results.reduce((sum, result) => sum + result.expired, 0)).toBe(2);
    expect(await expiryEvents()).toHaveLength(2);
    expect(await requestStatus(first.request.id)).toBe("UNDER_REVIEW");
    expect(await requestStatus(second.request.id)).toBe("UNDER_REVIEW");
  });

  it("leaves a quotation the customer already answered alone", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    await prisma.quotation.update({
      where: { id: sent.id },
      data: { status: "ACCEPTED", respondedAt: new Date("2026-03-04T10:00:00.000Z") },
    });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { status: "ACCEPTED" } });
    w.clock.set(NEXT_MIDNIGHT);

    const view = await readQuotation(w, sent.id);

    expect(view.status).toBe("ACCEPTED");
    expect(await expiryEvents()).toHaveLength(0);
    expect(await requestStatus(request.id)).toBe("ACCEPTED");
  });

  it("leaves a voided quotation alone", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentUntilFifth(w);
    await voidRequest(w, sent.id, { expectedStatus: "SENT", reason: "Priced the wrong unit." });
    w.clock.set(NEXT_MIDNIGHT);

    expect((await readQuotation(w, sent.id)).status).toBe("VOID");
    expect(await expiryEvents()).toHaveLength(0);
  });

  it("keeps a quotation that still has days left", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id); // valid until 16 March
    w.clock.set(NEXT_MIDNIGHT);

    expect((await readQuotation(w, sent.id)).status).toBe("SENT");
    expect(await requestStatus(request.id)).toBe("QUOTED");
  });
});

describe("every read that shows a status saves a due expiry first (D-23)", () => {
  it("the request's page shows it back under review, with the quotation expired", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const view = await getAdminRequest(w, request.id);

    expect(view.status).toBe("UNDER_REVIEW");
    expect(view.quotations).toEqual([
      expect.objectContaining({ id: sent.id, status: "EXPIRED", statusLabel: "Expired" }),
    ]);
    // A new quotation can be prepared at once.
    expect(view.availableActions).toEqual(["CREATE_QUOTATION", "CANCEL"]);
  });

  it("the queue shows the request under review", async () => {
    const w = await quotationWorld(prisma);
    const { request } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const response = await w.client.get(`${ADMIN_REQUESTS}?status=QUOTED`, {
      cookie: w.adminCookie,
    });

    expect(response.status).toBe(200);
    const body = response.body as {
      data: { id: string }[];
      meta: { statusCounts: Record<string, number> };
    };
    expect(body.data.map((row) => row.id)).not.toContain(request.id);
    expect(body.meta.statusCounts).toMatchObject({ QUOTED: 0, UNDER_REVIEW: 1 });
  });

  it("the customer's request page shows it under review", async () => {
    const w = await quotationWorld(prisma);
    const { request } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const response = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(dataOf<{ status: string }>(response).status).toBe("UNDER_REVIEW");
  });

  it("the customer's list of requests shows it under review", async () => {
    const w = await quotationWorld(prisma);
    const { request } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const list = await w.client.get("/api/v1/requests/me", { cookie: w.alexCookie });

    expect(list.status).toBe(200);
    const rows = (list.body as { data: { id: string; status: string }[] }).data;
    expect(rows.find((row) => row.id === request.id)?.status).toBe("UNDER_REVIEW");
  });

  it("the customer's quotation page shows it expired", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const response = await w.client.get(`/api/v1/quotations/${sent.id}`, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(dataOf<{ status: string; statusLabel: string }>(response)).toMatchObject({
      status: "EXPIRED",
      statusLabel: "Expired",
    });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe(
      "EXPIRED",
    );
  });
});

describe("an expired quotation is closed", () => {
  it("cannot be edited, sent or voided, and nothing changes", async () => {
    const w = await quotationWorld(prisma);
    const { sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);
    const view = await readQuotation(w, sent.id);
    const snapshot = await quotationSnapshot(prisma, sent.id);

    expectApiError(
      await w.client.patch(quotationPath(sent.id), { cookie: w.adminCookie }).send(saveBody(view)),
      { status: 409, code: ErrorCode.QUOTATION_NOT_EDITABLE },
    );
    expectApiError(
      await w.client
        .post(`${quotationPath(sent.id)}/send`, { cookie: w.adminCookie })
        .send({ expectedStatus: "EXPIRED" }),
      { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION },
    );
    expectApiError(
      await voidRequest(w, sent.id, { expectedStatus: "EXPIRED", reason: "Trying to void it." }),
      { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION },
    );
    expect(await quotationSnapshot(prisma, sent.id)).toBe(snapshot);
  });

  it("can no longer be replaced, but the request can be quoted afresh", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    w.clock.set(NEXT_MIDNIGHT);

    const replace = await w.client
      .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
      .send({ replacesQuotationId: sent.id });
    expectApiError(replace, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });

    const fresh = await w.client
      .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
      .send({});
    expect(fresh.status).toBe(201);
  });

  it("lets a replacement draft that was started before the expiry still go out", async () => {
    const w = await quotationWorld(prisma);
    const { request, sent } = await sentUntilFifth(w);
    const draft = dataOf<AdminQuotationDto>(
      await w.client
        .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
        .send({ replacesQuotationId: sent.id }),
    );
    // Give the replacement a last day that is still ahead once the first has expired.
    await prisma.quotation.update({
      where: { id: draft.id },
      data: { validUntil: new Date("2026-03-20") },
    });
    w.clock.set(NEXT_MIDNIGHT);

    const response = await sendRequest(w, draft.id);

    expect(response.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(response)).toMatchObject({
      status: "SENT",
      requestStatus: "QUOTED",
      replaces: { id: sent.id, status: "EXPIRED" },
    });
    // The expired one stays expired: it was not voided as if it had been replaced live.
    const old = await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } });
    expect(old.status).toBe("EXPIRED");
    expect(old.voidedAt).toBeNull();
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
  });
});
