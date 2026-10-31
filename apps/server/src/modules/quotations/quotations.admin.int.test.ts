import {
  type AdminQuotationDto,
  calculateDocumentTotals,
  ErrorCode,
  ServiceRequestStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { api, expectApiError } from "../../test/http.js";
import {
  ADMIN_QUOTATIONS,
  ADMIN_REQUESTS,
  ALEX,
  dataOf,
  EXAMPLE_LINES,
  footprint,
  getAdminRequest,
  INTERNAL_VOID_REASON,
  makeRequest,
  MISSING_ID,
  quotationSnapshot,
  quotationWorld,
  readyDraft,
  saveBody,
  saveDraft,
  sendRequest,
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

const createPath = (requestId: string) => `${ADMIN_REQUESTS}/${requestId}/quotations`;
const quotationPath = (id: string) => `${ADMIN_QUOTATIONS}/${id}`;

describe("authentication and roles", () => {
  it("answers 401 to every admin quotation endpoint without a session", async () => {
    const { app } = buildTestApp({ prisma });
    const client = api(app);
    const body = { expectedStatus: "DRAFT" };

    const responses = await Promise.all([
      client.post(createPath(MISSING_ID)).send({}),
      client.get(quotationPath(MISSING_ID)),
      client.patch(quotationPath(MISSING_ID)).send({}),
      client.post(`${quotationPath(MISSING_ID)}/send`).send(body),
      client
        .post(`${quotationPath(MISSING_ID)}/void`)
        .send({ ...body, reason: "Wrong unit priced." }),
    ]);
    for (const response of responses) {
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
  });

  it("answers 403 to a customer on every admin quotation endpoint, and changes nothing", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);
    const before = await footprint(w);
    const snapshot = await quotationSnapshot(prisma, draft.id);

    const cookie = w.alexCookie;
    const responses = await Promise.all([
      w.client.post(createPath(request.id), { cookie }).send({}),
      w.client.get(quotationPath(draft.id), { cookie }),
      w.client.patch(quotationPath(draft.id), { cookie }).send(saveBody(draft)),
      w.client
        .post(`${quotationPath(draft.id)}/send`, { cookie })
        .send({ expectedStatus: "DRAFT" }),
      w.client
        .post(`${quotationPath(draft.id)}/void`, { cookie })
        .send({ expectedStatus: "DRAFT", reason: "Wrong unit priced." }),
    ]);
    for (const response of responses) {
      expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
    }
    expect(await footprint(w)).toEqual(before);
    expect(await quotationSnapshot(prisma, draft.id)).toBe(snapshot);
  });

  it("answers 403 to an admin who has left the allowlist", async () => {
    const w = await quotationWorld(prisma, { env: { ADMIN_EMAILS: "someone.else@example.test" } });
    const request = await makeRequest(w);
    expectApiError(
      await w.client.post(createPath(request.id), { cookie: w.adminCookie }).send({}),
      {
        status: 403,
        code: ErrorCode.FORBIDDEN,
      },
    );
  });

  it("does not hand the admin quotation shape to the customer's endpoint", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);
    const response = await w.client.get(`/api/v1/quotations/${sent.id}`, { cookie: w.alexCookie });
    expect(response.status).toBe(200);
    expect(Object.keys(dataOf(response))).not.toContain("timeline");
  });
});

