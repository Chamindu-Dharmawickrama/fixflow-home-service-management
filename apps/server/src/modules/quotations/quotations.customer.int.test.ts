import { type AdminQuotationDto, type CustomerQuotationDto, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { api, expectApiError } from "../../test/http.js";
import {
  ADMIN_REQUESTS,
  CUSTOMER_QUOTATIONS,
  dataOf,
  footprint,
  INTERNAL_VOID_REASON,
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

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const customerPath = (id: string, query = "") => `${CUSTOMER_QUOTATIONS}/${id}${query}`;

/** Written out by hand: the one list of what a customer may be given (G.7). */
const CUSTOMER_KEYS = [
  "address",
  "business",
  "currencyCode",
  "customerName",
  "customerNote",
  "discountAmount",
  "id",
  "lines",
  "preview",
  "reference",
  "requestId",
  "requestReference",
  "respondedAt",
  "sentAt",
  "serviceName",
  "status",
  "statusLabel",
  "subtotal",
  "taxAmount",
  "taxRate",
  "taxableBase",
  "terms",
  "totalAmount",
  "validUntil",
];
const BUSINESS_KEYS = ["address", "email", "logoKey", "logoUrl", "name", "phone", "tagline"];
const ADDRESS_KEYS = ["city", "line1", "line2", "postalCode", "region"];
const LINE_KEYS = [
  "description",
  "id",
  "lineTotal",
  "position",
  "quantity",
  "taxable",
  "unitPrice",
];

/** Things only the business may know, planted around a quotation so a leak would show. */
async function plantInternalSecrets(w: QuotationWorld, requestId: string) {
  await prisma.requestNote.create({
    data: {
      requestId,
      authorUserId: w.admin.id,
      body: "Secret internal note: the customer is a difficult payer.",
      visibility: "INTERNAL",
    },
  });
  await prisma.serviceRequest.update({
    where: { id: requestId },
    data: { accessNotesSnapshot: "Gate code 4821, beware of the dog" },
  });
}

const SECRETS = [
  "Secret internal note",
  "difficult payer",
  "Gate code 4821",
  "beware of the dog",
  "internal margin",
  "Morgan Reyes",
  "createdBy",
  "sentBy",
  "voidReason",
  "voided",
  "timeline",
  "availableActions",
  "declineReason",
  "expiredAt",
];

describe("GET /quotations/:id: what the customer sees (G.7)", () => {
  it("returns the owner their sent quotation with exactly the allowed fields", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    await plantInternalSecrets(w, request.id);
    const sent = await sentQuotation(w, request.id, {
      customerNote: "Parts are in stock.",
      discountAmount: "25.20",
      validUntil: "2026-03-20",
    });

    const response = await w.client.get(customerPath(sent.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const quotation = dataOf<CustomerQuotationDto>(response);
    expect(Object.keys(quotation).sort()).toEqual(CUSTOMER_KEYS);
    expect(Object.keys(quotation.business).sort()).toEqual(BUSINESS_KEYS);
    expect(Object.keys(quotation.business.address).sort()).toEqual(ADDRESS_KEYS);
    expect(Object.keys(quotation.address).sort()).toEqual(ADDRESS_KEYS);
    expect(quotation.lines).toHaveLength(3);
    for (const line of quotation.lines) {
      expect(Object.keys(line).sort()).toEqual(LINE_KEYS);
    }
  });

  it("gives the document everything it prints, with the server's money", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id, {
      customerNote: "Parts are in stock.",
      discountAmount: "25.20",
      validUntil: "2026-03-20",
    });

    const quotation = dataOf<CustomerQuotationDto>(
      await w.client.get(customerPath(sent.id), { cookie: w.alexCookie }),
    );

    expect(quotation).toMatchObject({
      id: sent.id,
      reference: sent.reference,
      status: "SENT",
      statusLabel: "Sent",
      requestId: request.id,
      requestReference: request.reference,
      serviceName: "AC Repair",
      customerName: "Alex Morgan",
      currencyCode: "USD",
      taxRate: "8.00",
      subtotal: "252.00",
      discountAmount: "25.20",
      taxableBase: "40.95",
      taxAmount: "3.28",
      totalAmount: "230.08",
      validUntil: "2026-03-20",
      customerNote: "Parts are in stock.",
      sentAt: "2026-03-02T09:00:00.000Z",
      respondedAt: null,
      preview: false,
      address: {
        line1: "214 Larkspur Lane",
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
      },
      business: {
        name: "CoolBreeze Home Services",
        email: "hello@coolbreeze.test",
        phone: "(212) 555-0142",
        address: { line1: "48 Harbor Point Road", line2: "Unit 3", city: "Harbor City" },
      },
    });
    expect(quotation.terms).toContain("Workmanship is guaranteed");
    expect(quotation.lines.map((line) => [line.description, line.lineTotal])).toEqual([
      ["Diagnostic visit", "79.00"],
      ["Run capacitor", "45.50"],
      ["Labour", "127.50"],
    ]);
  });

  it("contains nothing internal: no note, no access notes, no staff name, no audit field", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    await plantInternalSecrets(w, request.id);
    const sent = await sentQuotation(w, request.id);
    // A voided earlier version carries the internal reason; a decline carries the customer's own words.
    await voidRequest(w, sent.id, { expectedStatus: "SENT", reason: INTERNAL_VOID_REASON });

    const response = await w.client.get(customerPath(sent.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    for (const secret of SECRETS) {
      expect(text, secret).not.toContain(secret);
    }
    // The state itself is fine to show; the reason for it is not.
    expect(dataOf<CustomerQuotationDto>(response)).toMatchObject({
      status: "VOID",
      statusLabel: "Void",
    });
  });

  it("tells the owner nothing about a draft, a voided draft, or someone else's quotation: 404 all alike", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);

    const draftResponse = await w.client.get(customerPath(draft.id), { cookie: w.alexCookie });
    expectApiError(draftResponse, { status: 404, code: ErrorCode.NOT_FOUND });

    const missing = await w.client.get(customerPath(MISSING_ID), { cookie: w.alexCookie });
    expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
    // Same words as an id that does not exist: a draft cannot be told apart.
    expect((draftResponse.body as { error: { message: string } }).error.message).toBe(
      (missing.body as { error: { message: string } }).error.message,
    );

    // A draft voided before it was ever sent was never the customer's.
    await voidRequest(w, draft.id, { expectedStatus: "DRAFT", reason: "Start again, please." });
    expectApiError(await w.client.get(customerPath(draft.id), { cookie: w.alexCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });

    // Another customer's sent quotation is just as invisible.
    const other = await sentQuotation(w, (await makeRequest(w)).id);
    expectApiError(await w.client.get(customerPath(other.id), { cookie: w.priyaCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expect((await w.client.get(customerPath(other.id), { cookie: w.alexCookie })).status).toBe(200);
  });

  it("does not let a reference open a quotation: only the id does", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);
    expectApiError(await w.client.get(customerPath(sent.reference), { cookie: w.alexCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("answers 401 without a session and 422 for an id that is not one", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);
    const anonymous = api(buildTestApp({ prisma }).app);
    expectApiError(await anonymous.get(customerPath(sent.id)), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await w.client.get(customerPath("nope"), { cookie: w.alexCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expectApiError(
      await w.client.get(customerPath(sent.id, "?preview=0"), { cookie: w.alexCookie }),
      {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      },
    );
  });

  it("lets an admin see what the customer sees, and a draft only on purpose", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);

    // Without ?preview=1 an admin gets the same 404 a customer would.
    expectApiError(await w.client.get(customerPath(draft.id), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });

    const preview = await w.client.get(customerPath(draft.id, "?preview=1"), {
      cookie: w.adminCookie,
    });
    expect(preview.status).toBe(200);
    const shown = dataOf<CustomerQuotationDto>(preview);
    expect(shown).toMatchObject({
      status: "DRAFT",
      preview: true,
      sentAt: null,
      totalAmount: "255.64",
    });
    expect(Object.keys(shown).sort()).toEqual(CUSTOMER_KEYS);
    for (const secret of SECRETS) {
      expect(JSON.stringify(preview.body), secret).not.toContain(secret);
    }

    // A sent quotation needs no flag, and is not marked as a preview.
    const sent = await sentQuotation(w, (await makeRequest(w, { owner: "priya" })).id);
    const plain = await w.client.get(customerPath(sent.id), { cookie: w.adminCookie });
    expect(dataOf<CustomerQuotationDto>(plain)).toMatchObject({ status: "SENT", preview: false });
  });

  it("never lets a customer ask for a preview of a draft", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    expectApiError(
      await w.client.get(customerPath(draft.id, "?preview=1"), { cookie: w.alexCookie }),
      {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      },
    );
  });

  it("changes nothing by being read", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);
    const before = await footprint(w);
    const snapshot = await quotationSnapshot(prisma, sent.id);

    await w.client.get(customerPath(sent.id), { cookie: w.alexCookie });
    await w.client.get(customerPath(sent.id), { cookie: w.priyaCookie });

    expect(await footprint(w)).toEqual(before);
    expect(await quotationSnapshot(prisma, sent.id)).toBe(snapshot);
  });

  it("shows the customer the quotation as expired once its last day has passed in the business's time zone", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id, { validUntil: "2026-03-05" });

    // 04:59:59 UTC on the 6th is still the 5th in New York.
    w.clock.set("2026-03-06T04:59:59.000Z");
    expect(
      dataOf<CustomerQuotationDto>(
        await w.client.get(customerPath(sent.id), { cookie: w.alexCookie }),
      ).status,
    ).toBe("SENT");
    w.clock.set("2026-03-06T05:00:00.000Z");
    expect(
      dataOf<CustomerQuotationDto>(
        await w.client.get(customerPath(sent.id), { cookie: w.alexCookie }),
      ).status,
    ).toBe("EXPIRED");
  });
});

describe("the request integration", () => {
  it("keeps the customer's request free of quotation internals", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    await readyDraft(w, request.id);

    const response = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(Object.keys(dataOf(response))).not.toContain("quotations");
    expect(JSON.stringify(response.body)).not.toContain("QT-");
  });

  it("lists every version on the admin request, newest first, with the chain", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const original = await sentQuotation(w, request.id);
    const replacement = dataOf<AdminQuotationDto>(
      await w.client
        .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
        .send({ replacesQuotationId: original.id }),
    );

    const view = dataOf<{
      quotations: {
        id: string;
        status: string;
        replacesReference: string | null;
        sentAt: string | null;
      }[];
    }>(await w.client.get(`${ADMIN_REQUESTS}/${request.id}`, { cookie: w.adminCookie }));

    expect(view.quotations.map((quotation) => [quotation.id, quotation.status])).toEqual([
      [replacement.id, "DRAFT"],
      [original.id, "SENT"],
    ]);
    expect(view.quotations[0]?.replacesReference).toBe(original.reference);
    expect(view.quotations[1]?.sentAt).toBe("2026-03-02T09:00:00.000Z");
  });
});

