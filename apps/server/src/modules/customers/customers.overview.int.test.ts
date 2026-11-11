import { type CustomerOverviewDto, ErrorCode } from "@fixflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type DashboardWorld, dashboardWorld } from "../../test/dashboard-world.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import { invoiceWorld } from "../../test/invoice-world.js";
import { ALEX, dataOf } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
const OVERVIEW = "/api/v1/customers/me/overview";

let w: DashboardWorld;

beforeAll(async () => {
  await resetDatabase(prisma);
  w = await dashboardWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

async function overviewOf(cookie: string): Promise<{ dto: CustomerOverviewDto; text: string }> {
  const response = await w.client.get(OVERVIEW, { cookie });
  expect(response.status).toBe(200);
  return { dto: dataOf<CustomerOverviewDto>(response), text: JSON.stringify(response.body) };
}

describe("GET /customers/me/overview: access", () => {
  it("is 401 without a session and 403 for the business's admin", async () => {
    expectApiError(await w.client.get(OVERVIEW), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await w.client.get(OVERVIEW, { cookie: w.adminCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });
});

describe("what the customer has to do (FR-014, IA-C01)", () => {
  it("lists the quotations awaiting an answer, the soonest to run out first", async () => {
    const { dto } = await overviewOf(w.alexCookie);
    // Alex's two sent quotations: valid to 6 March, and to 8 March. Priya's (7 March) is not his.
    expect(dto.actionRequired.quotations.items.map((quotation) => quotation.id)).toEqual([
      w.sentQuote.id,
      expect.any(String),
    ]);
    expect(dto.actionRequired.quotations.totalItems).toBe(2);
    expect(dto.actionRequired.quotations.items.map((quotation) => quotation.id)).not.toContain(
      w.edgeQuote.id,
    );
  });

  it("lists the invoices that still owe money, the soonest due first, and says how many there are", async () => {
    const { dto } = await overviewOf(w.alexCookie);
    // Alex's: overdue 27 Feb (balance 100.00), overdue 1 Mar (80.00), then two due 16 March. The paid,
    // voided and draft ones owe nothing; the 60.00 invoice is Priya's. Three are listed, four exist.
    const { items, totalItems } = dto.actionRequired.invoices;
    expect(totalItems).toBe(4);
    expect(items).toHaveLength(3);
    expect(items.map((invoice) => invoice.id).slice(0, 2)).toEqual([
      w.invoices.p3.invoice.id,
      w.invoices.p4.invoice.id,
    ]);
    expect(items.map((invoice) => invoice.balanceDue).slice(0, 2)).toEqual(["100.00", "80.00"]);
    expect(items.map((invoice) => invoice.status).slice(0, 2)).toEqual(["OVERDUE", "OVERDUE"]);
  });

  it("counts what is to do: quotations to answer plus invoices to pay", async () => {
    const { dto } = await overviewOf(w.alexCookie);
    expect(dto.counts.actionRequired).toBe(2 + 4);
  });
});

describe("what is coming (FR-014)", () => {
  it("lists the first visits, booked ones soonest first, and counts them all", async () => {
    const { dto } = await overviewOf(w.alexCookie);
    // Alex's seven booked visits (j1 to j7) and the two jobs waiting for a time (j8, j9).
    expect(dto.upcomingVisits.totalItems).toBe(9);
    expect(dto.upcomingVisits.items.map((job) => job.id)).toEqual([
      w.jobs.j7.id, // 4 March 09:00
      w.jobs.j1.id, // 5 March 09:00
      w.jobs.j2.id, // 5 March 11:00
    ]);
    expect(dto.counts.upcomingVisits).toBe(9);
  });

  it("lists the latest three requests, newest first, and counts them all", async () => {
    const { dto } = await overviewOf(w.alexCookie);
    expect(dto.recentRequests.items.map((request) => request.id)).toEqual([
      w.requests.recent.id, // 5 March 10:00
      w.requests.midnight.id, // 5 March 00:00
      w.requests.lateEdge.id, // 4 March 23:30
    ]);
    const own = await prisma.serviceRequest.count({ where: { customerId: w.alex.profile.id } });
    expect(dto.recentRequests.totalItems).toBe(own);
    expect(dto.counts.requests).toBe(own);
  });
});

describe("a customer sees only their own (G.4, BR-19)", () => {
  it("shows Priya her own quotation, invoice and request and nothing of Alex's", async () => {
    const { dto, text } = await overviewOf(w.priyaCookie);

    expect(dto.actionRequired.quotations.items.map((quotation) => quotation.id)).toEqual([
      w.edgeQuote.id,
    ]);
    expect(dto.actionRequired.invoices.items.map((invoice) => invoice.id)).toEqual([
      w.invoices.priya.invoice.id,
    ]);
    expect(dto.actionRequired.invoices.items[0]?.balanceDue).toBe("60.00");
    expect(dto.upcomingVisits).toEqual({ items: [], totalItems: 0 });
    // Her quoted request, and the older one behind her invoice.
    expect(dto.recentRequests.items.map((request) => request.id)).toEqual([
      w.edgeRequest.id,
      w.invoices.priya.job.requestId,
    ]);

    // Nothing that identifies a record of Alex's appears anywhere in the response.
    const alexIds = [
      w.sentQuote.id,
      w.invoices.p1.invoice.id,
      w.invoices.p3.invoice.id,
      w.jobs.j1.id,
      w.requests.recent.id,
      w.requests.recent.reference,
      w.invoices.p1.invoice.invoiceNumber ?? "never",
      ALEX,
      "Alex Morgan",
    ];
    for (const secret of alexIds) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("shows Alex nothing of Priya's", async () => {
    const { text } = await overviewOf(w.alexCookie);
    for (const secret of [
      w.edgeQuote.id,
      w.invoices.priya.invoice.id,
      w.invoices.priya.invoice.invoiceNumber ?? "never",
      w.edgeRequest.id,
      "priya.shah@example.test",
      "Priya Shah",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("carries the customer's shapes only: no staff names, internal notes or admin actions", async () => {
    const { text } = await overviewOf(w.alexCookie);
    for (const word of [
      "availableActions",
      "internalNote",
      "internalCompletionNote",
      "Morgan Reyes",
      "voidReason",
      "createdByUserId",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});

describe("a customer with nothing yet", () => {
  it("gets empty sections and zero counts, not an error", async () => {
    await resetDatabase(prisma);
    const empty = await invoiceWorld(prisma);
    const response = await empty.client.get(OVERVIEW, { cookie: empty.alexCookie });
    expect(response.status).toBe(200);
    expect(dataOf<CustomerOverviewDto>(response)).toEqual({
      actionRequired: {
        quotations: { items: [], totalItems: 0 },
        invoices: { items: [], totalItems: 0 },
      },
      upcomingVisits: { items: [], totalItems: 0 },
      recentRequests: { items: [], totalItems: 0 },
      counts: { actionRequired: 0, upcomingVisits: 0, requests: 0 },
    });
  });
});