describe("creating a draft (FR-040, G.2)", () => {
  it("fills in the draft from the settings and the service", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);

    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({});

    expect(response.status).toBe(201);
    const draft = dataOf<AdminQuotationDto>(response);
    expect(draft).toMatchObject({
      status: "DRAFT",
      statusLabel: "Draft",
      requestId: request.id,
      requestReference: request.reference,
      requestStatus: "UNDER_REVIEW",
      serviceName: "AC Repair",
      customerName: "Alex Morgan",
      currencyCode: "USD",
      taxRate: "8.00",
      // 2 March 2026 in New York, plus the 14 days of the settings.
      validUntil: "2026-03-16",
      customerNote: null,
      sentAt: null,
      replaces: null,
      replacedBy: null,
      availableActions: ["EDIT", "SEND", "VOID"],
      createdBy: { name: "Morgan Reyes" },
    });
    expect(draft.reference).toMatch(/^QT-2026-\d{5}$/);
    expect(draft.terms).toContain("Prices are based on the information in your request");
    // One starter line for the service. It is a quote-required service, so the price starts at zero.
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0]).toMatchObject({
      position: 1,
      description: "AC Repair",
      quantity: "1.00",
      unitPrice: "0.00",
      taxable: true,
      lineTotal: "0.00",
    });
    expect(draft).toMatchObject({
      subtotal: "0.00",
      discountAmount: "0.00",
      taxableBase: "0.00",
      taxAmount: "0.00",
      totalAmount: "0.00",
    });
  });

  it("starts a fixed-price service at its price, with the totals worked out from it", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w, {
      serviceId: w.fixedService.id,
      serviceNameSnapshot: "Gutter Cleaning",
    });

    const draft = await startDraft(w, request.id);

    expect(draft.lines[0]).toMatchObject({
      description: "Gutter Cleaning",
      unitPrice: "89.50",
      lineTotal: "89.50",
    });
    // 89.50 + 8 % tax (7.16).
    expect(draft).toMatchObject({
      subtotal: "89.50",
      taxAmount: "7.16",
      totalAmount: "96.66",
    });
  });

  it("takes the tax rate, currency and validity from the settings as they are now", async () => {
    const w = await quotationWorld(prisma);
    await prisma.businessSettings.updateMany({
      data: { defaultTaxRate: "6.25", currencyCode: "CAD", quotationValidityDays: 30 },
    });
    const draft = await startDraft(w, (await makeRequest(w)).id);
    expect(draft).toMatchObject({ taxRate: "6.25", currencyCode: "CAD", validUntil: "2026-04-01" });
  });

  it("counts the validity from the business's day, not from UTC's", async () => {
    const w = await quotationWorld(prisma);
    // 03:30 UTC on 3 March is still 22:30 on 2 March in New York.
    w.clock.set("2026-03-03T03:30:00.000Z");
    const draft = await startDraft(w, (await makeRequest(w)).id);
    expect(draft.validUntil).toBe("2026-03-16");
  });

  it("records who created it and an event only the team sees, and tells nobody", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);

    const draft = await startDraft(w, request.id);
    await w.deps.emailDispatcher.idle();

    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.createdByUserId).toBe(w.admin.id);
    expect(stored.customerId).toBe(w.alex.profile.id);

    const events = await prisma.activityEvent.findMany({ where: { entityId: draft.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "quotation.created",
      entityType: "QUOTATION",
      actorUserId: w.admin.id,
      requestId: request.id,
      customerId: w.alex.profile.id,
      toStatus: "DRAFT",
      publicSummary: null,
    });
    expect(events[0]?.summary).toBe(
      `Morgan Reyes created draft quotation ${draft.reference} for request ${request.reference}.`,
    );
    // A draft is the team's: no notification, no email, nothing for the customer's timeline.
    expect(await prisma.notification.count()).toBe(0);
    expect(w.emails.sent).toHaveLength(0);
  });

  it("numbers the quotations one after another", async () => {
    const w = await quotationWorld(prisma);
    const first = await startDraft(w, (await makeRequest(w)).id);
    const second = await startDraft(w, (await makeRequest(w, { owner: "priya" })).id);
    const number = (reference: string) => Number(reference.slice(-5));
    expect(number(second.reference)).toBe(number(first.reference) + 1);
  });

  it.each(Object.values(ServiceRequestStatus).filter((status) => status !== "UNDER_REVIEW"))(
    "is refused for a request that is %s, and creates nothing",
    async (status) => {
      const w = await quotationWorld(prisma);
      const request = await makeRequest(w, { status });
      const before = await footprint(w);

      const response = await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({});

      const error = expectApiError(response, {
        status: 409,
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(error.details).toEqual({ currentStatus: status });
      expect(await footprint(w)).toEqual(before);
    },
  );

  it("answers 404 for a request that does not exist and 422 for an id that is not one", async () => {
    const w = await quotationWorld(prisma);
    expectApiError(
      await w.client.post(createPath(MISSING_ID), { cookie: w.adminCookie }).send({}),
      {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      },
    );
    expectApiError(
      await w.client.post(createPath("FF-2026-00001"), { cookie: w.adminCookie }).send({}),
      { status: 422, code: ErrorCode.VALIDATION_ERROR },
    );
  });

  it("refuses a second draft with 409 DRAFT_EXISTS and names the one that exists", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const first = await startDraft(w, request.id);
    const before = await footprint(w);

    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({});

    const error = expectApiError(response, { status: 409, code: ErrorCode.DRAFT_EXISTS });
    expect(error.details).toEqual({ quotationId: first.id });
    expect(error.message).toContain(first.reference);
    expect(await footprint(w)).toEqual(before);
  });

  it("lets two admins click at once and leaves exactly one draft", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);

    const responses = await Promise.all([
      w.client.post(createPath(request.id), { cookie: w.adminCookie }).send({}),
      w.client.post(createPath(request.id), { cookie: w.adminCookie }).send({}),
      w.client.post(createPath(request.id), { cookie: w.adminCookie }).send({}),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      expectApiError(response, { status: 409, code: ErrorCode.DRAFT_EXISTS });
    }
    expect(await prisma.quotation.count({ where: { requestId: request.id } })).toBe(1);
    expect(await prisma.quotationLineItem.count()).toBe(1);
  });

  it("offers Create quotation on an under-review request until a draft exists, and lists every version", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);

    const before = await getAdminRequest(w, request.id);
    expect(before.availableActions).toEqual(["CREATE_QUOTATION", "CANCEL"]);
    expect(before.quotations).toEqual([]);

    const draft = await startDraft(w, request.id);
    const after = await getAdminRequest(w, request.id);
    expect(after.availableActions).toEqual(["CANCEL"]);
    expect(after.quotations).toEqual([
      expect.objectContaining({
        id: draft.id,
        reference: draft.reference,
        status: "DRAFT",
        statusLabel: "Draft",
        totalAmount: "0.00",
        currencyCode: "USD",
        validUntil: "2026-03-16",
        sentAt: null,
        replacesReference: null,
      }),
    ]);
  });

  it("does not offer Create quotation for a submitted request", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w, { status: "SUBMITTED" });
    expect((await getAdminRequest(w, request.id)).availableActions).toEqual([
      "START_REVIEW",
      "CANCEL",
    ]);
  });
});