describe("cancelling a request voids its open quotations in the same transaction (D-21, BR-16, G.6)", () => {
  const REASON = "Customer is outside the service area after all.";
  const cancel = (w: QuotationWorld, id: string, expectedStatus: string, extra = {}) =>
    w.client
      .patch(`${ADMIN_REQUESTS}/${id}/status`, { cookie: w.adminCookie })
      .send({ action: "CANCEL", expectedStatus, reason: REASON, ...extra });

  it("voids a draft with the reason, the admin and an event", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await startDraft(w, request.id);

    const response = await cancel(w, request.id, "UNDER_REVIEW");
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored).toMatchObject({
      status: "VOID",
      voidReason: `Request cancelled: ${REASON}`,
      voidedByUserId: w.admin.id,
    });
    const requestRow = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestRow.status).toBe("CANCELLED");
    // The same moment: one transaction, one clock reading.
    expect(stored.voidedAt?.toISOString()).toBe(requestRow.cancelledAt?.toISOString());

    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "quotation.voided", entityId: draft.id },
    });
    expect(event).toMatchObject({
      actorUserId: w.admin.id,
      fromStatus: "DRAFT",
      toStatus: "VOID",
      publicSummary: null,
    });
    expect(event.summary).toBe(
      `Morgan Reyes voided draft quotation ${draft.reference} because the request was cancelled.`,
    );
  });

  it("voids a sent quotation and a replacement draft together, and tells the customer once", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);
    const replacement = dataOf<AdminQuotationDto>(
      await w.client
        .post(`${ADMIN_REQUESTS}/${request.id}/quotations`, { cookie: w.adminCookie })
        .send({ replacesQuotationId: sent.id }),
    );
    const notificationsBefore = await prisma.notification.count();
    const emailsBefore = w.emails.sent.length;

    const response = await cancel(w, request.id, "QUOTED", {
      customerMessage: "We cannot reach your street, sorry.",
    });
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    const quotations = await prisma.quotation.findMany({ where: { requestId: request.id } });
    expect(quotations.map((quotation) => quotation.status)).toEqual(["VOID", "VOID"]);
    for (const quotation of quotations) {
      expect(quotation.voidReason).toBe(`Request cancelled: ${REASON}`);
      expect(quotation.voidedByUserId).toBe(w.admin.id);
    }
    expect(await prisma.quotation.count({ where: { status: { in: ["DRAFT", "SENT"] } } })).toBe(0);
    expect(replacement.id).toBeDefined();

    // The cancellation notice is the one message the customer gets: no "withdrawn" on top of it.
    const notifications = (
      await prisma.notification.findMany({ orderBy: { createdAt: "asc" } })
    ).slice(notificationsBefore);
    expect(notifications.map((notification) => notification.type)).toEqual(["REQUEST_CANCELLED"]);
    expect(w.emails.sent.slice(emailsBefore)).toHaveLength(1);
    expect(w.emails.last?.subject).toContain("was cancelled");

    // The sent quotation's event reads as a cancellation to staff and as nothing extra to the customer.
    const events = await prisma.activityEvent.findMany({
      where: { action: "quotation.voided", entityId: sent.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.publicSummary).toBeNull();
    // The request is no longer under review, so it is not put back there.
    expect(await prisma.activityEvent.count({ where: { action: "request.review_resumed" } })).toBe(
      0,
    );
  });

  it("keeps the internal reason out of everything the customer can read", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);

    await cancel(w, request.id, "QUOTED");
    await w.deps.emailDispatcher.idle();

    const view = await w.client.get(customerPath(sent.id), { cookie: w.alexCookie });
    expect(JSON.stringify(view.body)).not.toContain("outside the service area");
    expect(JSON.stringify(await prisma.notification.findMany())).not.toContain(
      "outside the service area",
    );
    for (const email of w.emails.sent) {
      expect(email.text).not.toContain("outside the service area");
      expect(email.html).not.toContain("outside the service area");
    }
    const timeline = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });
    expect(JSON.stringify(timeline.body)).not.toContain("outside the service area");
  });

  it("leaves the quotations alone when the cancellation is refused", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);
    const snapshot = await quotationSnapshot(prisma, sent.id);
    const before = await footprint(w);

    const stale = await cancel(w, request.id, "UNDER_REVIEW"); // the screen was out of date

    expectApiError(stale, { status: 409, code: ErrorCode.STALE_STATE });
    expect(await quotationSnapshot(prisma, sent.id)).toBe(snapshot);
    expect(await footprint(w)).toEqual(before);
  });

  it("is all or nothing: a failure after the quotations are voided puts them back", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);
    const draftRequest = await makeRequest(w, { owner: "priya" });
    const draft = await startDraft(w, draftRequest.id);

    // The cancellation notice is written after the quotations are voided: make writing it fail.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION zz_fail_cancel_notice() RETURNS trigger AS $body$
       BEGIN RAISE EXCEPTION 'the notice could not be written'; END; $body$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER zz_fail_cancel_notice BEFORE INSERT ON notifications
       FOR EACH ROW WHEN (NEW.type = 'REQUEST_CANCELLED') EXECUTE FUNCTION zz_fail_cancel_notice()`,
    );
    try {
      const sentSnapshot = await quotationSnapshot(prisma, sent.id);
      const draftSnapshot = await quotationSnapshot(prisma, draft.id);

      const sentResponse = await cancel(w, request.id, "QUOTED");
      const draftResponse = await cancel(w, draftRequest.id, "UNDER_REVIEW");

      expect(sentResponse.status).toBe(500);
      expect(draftResponse.status).toBe(500);
      // Nothing was left half done: the quotations are as they were and the requests are not cancelled.
      expect(await quotationSnapshot(prisma, sent.id)).toBe(sentSnapshot);
      expect(await quotationSnapshot(prisma, draft.id)).toBe(draftSnapshot);
      expect(
        (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe("QUOTED");
      expect(await prisma.activityEvent.count({ where: { action: "quotation.voided" } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS zz_fail_cancel_notice ON notifications`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zz_fail_cancel_notice()`);
    }
  });

  it("leaves an answered or expired quotation as it was", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w, { status: "ACCEPTED" });
    const accepted = await prisma.quotation.create({
      data: {
        reference: "QT-2026-90001",
        requestId: request.id,
        customerId: w.alex.profile.id,
        status: "ACCEPTED",
        currencyCode: "USD",
        taxRate: "8.00",
        subtotal: "100.00",
        taxableBase: "100.00",
        taxAmount: "8.00",
        totalAmount: "108.00",
        validUntil: new Date("2026-03-30"),
        sentAt: new Date("2026-03-01T10:00:00.000Z"),
        respondedAt: new Date("2026-03-01T12:00:00.000Z"),
        createdByUserId: w.admin.id,
      },
    });

    const response = await cancel(w, request.id, "ACCEPTED");

    expect(response.status).toBe(200);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: accepted.id } })).status).toBe(
      "ACCEPTED",
    );
    expect(await prisma.activityEvent.count({ where: { action: "quotation.voided" } })).toBe(0);
  });
});