describe("saving a draft: the server recalculates every total (FR-041, FR-042, G.3)", () => {
  it("stores the worked example with no discount: 252.00, tax 3.64, total 255.64", async () => {
    const w = await quotationWorld(prisma);
    const draft = await startDraft(w, (await makeRequest(w)).id);

    const saved = await saveDraft(w, draft, { lines: EXAMPLE_LINES });

    expect(saved).toMatchObject({
      subtotal: "252.00",
      discountAmount: "0.00",
      taxableBase: "45.50",
      taxAmount: "3.64",
      totalAmount: "255.64",
    });
    expect(saved.lines.map((line) => line.lineTotal)).toEqual(["79.00", "45.50", "127.50"]);
    expect(saved.lines.map((line) => line.position)).toEqual([1, 2, 3]);
  });

  it("stores the worked example with a discount of 25.20: taxable base 40.95, tax 3.28, total 230.08", async () => {
    const w = await quotationWorld(prisma);
    const draft = await startDraft(w, (await makeRequest(w)).id);

    const saved = await saveDraft(w, draft, { lines: EXAMPLE_LINES, discountAmount: "25.20" });

    expect(saved).toMatchObject({
      subtotal: "252.00",
      discountAmount: "25.20",
      taxableBase: "40.95",
      taxAmount: "3.28",
      totalAmount: "230.08",
    });
  });

  it("stores exactly what the shared calculation returns for the stored lines", async () => {
    const w = await quotationWorld(prisma);
    const draft = await startDraft(w, (await makeRequest(w)).id);
    const lines = [
      { description: "Part A", quantity: "3", unitPrice: "19.99", taxable: true },
      { description: "Part B", quantity: "0.5", unitPrice: "0.05", taxable: false },
      { description: "Labour", quantity: "2.25", unitPrice: "64.33", taxable: true },
    ];

    await saveDraft(w, draft, { lines, discountAmount: "12.34", taxRate: "8.25" });

    const stored = await prisma.quotation.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    const expected = calculateDocumentTotals({
      lines: stored.lineItems.map((line) => ({
        quantity: line.quantity.toFixed(2),
        unitPrice: line.unitPrice.toFixed(2),
        taxable: line.taxable,
      })),
      discountAmount: stored.discountAmount.toFixed(2),
      taxRate: stored.taxRate.toFixed(2),
    });
    expect({
      subtotal: stored.subtotal.toFixed(2),
      taxableBase: stored.taxableBase.toFixed(2),
      taxAmount: stored.taxAmount.toFixed(2),
      totalAmount: stored.totalAmount.toFixed(2),
    }).toEqual({
      subtotal: expected.subtotal,
      taxableBase: expected.taxableBase,
      taxAmount: expected.taxAmount,
      totalAmount: expected.totalAmount,
    });
    expect(stored.lineItems.map((line) => line.lineSubtotal.toFixed(2))).toEqual(
      expected.lines.map((line) => line.lineSubtotal),
    );
  });

  it("rounds a line half up: 0.50 × 0.05 is 0.03", async () => {
    const w = await quotationWorld(prisma);
    const draft = await startDraft(w, (await makeRequest(w)).id);
    const saved = await saveDraft(w, draft, {
      lines: [{ description: "Washer", quantity: "0.50", unitPrice: "0.05", taxable: false }],
      taxRate: "0",
    });
    expect(saved.lines[0]?.lineTotal).toBe("0.03");
    expect(saved.totalAmount).toBe("0.03");
  });

  it("refuses a body that names any total, whatever it says, and changes nothing", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const snapshot = await quotationSnapshot(prisma, draft.id);

    for (const fake of [
      { totalAmount: "1.00" },
      { subtotal: "1.00" },
      { taxAmount: "0.00" },
      { taxableBase: "0.00" },
    ]) {
      const response = await w.client
        .patch(quotationPath(draft.id), { cookie: w.adminCookie })
        .send({ ...saveBody(draft), ...fake });
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toEqual({ [Object.keys(fake)[0] as string]: "Unknown field." });
    }
    const withLineTotal = await w.client
      .patch(quotationPath(draft.id), { cookie: w.adminCookie })
      .send({
        ...saveBody(draft),
        lines: [{ ...saveBody(draft).lines[0], lineTotal: "1.00" }],
      });
    expectApiError(withLineTotal, { status: 422, code: ErrorCode.VALIDATION_ERROR });

    expect(await quotationSnapshot(prisma, draft.id)).toBe(snapshot);
  });

  it("recalculates from the lines alone, whatever the stored totals were", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    // Corrupt the stored totals, as a bug elsewhere might have: a save must put them right.
    await prisma.quotation.update({
      where: { id: draft.id },
      data: { totalAmount: "9999.00", taxAmount: "1.00" },
    });
    const current = dataOf<AdminQuotationDto>(
      await w.client.get(quotationPath(draft.id), { cookie: w.adminCookie }),
    );

    const response = await w.client
      .patch(quotationPath(draft.id), { cookie: w.adminCookie })
      .send(saveBody(current));

    expect(response.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(response)).toMatchObject({
      taxAmount: "3.64",
      totalAmount: "255.64",
    });
  });

  it("names the line and the field that cannot be used, and keeps the stored draft", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const snapshot = await quotationSnapshot(prisma, draft.id);

    const response = await w.client.patch(quotationPath(draft.id), { cookie: w.adminCookie }).send(
      saveBody(draft, {
        lines: [
          EXAMPLE_LINES[0] as (typeof EXAMPLE_LINES)[number],
          { description: "Part", quantity: "0", unitPrice: "1.005", taxable: true },
        ],
        taxRate: "101",
      }),
    );

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      "lines.1.quantity",
      "lines.1.unitPrice",
      "taxRate",
    ]);
    expect(await quotationSnapshot(prisma, draft.id)).toBe(snapshot);
  });

  it("refuses a discount larger than the subtotal and accepts one equal to it", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);

    const tooMuch = await w.client
      .patch(quotationPath(draft.id), { cookie: w.adminCookie })
      .send(saveBody(draft, { discountAmount: "252.01" }));
    const error = expectApiError(tooMuch, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(error.fieldErrors).toEqual({
      discountAmount: "The discount can't be more than the subtotal (252.00).",
    });

    const all = await w.client
      .patch(quotationPath(draft.id), { cookie: w.adminCookie })
      .send(saveBody(draft, { discountAmount: "252.00" }));
    expect(all.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(all)).toMatchObject({
      discountAmount: "252.00",
      totalAmount: "0.00",
    });
  });

  it("replaces the lines: removed lines are gone and the rest are renumbered", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);

    const saved = await saveDraft(w, draft, {
      lines: [EXAMPLE_LINES[2], EXAMPLE_LINES[0]] as (typeof EXAMPLE_LINES)[number][],
    });

    expect(saved.lines.map((line) => [line.position, line.description])).toEqual([
      [1, "Labour"],
      [2, "Diagnostic visit"],
    ]);
    expect(await prisma.quotationLineItem.count({ where: { quotationId: draft.id } })).toBe(2);
  });

  it("saves the details: valid-until date, terms and the note for the customer", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);

    const saved = await saveDraft(w, draft, {
      validUntil: "2026-04-30",
      terms: "Half in advance.",
      customerNote: "Thanks for the photos.",
    });
    expect(saved).toMatchObject({
      validUntil: "2026-04-30",
      terms: "Half in advance.",
      customerNote: "Thanks for the photos.",
    });

    const cleared = await saveDraft(w, saved, { terms: null, customerNote: null });
    expect(cleared).toMatchObject({ terms: null, customerNote: null });
  });

  it("moves updatedAt forward, so the next save must come from this version", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const saved = await saveDraft(w, draft, { customerNote: "First change." });
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(
      new Date(draft.updatedAt).getTime(),
    );

    const response = await w.client
      .patch(quotationPath(draft.id), { cookie: w.adminCookie })
      .send(saveBody(draft, { customerNote: "From the old version." }));

    const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: "DRAFT" });
    expect(
      (await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).customerNote,
    ).toBe("First change.");
  });

  it("lets two saves from the same version race and keeps exactly one", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);

    const responses = await Promise.all([
      w.client
        .patch(quotationPath(draft.id), { cookie: w.adminCookie })
        .send(saveBody(draft, { customerNote: "Version A" })),
      w.client
        .patch(quotationPath(draft.id), { cookie: w.adminCookie })
        .send(saveBody(draft, { customerNote: "Version B" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.customerNote).toBe(dataOf<AdminQuotationDto>(winner as never).customerNote);
    expect(await prisma.quotationLineItem.count({ where: { quotationId: draft.id } })).toBe(3);
  });

  it("answers 404 for a quotation that does not exist", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    expectApiError(
      await w.client
        .patch(quotationPath(MISSING_ID), { cookie: w.adminCookie })
        .send(saveBody(draft)),
      { status: 404, code: ErrorCode.NOT_FOUND },
    );
  });

  it("writes no event and no notification for a save", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const before = await footprint(w);
    await saveDraft(w, draft, { customerNote: "Hello." });
    const after = await footprint(w);
    expect(after).toEqual(before);
  });
});

describe("a quotation that is not a draft cannot be edited (BR-07, FR-046, G.3)", () => {
  async function inStatus(
    status: "SENT" | "VOID" | "ACCEPTED" | "DECLINED" | "EXPIRED",
  ): Promise<{ w: Awaited<ReturnType<typeof quotationWorld>>; quotation: AdminQuotationDto }> {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);
    if (status !== "SENT") {
      await prisma.quotation.update({
        where: { id: sent.id },
        data: {
          status,
          ...(status === "VOID" && {
            voidedAt: new Date("2026-03-02T10:00:00.000Z"),
            voidReason: INTERNAL_VOID_REASON,
          }),
        },
      });
    }
    const quotation = dataOf<AdminQuotationDto>(
      await w.client.get(quotationPath(sent.id), { cookie: w.adminCookie }),
    );
    return { w, quotation };
  }

  it.each(["SENT", "VOID", "ACCEPTED", "DECLINED", "EXPIRED"] as const)(
    "answers 409 QUOTATION_NOT_EDITABLE for a %s quotation and leaves it unchanged",
    async (status) => {
      const { w, quotation } = await inStatus(status);
      const snapshot = await quotationSnapshot(prisma, quotation.id);
      const before = await footprint(w);

      const response = await w.client
        .patch(quotationPath(quotation.id), { cookie: w.adminCookie })
        .send(
          saveBody(quotation, {
            lines: [{ description: "Cheaper", quantity: "1", unitPrice: "1.00", taxable: false }],
            customerNote: "Changed after the fact.",
            validUntil: "2027-01-01",
          }),
        );

      const error = expectApiError(response, {
        status: 409,
        code: ErrorCode.QUOTATION_NOT_EDITABLE,
      });
      expect(error.details).toEqual({ currentStatus: status });
      expect(await quotationSnapshot(prisma, quotation.id)).toBe(snapshot);
      expect(await footprint(w)).toEqual(before);
    },
  );

  it("says to replace a sent quotation", async () => {
    const { w, quotation } = await inStatus("SENT");
    const response = await w.client
      .patch(quotationPath(quotation.id), { cookie: w.adminCookie })
      .send(saveBody(quotation));
    expect(
      expectApiError(response, { status: 409, code: ErrorCode.QUOTATION_NOT_EDITABLE }).message,
    ).toBe("A sent quotation can't be edited. Replace it with a new draft instead.");
  });

  it("says it can't be edited, not that it is stale, even from an out-of-date page", async () => {
    const { w, quotation } = await inStatus("SENT");
    const snapshot = await quotationSnapshot(prisma, quotation.id);

    // A version that is not the stored one: the status is judged first, so the answer is the same
    // for every editor, however old its page is.
    const response = await w.client
      .patch(quotationPath(quotation.id), { cookie: w.adminCookie })
      .send(saveBody(quotation, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }));

    expectApiError(response, { status: 409, code: ErrorCode.QUOTATION_NOT_EDITABLE });
    expect(await quotationSnapshot(prisma, quotation.id)).toBe(snapshot);
  });
});

describe("sending (FR-043, D-22, G.4)", () => {
  it("sends the draft: it becomes SENT, the request becomes QUOTED, and the customer is told", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id, {
      customerNote: "Parts are in stock.",
      validUntil: "2026-03-20",
    });

    const response = await sendRequest(w, draft.id);
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    const sent = dataOf<AdminQuotationDto>(response);
    expect(sent).toMatchObject({
      status: "SENT",
      statusLabel: "Sent",
      sentAt: "2026-03-02T09:00:00.000Z",
      sentBy: { name: "Morgan Reyes" },
      requestStatus: "QUOTED",
      availableActions: ["REPLACE", "VOID"],
      totalAmount: "255.64",
    });

    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.status).toBe("SENT");
    expect(stored.sentByUserId).toBe(w.admin.id);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("QUOTED");

    // One notification for the owner, linking to the quotation, and nothing for anyone else.
    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientUserId: w.alex.user.id,
      type: "QUOTATION_SENT",
      linkPath: `/portal/quotations/${draft.id}`,
      entityType: "QUOTATION",
      entityId: draft.id,
    });
    expect(notifications[0]?.title).toBe(`Quotation ${draft.reference} is ready`);

    // One email, to the owner, after the commit.
    expect(w.emails.sent).toHaveLength(1);
    expect(w.emails.last?.to).toBe(ALEX);
    expect(w.emails.last?.subject).toBe(
      `Your quotation ${draft.reference} from CoolBreeze Home Services`,
    );
    expect(w.emails.last?.text).toContain("255.64");
    expect(w.emails.last?.text).toContain(`/portal/quotations/${draft.id}`);
  });

  it("records a public event for the quotation and a staff-only one for the request", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);

    await sendRequest(w, draft.id);

    const events = await prisma.activityEvent.findMany({
      where: { action: { in: ["quotation.sent", "request.quoted"] } },
      orderBy: { createdAt: "asc" },
    });
    const sentEvent = events.find((event) => event.action === "quotation.sent");
    expect(sentEvent).toMatchObject({
      entityType: "QUOTATION",
      entityId: draft.id,
      requestId: request.id,
      customerId: w.alex.profile.id,
      fromStatus: "DRAFT",
      toStatus: "SENT",
      actorUserId: w.admin.id,
      publicSummary: `We sent you quotation ${draft.reference}.`,
      summary: `Morgan Reyes sent quotation ${draft.reference} to Alex Morgan.`,
    });
    expect(sentEvent?.metadata).toMatchObject({
      quotationReference: draft.reference,
      totalAmount: "255.64",
      currencyCode: "USD",
      lineItemCount: 3,
    });
    const quotedEvent = events.find((event) => event.action === "request.quoted");
    expect(quotedEvent).toMatchObject({
      entityType: "SERVICE_REQUEST",
      fromStatus: "UNDER_REVIEW",
      toStatus: "QUOTED",
      publicSummary: null,
      // A change the system makes (D-21) has no person behind it: the send has its own event.
      actorUserId: null,
      summary: `The system moved request ${request.reference} to quoted.`,
    });
  });

  it("shows the customer the event on their request's history", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);
    await sendRequest(w, draft.id);

    const response = await w.client.get(`/api/v1/requests/${request.id}`, { cookie: w.alexCookie });
    const timeline = (response.body as { data: { timeline: { publicSummary: string }[] } }).data
      .timeline;
    expect(timeline.map((event) => event.publicSummary)).toEqual([
      `We sent you quotation ${draft.reference}.`,
    ]);
    // The draft was the team's business and never shows.
    expect(JSON.stringify(response.body)).not.toContain("created draft");
  });

  it("refuses a draft with a total of zero, naming the field, and sends nothing", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await startDraft(w, request.id); // the starter line costs 0.00
    const before = await footprint(w);

    const response = await sendRequest(w, draft.id);

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["totalAmount"]);
    expect(await footprint(w)).toEqual(before);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT",
    );
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("UNDER_REVIEW");
  });

  it("refuses a valid-until date that has already passed in the business's time zone", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id, { validUntil: "2026-03-01" });
    const before = await footprint(w);

    const response = await sendRequest(w, draft.id);

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["validUntil"]);
    expect(await footprint(w)).toEqual(before);
  });

  it("accepts a valid-until date of today, judged on the business's calendar", async () => {
    const w = await quotationWorld(prisma);
    // 03:30 UTC on 3 March is still 2 March in New York: a last day of 2 March is today.
    w.clock.set("2026-03-03T03:30:00.000Z");
    const draft = await readyDraft(w, (await makeRequest(w)).id, { validUntil: "2026-03-02" });

    expect((await sendRequest(w, draft.id)).status).toBe(200);
  });

  it("judges the last day by the business's calendar when UTC is already the next day", async () => {
    const w = await quotationWorld(prisma);
    // 02:00 UTC on 2 March is 21:00 on 1 March in New York: 1 March is still today there.
    w.clock.set("2026-03-02T02:00:00.000Z");
    const draft = await readyDraft(w, (await makeRequest(w)).id, { validUntil: "2026-03-01" });
    expect((await sendRequest(w, draft.id)).status).toBe(200);
  });

  it("refuses a last day that is before the business's today, even when it is today in UTC", async () => {
    const w = await quotationWorld(prisma);
    w.clock.set("2026-03-02T02:00:00.000Z");
    const draft = await readyDraft(w, (await makeRequest(w)).id, { validUntil: "2026-02-28" });
    expectApiError(await sendRequest(w, draft.id), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT",
    );
  });

  it("turns a double click into one send: 409 STALE_STATE the second time, one notification, one email", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);

    const first = await sendRequest(w, draft.id);
    const second = await sendRequest(w, draft.id);
    await w.deps.emailDispatcher.idle();

    expect(first.status).toBe(200);
    const error = expectApiError(second, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: "SENT" });
    expect(await prisma.notification.count()).toBe(1);
    expect(w.emails.sent).toHaveLength(1);
    expect(await prisma.activityEvent.count({ where: { action: "quotation.sent" } })).toBe(1);
  });

  it("leaves exactly one SENT quotation and one notification when two sends arrive together", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);

    const responses = await Promise.all([
      sendRequest(w, draft.id),
      sendRequest(w, draft.id),
      sendRequest(w, draft.id),
    ]);
    await w.deps.emailDispatcher.idle();

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
    expect(await prisma.notification.count()).toBe(1);
    expect(w.emails.sent).toHaveLength(1);
    expect(await prisma.activityEvent.count({ where: { action: "quotation.sent" } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { action: "request.quoted" } })).toBe(1);
  });

  it("answers 409 STALE_STATE when the screen was out of date, even for a status that is not a draft", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const response = await w.client
      .post(`${quotationPath(draft.id)}/send`, { cookie: w.adminCookie })
      .send({ expectedStatus: "SENT" });
    expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT",
    );
  });

  it.each(["ACCEPTED", "DECLINED", "CANCELLED", "SUBMITTED", "CONVERTED_TO_JOB"] as const)(
    "is refused while the request is %s",
    async (status) => {
      const w = await quotationWorld(prisma);
      const request = await makeRequest(w);
      const draft = await readyDraft(w, request.id);
      await prisma.serviceRequest.update({ where: { id: request.id }, data: { status } });
      const before = await footprint(w);

      const response = await sendRequest(w, draft.id);

      expectApiError(response, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });
      expect(await footprint(w)).toEqual(before);
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        "DRAFT",
      );
    },
  );

  it("never sends a second quotation for a request that already has one sent", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    await sentQuotation(w, request.id);
    // A draft that is not a replacement, however it got there (a database edit, an old bug).
    const stray = await prisma.quotation.create({
      data: {
        reference: "QT-2026-99999",
        requestId: request.id,
        customerId: w.alex.profile.id,
        currencyCode: "USD",
        taxRate: "8.00",
        subtotal: "10.00",
        taxableBase: "10.00",
        taxAmount: "0.80",
        totalAmount: "10.80",
        validUntil: new Date("2026-03-20"),
        createdByUserId: w.admin.id,
        lineItems: {
          create: [
            {
              position: 1,
              description: "Extra",
              quantity: "1",
              unitPrice: "10",
              lineSubtotal: "10",
            },
          ],
        },
      },
    });
    const before = await footprint(w);

    const response = await sendRequest(w, stray.id);

    expectApiError(response, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });
    expect(await footprint(w)).toEqual(before);
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
  });

  it("answers 404 for a quotation that does not exist", async () => {
    const w = await quotationWorld(prisma);
    expectApiError(await sendRequest(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
  });

  it("still sends when the email server is down: the business action stands", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    w.emails.failWith = new Error("SMTP is down");

    const response = await sendRequest(w, draft.id);
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "SENT",
    );
    expect(await prisma.notification.count()).toBe(1);
    expect(await prisma.emailDeliveryLog.count({ where: { status: "FAILED" } })).toBe(1);
  });
});

describe("replacing a sent quotation (BR-07, D-22, G.4)", () => {
  async function sentWithReplacement() {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const original = await sentQuotation(w, request.id, { customerNote: "First offer." });
    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({ replacesQuotationId: original.id });
    expect(response.status).toBe(201);
    const replacement = dataOf<AdminQuotationDto>(response);
    return { w, request, original, replacement };
  }

  it("starts a draft that copies the lines, discount, terms and note of the sent quotation", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const original = await sentQuotation(w, request.id, {
      discountAmount: "25.20",
      customerNote: "First offer.",
      terms: "Half in advance.",
    });

    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({ replacesQuotationId: original.id });

    expect(response.status).toBe(201);
    const replacement = dataOf<AdminQuotationDto>(response);
    expect(replacement).toMatchObject({
      status: "DRAFT",
      customerNote: "First offer.",
      terms: "Half in advance.",
      discountAmount: "25.20",
      subtotal: "252.00",
      totalAmount: "230.08",
      replaces: { id: original.id, reference: original.reference, status: "SENT" },
      validUntil: "2026-03-16",
    });
    expect(
      replacement.lines.map((line) => [line.description, line.quantity, line.unitPrice]),
    ).toEqual([
      ["Diagnostic visit", "1.00", "79.00"],
      ["Run capacitor", "1.00", "45.50"],
      ["Labour", "1.50", "85.00"],
    ]);
    expect(replacement.reference).not.toBe(original.reference);
    // The original is untouched until the replacement is sent.
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored.status).toBe("SENT");
    expect(stored.voidedAt).toBeNull();
  });

  it("shows the chain on both quotations, and stops offering a second replacement", async () => {
    const { w, original, replacement } = await sentWithReplacement();

    const oldView = dataOf<AdminQuotationDto>(
      await w.client.get(quotationPath(original.id), { cookie: w.adminCookie }),
    );
    expect(oldView.replacedBy).toMatchObject({ id: replacement.id, status: "DRAFT" });
    expect(oldView.availableActions).toEqual(["VOID"]);
    expect(replacement.replaces?.id).toBe(original.id);
  });

  it("refuses a second draft while the replacement exists", async () => {
    const { w, request, original, replacement } = await sentWithReplacement();
    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({ replacesQuotationId: original.id });
    const error = expectApiError(response, { status: 409, code: ErrorCode.DRAFT_EXISTS });
    expect(error.details).toEqual({ quotationId: replacement.id });
  });

  it("sends the replacement: the old one is voided with 'Replaced by QT-…' and the request stays quoted", async () => {
    const { w, request, original, replacement } = await sentWithReplacement();
    const edited = await saveDraft(w, replacement, {
      lines: [
        ...EXAMPLE_LINES,
        { description: "Extra filter", quantity: "1", unitPrice: "20.00", taxable: true },
      ],
    });

    const response = await sendRequest(w, edited.id);
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(response)).toMatchObject({
      status: "SENT",
      requestStatus: "QUOTED",
      replaces: { id: original.id, status: "VOID" },
    });

    const old = await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } });
    expect(old).toMatchObject({
      status: "VOID",
      voidReason: `Replaced by ${edited.reference}`,
      voidedByUserId: w.admin.id,
    });
    expect(old.voidedAt?.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    // Exactly one is sent; the history of the old offer is intact.
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
    expect(await prisma.quotation.count({ where: { requestId: request.id } })).toBe(2);
    expect(await prisma.quotationLineItem.count({ where: { quotationId: original.id } })).toBe(3);
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("QUOTED");
  });

  it("tells the customer once: a new quotation is ready, with no separate 'withdrawn' notice", async () => {
    const { w, original, replacement } = await sentWithReplacement();
    await sendRequest(w, replacement.id);
    await w.deps.emailDispatcher.idle();

    const notifications = await prisma.notification.findMany({ orderBy: { createdAt: "asc" } });
    expect(notifications.map((notification) => notification.type)).toEqual([
      "QUOTATION_SENT",
      "QUOTATION_SENT",
    ]);
    expect(notifications.at(-1)?.linkPath).toBe(`/portal/quotations/${replacement.id}`);
    expect(w.emails.sent.map((email) => email.subject)).toEqual([
      expect.stringContaining(original.reference),
      expect.stringContaining(replacement.reference),
    ]);

    const events = await prisma.activityEvent.findMany({
      where: { action: "quotation.voided" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityId: original.id,
      fromStatus: "SENT",
      toStatus: "VOID",
      publicSummary: `We replaced quotation ${original.reference} with ${replacement.reference}.`,
    });
  });

  it("does not let the replacement go out once the customer has answered the original", async () => {
    const { w, request, original, replacement } = await sentWithReplacement();
    // The customer accepted the old quotation while the new one was being prepared.
    await prisma.quotation.update({
      where: { id: original.id },
      data: { status: "ACCEPTED", respondedAt: new Date("2026-03-02T09:00:00.000Z") },
    });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { status: "ACCEPTED" } });
    const before = await footprint(w);

    const response = await sendRequest(w, replacement.id);

    expectApiError(response, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });
    expect(await footprint(w)).toEqual(before);
    expect(
      (await prisma.quotation.findUniqueOrThrow({ where: { id: replacement.id } })).status,
    ).toBe("DRAFT");
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } })).status).toBe(
      "ACCEPTED",
    );
  });

  it("is atomic: if the replacement cannot be sent, the old quotation is not voided", async () => {
    const { w, original, replacement } = await sentWithReplacement();
    // Make the replacement unsendable only after the old one would have been voided: a past date.
    await prisma.quotation.update({
      where: { id: replacement.id },
      data: { validUntil: new Date("2026-03-01") },
    });

    expectApiError(await sendRequest(w, replacement.id), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });

    const old = await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } });
    expect(old.status).toBe("SENT");
    expect(old.voidedAt).toBeNull();
    expect(old.voidReason).toBeNull();
  });

  it("leaves exactly one sent quotation when the replacement is sent twice at once", async () => {
    const { w, request, replacement } = await sentWithReplacement();

    const responses = await Promise.all([
      sendRequest(w, replacement.id),
      sendRequest(w, replacement.id),
    ]);
    await w.deps.emailDispatcher.idle();

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "VOID" } })).toBe(
      1,
    );
    expect(await prisma.activityEvent.count({ where: { action: "quotation.voided" } })).toBe(1);
  });

  it("can only replace a quotation that is sent, and only on its own request", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const other = await makeRequest(w, { owner: "priya" });
    const draft = await readyDraft(w, request.id);

    // A draft is not a sent quotation.
    expectApiError(
      await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({ replacesQuotationId: draft.id }),
      { status: 409, code: ErrorCode.DRAFT_EXISTS },
    );
    await voidRequest(w, draft.id, { expectedStatus: "DRAFT", reason: "Start again, please." });
    const voided = await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(voided.status).toBe("VOID");
    expectApiError(
      await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({ replacesQuotationId: draft.id }),
      { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION },
    );
    // Another request's quotation is not found here.
    const sentElsewhere = await sentQuotation(w, other.id);
    expectApiError(
      await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({ replacesQuotationId: sentElsewhere.id }),
      { status: 404, code: ErrorCode.NOT_FOUND },
    );
  });

  it("does not start a first quotation on a request that already has one sent", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    await sentQuotation(w, request.id);
    const before = await footprint(w);

    const response = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({});

    const error = expectApiError(response, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(error.message).toContain("Replace it");
    expect(await footprint(w)).toEqual(before);
    expect((await getAdminRequest(w, request.id)).availableActions).toEqual(["CANCEL"]);
  });
});

describe("voiding (FR-046, BR-16, G.5)", () => {
  it("voids a draft with a reason: who, when and why are kept, and the request is left as it was", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const draft = await readyDraft(w, request.id);

    const response = await voidRequest(w, draft.id, {
      expectedStatus: "DRAFT",
      reason: INTERNAL_VOID_REASON,
    });
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    const voided = dataOf<AdminQuotationDto>(response);
    expect(voided).toMatchObject({
      status: "VOID",
      availableActions: [],
      voided: {
        at: "2026-03-02T09:00:00.000Z",
        by: { name: "Morgan Reyes" },
        reason: INTERNAL_VOID_REASON,
      },
    });
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("UNDER_REVIEW");
    // A draft never reached the customer: no notification, no email, nothing on their timeline.
    expect(await prisma.notification.count()).toBe(0);
    expect(w.emails.sent).toHaveLength(0);
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "quotation.voided" },
    });
    expect(event).toMatchObject({ publicSummary: null, fromStatus: "DRAFT", toStatus: "VOID" });
    // The request can be quoted again.
    expect((await getAdminRequest(w, request.id)).availableActions).toEqual([
      "CREATE_QUOTATION",
      "CANCEL",
    ]);
  });

  it("voids the only sent quotation: the request goes back under review and the customer is told", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id);

    const response = await voidRequest(w, sent.id, {
      expectedStatus: "SENT",
      reason: INTERNAL_VOID_REASON,
      customerMessage: "We priced the wrong unit. A corrected quotation will follow.",
    });
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(response)).toMatchObject({
      status: "VOID",
      requestStatus: "UNDER_REVIEW",
    });
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("UNDER_REVIEW");

    const withdrawn = await prisma.notification.findFirstOrThrow({
      where: { type: "QUOTATION_WITHDRAWN" },
    });
    expect(withdrawn).toMatchObject({
      recipientUserId: w.alex.user.id,
      message: "We priced the wrong unit. A corrected quotation will follow.",
      linkPath: `/portal/requests/${request.id}`,
    });
    const email = w.emails.last;
    expect(email?.subject).toBe(`Quotation ${sent.reference} was withdrawn`);
    expect(email?.text).toContain("We priced the wrong unit. A corrected quotation will follow.");

    // The internal reason is nowhere the customer can read.
    expect(JSON.stringify(withdrawn)).not.toContain("internal margin");
    expect(email?.text).not.toContain("internal margin");
    expect(email?.html).not.toContain("internal margin");

    // Two staff-only/status events, and the customer-facing one.
    const voidedEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "quotation.voided" },
    });
    expect(voidedEvent.publicSummary).toBe(`We withdrew quotation ${sent.reference}.`);
    expect(voidedEvent.summary).not.toContain("internal margin");
    const resumed = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "request.review_resumed" },
    });
    expect(resumed).toMatchObject({
      fromStatus: "QUOTED",
      toStatus: "UNDER_REVIEW",
      publicSummary: null,
    });
  });

  it("uses a standard line when there is no message for the customer", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);
    await voidRequest(w, sent.id, { expectedStatus: "SENT", reason: INTERNAL_VOID_REASON });

    const withdrawn = await prisma.notification.findFirstOrThrow({
      where: { type: "QUOTATION_WITHDRAWN" },
    });
    expect(withdrawn.message).toBe(
      "We withdrew the quotation for AC Repair. It can no longer be accepted.",
    );
    expect(JSON.stringify(withdrawn)).not.toContain("internal margin");
  });

  it("needs a reason of 5 to 500 characters", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const before = await footprint(w);

    for (const reason of [undefined, "", "   ", "no", "x".repeat(501)]) {
      const response = await voidRequest(w, draft.id, {
        expectedStatus: "DRAFT",
        ...(reason !== undefined && { reason }),
      });
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(["reason"]);
    }
    expect(await footprint(w)).toEqual(before);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT",
    );
  });

  it("does not take a message for the customer on a draft, which they never saw", async () => {
    const w = await quotationWorld(prisma);
    const draft = await readyDraft(w, (await makeRequest(w)).id);
    const response = await voidRequest(w, draft.id, {
      expectedStatus: "DRAFT",
      reason: "Start again, please.",
      customerMessage: "Sorry about that.",
    });
    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(["customerMessage"]);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "DRAFT",
    );
  });

  it.each(["ACCEPTED", "DECLINED", "EXPIRED", "VOID"] as const)(
    "refuses a quotation that is already %s with 409 and changes nothing",
    async (status) => {
      const w = await quotationWorld(prisma);
      const request = await makeRequest(w);
      const sent = await sentQuotation(w, request.id);
      await prisma.quotation.update({
        where: { id: sent.id },
        data: {
          status,
          ...(status === "VOID" && { voidedAt: new Date(), voidReason: "Earlier void." }),
        },
      });
      const snapshot = await quotationSnapshot(prisma, sent.id);
      const before = await footprint(w);

      const response = await voidRequest(w, sent.id, {
        expectedStatus: status,
        reason: "Trying to void it again.",
      });

      expectApiError(response, { status: 409, code: ErrorCode.INVALID_STATE_TRANSITION });
      expect(await quotationSnapshot(prisma, sent.id)).toBe(snapshot);
      expect(await footprint(w)).toEqual(before);
    },
  );

  it("answers 409 STALE_STATE when the screen's status is out of date", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);
    const response = await voidRequest(w, sent.id, {
      expectedStatus: "DRAFT",
      reason: "From an old screen.",
    });
    const error = expectApiError(response, { status: 409, code: ErrorCode.STALE_STATE });
    expect(error.details).toEqual({ currentStatus: "SENT" });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe(
      "SENT",
    );
  });

  it("voids once when two admins void together", async () => {
    const w = await quotationWorld(prisma);
    const sent = await sentQuotation(w, (await makeRequest(w)).id);

    const responses = await Promise.all([
      voidRequest(w, sent.id, { expectedStatus: "SENT", reason: "First admin's reason." }),
      voidRequest(w, sent.id, { expectedStatus: "SENT", reason: "Second admin's reason." }),
    ]);
    await w.deps.emailDispatcher.idle();

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.activityEvent.count({ where: { action: "quotation.voided" } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "QUOTATION_WITHDRAWN" } })).toBe(1);
    expect(w.emails.sent.filter((email) => email.subject.includes("withdrawn"))).toHaveLength(1);
  });

  it("lets a voided replacement draft go: the sent quotation can be replaced again", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const original = await sentQuotation(w, request.id);
    const first = dataOf<AdminQuotationDto>(
      await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({ replacesQuotationId: original.id }),
    );

    const voided = await voidRequest(w, first.id, {
      expectedStatus: "DRAFT",
      reason: "Wrong starting point.",
    });
    expect(voided.status).toBe(200);

    // The draft never reached the customer, so the original is still the live offer ...
    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.replacesQuotationId).toBeNull();
    const event = await prisma.activityEvent.findFirstOrThrow({
      where: { action: "quotation.voided", entityId: first.id },
    });
    expect(event.metadata).toMatchObject({ replacesReference: original.reference });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } })).status).toBe(
      "SENT",
    );
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("QUOTED");

    // ... and it can be replaced again.
    const second = await w.client
      .post(createPath(request.id), { cookie: w.adminCookie })
      .send({ replacesQuotationId: original.id });
    expect(second.status).toBe(201);
    expect(dataOf<AdminQuotationDto>(second).replaces?.id).toBe(original.id);
  });

  it("lets the replacement go out after the sent quotation was voided, as a first quotation", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const original = await sentQuotation(w, request.id);
    const replacement = dataOf<AdminQuotationDto>(
      await w.client
        .post(createPath(request.id), { cookie: w.adminCookie })
        .send({ replacesQuotationId: original.id }),
    );

    // The team voids the sent one while the replacement is still being prepared.
    await voidRequest(w, original.id, { expectedStatus: "SENT", reason: "Priced the wrong unit." });
    expect(
      (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("UNDER_REVIEW");

    const response = await sendRequest(w, replacement.id);

    expect(response.status).toBe(200);
    expect(dataOf<AdminQuotationDto>(response)).toMatchObject({
      status: "SENT",
      requestStatus: "QUOTED",
    });
    expect(await prisma.quotation.count({ where: { requestId: request.id, status: "SENT" } })).toBe(
      1,
    );
  });
});

describe("reading a quotation (G.2)", () => {
  it("returns the quotation, its request and customer, the chain and the history", async () => {
    const w = await quotationWorld(prisma);
    const request = await makeRequest(w);
    const sent = await sentQuotation(w, request.id, { customerNote: "Parts in stock." });

    const response = await w.client.get(quotationPath(sent.id), { cookie: w.adminCookie });

    expect(response.status).toBe(200);
    const view = dataOf<AdminQuotationDto>(response);
    expect(view).toMatchObject({
      id: sent.id,
      reference: sent.reference,
      status: "SENT",
      requestId: request.id,
      requestReference: request.reference,
      customer: {
        id: w.alex.profile.id,
        name: "Alex Morgan",
        email: ALEX,
        phone: "(212) 555-0100",
      },
      business: { name: "CoolBreeze Home Services", email: "hello@coolbreeze.test" },
      customerNote: "Parts in stock.",
      voided: null,
      replaces: null,
      replacedBy: null,
    });
    expect(view.timeline.map((event) => event.action)).toEqual([
      "quotation.created",
      "quotation.sent",
    ]);
    expect(view.timeline[1]).toMatchObject({
      customerVisible: true,
      actor: { name: "Morgan Reyes", role: "BUSINESS_ADMIN" },
    });
    expect(view.timeline[0]).toMatchObject({ customerVisible: false });
  });

  it("answers 404 for an unknown quotation and 422 for an id that is not one", async () => {
    const w = await quotationWorld(prisma);
    expectApiError(await w.client.get(quotationPath(MISSING_ID), { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
    expectApiError(await w.client.get(quotationPath("QT-2026-00001"), { cookie: w.adminCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

describe("rate limiting", () => {
  it("answers 429 once an admin writes too fast", async () => {
    const w = await quotationWorld(prisma, {
      rateLimits: { adminWrite: { limit: 2, windowSeconds: 60 } },
    });
    const request = await makeRequest(w);
    const post = () => w.client.post(createPath(request.id), { cookie: w.adminCookie }).send({});

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(409); // counted too
    expectApiError(await post(), { status: 429, code: ErrorCode.RATE_LIMITED });
  });
});
