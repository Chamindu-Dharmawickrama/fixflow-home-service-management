import {
  type AdminInvoiceDto,
  type CustomerInvoiceDto,
  type CustomerInvoiceListItemDto,
  type CustomerWorkOrderDto,
  ErrorCode,
  InvoiceStatus,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signInAs } from "../../test/auth-helpers.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { bodyOf, expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  draftInvoice,
  type InvoiceWorld,
  invoiceWorld,
  issuedInvoice,
  moveClockTo,
  paid,
  payableInvoice,
  paymentBody,
  recordPaymentRequest,
  voidInvoiceRequest,
  voidPaymentRequest,
} from "../../test/invoice-world.js";
import { ALEX, dataOf, INTERNAL_VOID_REASON, MISSING_ID } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

const MY_INVOICES = "/api/v1/invoices/me";
const invoicePath = (id: string) => `/api/v1/invoices/${id}`;

/** Words only the business may know: none may appear anywhere in what a customer is sent. */
const INTERNAL = {
  paymentReference: "Cheque 004512 (internal ledger ref)",
  paymentNotes: "Left with the neighbour; chase the landlord",
  paymentVoidReason: "Entered twice by mistake, ignore the first one",
  completionNote: "INTERNAL: the unit is a lemon, quote a replacement.",
  recorder: "Morgan Reyes",
};

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma, { logLevel: "info" });
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const mine = (cookie = w.alexCookie, query = "") =>
  w.client.get(`${MY_INVOICES}${query}`, { cookie });

async function listOf(cookie = w.alexCookie, query = ""): Promise<CustomerInvoiceListItemDto[]> {
  const response = await mine(cookie, query);
  expect(response.status).toBe(200);
  return bodyOf<{ data: CustomerInvoiceListItemDto[] }>(response).data;
}

const readInvoice = (id: string, cookie = w.alexCookie) =>
  w.client.get(invoicePath(id), { cookie });

/** The keys of an object, sorted, for an exact allowlist comparison. */
const keysOf = (value: unknown): string[] => Object.keys(value as object).sort();

describe("GET /invoices/me (FR-072, IA-C05)", () => {
  it("is 401 without a session and 403 for the business's admin", async () => {
    expectApiError(await w.client.get(MY_INVOICES), {
      status: 401,
      code: ErrorCode.UNAUTHENTICATED,
    });
    expectApiError(await mine(w.adminCookie), { status: 403, code: ErrorCode.FORBIDDEN });
  });

  it("has an empty list, not an error, for a customer with no invoices", async () => {
    const response = await mine();
    expect(response.status).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
  });

  it("lists only the signed-in customer's invoices (the session decides, nothing in the request)", async () => {
    const alexs = await payableInvoice(w, { owner: "alex" });
    const priyas = await payableInvoice(w, { owner: "priya" });

    const alex = await listOf(w.alexCookie);
    const priya = await listOf(w.priyaCookie);
    expect(alex.map((item) => item.id)).toEqual([alexs.invoice.id]);
    expect(priya.map((item) => item.id)).toEqual([priyas.invoice.id]);

    // A customer id in the query is not a way to read someone else's list.
    const probe = await mine(w.alexCookie, `?customerId=${w.priya.profile.id}`);
    expect(bodyOf<{ data: CustomerInvoiceListItemDto[] }>(probe).data.map((i) => i.id)).toEqual([
      alexs.invoice.id,
    ]);
    const counted = bodyOf<{ pagination: { totalItems: number } }>(await mine(w.alexCookie));
    expect(counted.pagination.totalItems).toBe(1);
  });

  it("never lists a draft, nor a draft that was voided before it was issued (D-26)", async () => {
    const draft = await draftInvoice(w);
    expect(await listOf()).toEqual([]);

    const response = await voidInvoiceRequest(w, draft.invoice.id, {
      reason: INTERNAL_VOID_REASON,
      expectedStatus: "DRAFT",
    });
    expect(response.status).toBe(200);
    expect(await listOf()).toEqual([]);
  });

  it("lists an issued invoice that was voided afterwards, as Void", async () => {
    const { invoice } = await payableInvoice(w);
    await voidInvoiceRequest(w, invoice.id, {
      reason: INTERNAL_VOID_REASON,
      expectedStatus: "ISSUED",
    });
    const [item] = await listOf();
    expect(item).toMatchObject({ id: invoice.id, status: "VOID", statusLabel: "Void" });
  });

  it("gives each row what the list shows, with the balance worked out by the server", async () => {
    const { invoice, job } = await payableInvoice(w);
    await paid(w, invoice.id, "100.00");

    const [item] = await listOf();
    expect(item).toEqual({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: "PARTIALLY_PAID",
      statusLabel: "Partially paid",
      issueDate: "2026-03-02",
      dueDate: "2026-03-16",
      currencyCode: "USD",
      totalAmount: "300.00",
      amountPaid: "100.00",
      balanceDue: "200.00",
      daysOverdue: 0,
      serviceName: expect.any(String) as string,
      jobReference: expect.any(String) as string,
    });
    expect(item?.jobReference).toMatch(/^JOB-/);
    expect(job.id).toBeTruthy();
  });

  it("lists the newest first", async () => {
    const first = await payableInvoice(w);
    w.clock.advance(60_000);
    const second = await payableInvoice(w);
    w.clock.advance(60_000);
    const third = await payableInvoice(w);
    const ids = (await listOf()).map((item) => item.id);
    expect(ids).toEqual([third.invoice.id, second.invoice.id, first.invoice.id]);

    const oldestFirst = (await listOf(w.alexCookie, "?order=asc")).map((item) => item.id);
    expect(oldestFirst).toEqual([first.invoice.id, second.invoice.id, third.invoice.id]);
  });

  it("filters by status: Outstanding is issued, part-paid and overdue; Paid is paid", async () => {
    const owing = await payableInvoice(w);
    const partly = await payableInvoice(w);
    await paid(w, partly.invoice.id, "50.00");
    const settled = await payableInvoice(w);
    await paid(w, settled.invoice.id, "300.00");

    const outstanding = await listOf(w.alexCookie, "?status=ISSUED,PARTIALLY_PAID,OVERDUE");
    expect(outstanding.map((item) => item.id).sort()).toEqual(
      [owing.invoice.id, partly.invoice.id].sort(),
    );
    const settledOnly = await listOf(w.alexCookie, "?status=PAID");
    expect(settledOnly.map((item) => item.id)).toEqual([settled.invoice.id]);
    expect(await listOf(w.alexCookie)).toHaveLength(3);
    // The same filter as repeated parameters.
    expect(
      await listOf(w.alexCookie, "?status=ISSUED&status=PARTIALLY_PAID&status=OVERDUE"),
    ).toHaveLength(2);
  });

  it("refuses a status a customer can never be shown, and an unknown one, with 422", async () => {
    for (const status of ["DRAFT", "PENDING", "paid"]) {
      expectApiError(await mine(w.alexCookie, `?status=${status}`), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
  });

  it("reads an invoice that is past its due date as Overdue, and saves it", async () => {
    const { invoice } = await payableInvoice(w);
    await moveClockTo(w, "2026-03-20T15:00:00.000Z");
    w.alexCookie = await signInAs(w.app, ALEX);

    const [item] = await listOf(w.alexCookie, "?status=OVERDUE");
    expect(item).toMatchObject({
      id: invoice.id,
      status: "OVERDUE",
      statusLabel: "Overdue",
      daysOverdue: 4,
      balanceDue: "300.00",
    });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.status).toBe(InvoiceStatus.OVERDUE);
  });

  it("pages the list, with the totals of the whole list", async () => {
    for (let index = 0; index < 3; index += 1) {
      await payableInvoice(w);
      w.clock.advance(60_000);
    }
    const response = await mine(w.alexCookie, "?pageSize=2&page=2");
    const body = bodyOf<{
      data: unknown[];
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
    }>(response);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it("is read-only: listing changes nothing", async () => {
    await payableInvoice(w);
    const before = await prisma.invoice.findMany({ orderBy: { id: "asc" } });
    const events = await prisma.activityEvent.count();
    await mine();
    expect(await prisma.invoice.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.activityEvent.count()).toBe(events);
  });
});

describe("GET /invoices/:id (FR-072, D-41)", () => {
  it("returns the invoice to its owner: snapshot details, lines, totals, balance, instructions", async () => {
    const { invoice } = await payableInvoice(w);
    await paid(w, invoice.id, "100.00", { paymentDate: "2026-03-02", method: "CHEQUE" });

    const response = await readInvoice(invoice.id);
    expect(response.status).toBe(200);
    const body = dataOf<CustomerInvoiceDto>(response);
    expect(body).toMatchObject({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: "PARTIALLY_PAID",
      statusLabel: "Partially paid",
      currencyCode: "USD",
      taxRate: "0.00",
      subtotal: "300.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "300.00",
      amountPaid: "100.00",
      balanceDue: "200.00",
      issueDate: "2026-03-02",
      dueDate: "2026-03-16",
      daysOverdue: 0,
      paidOn: null,
      voidedAt: null,
      timeZone: "America/New_York",
    });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      description: "Service call",
      quantity: "1.00",
      unitPrice: "300.00",
      lineTotal: "300.00",
      taxable: false,
    });
    expect(body.business.name).toBe(invoice.business.name);
    expect(body.customer).toEqual(invoice.customer);
    expect(body.paymentInstructions).toBe(invoice.paymentInstructions);
    expect(body.footer).toBe(invoice.footer);
    expect(body.job).toEqual(invoice.job);
    expect(body.request).toEqual(invoice.request);
    expect(body.payments).toEqual([
      {
        id: expect.any(String) as string,
        paymentDate: "2026-03-02",
        method: "CHEQUE",
        methodLabel: "Cheque",
        amount: "100.00",
      },
    ]);
  });

  it("says when an invoice was paid in full, on the day of the last payment", async () => {
    const { invoice } = await payableInvoice(w);
    await paid(w, invoice.id, "100.00", { paymentDate: "2026-03-01" });
    await paid(w, invoice.id, "200.00", { paymentDate: "2026-03-02" });
    const body = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));
    expect(body).toMatchObject({
      status: "PAID",
      balanceDue: "0.00",
      amountPaid: "300.00",
      paidOn: "2026-03-02",
    });
    expect(body.payments.map((payment) => payment.paymentDate)).toEqual([
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  describe("payments the business voided (D-110)", () => {
    it("are left out, and the amount paid and balance are already the adjusted ones", async () => {
      const { invoice } = await payableInvoice(w);
      const first = await paid(w, invoice.id, "100.00");
      await paid(w, invoice.id, "50.00");
      const wrong = first.payments[0];
      expect(wrong).toBeDefined();
      const voided = await voidPaymentRequest(w, invoice.id, wrong?.id ?? "", {
        reason: INTERNAL.paymentVoidReason,
      });
      expect(voided.status).toBe(200);

      const body = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));
      expect(body.payments).toHaveLength(1);
      expect(body.payments[0]?.amount).toBe("50.00");
      expect(body.amountPaid).toBe("50.00");
      expect(body.balanceDue).toBe("250.00");
      expect(JSON.stringify(body)).not.toContain(INTERNAL.paymentVoidReason);
    });

    it("leave a paid invoice open again when the payment that settled it is voided", async () => {
      const { invoice } = await payableInvoice(w);
      const settled = await paid(w, invoice.id, "300.00");
      await voidPaymentRequest(w, invoice.id, settled.payments[0]?.id ?? "", {
        reason: INTERNAL.paymentVoidReason,
      });
      const body = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));
      expect(body).toMatchObject({
        status: "ISSUED",
        payments: [],
        amountPaid: "0.00",
        balanceDue: "300.00",
        paidOn: null,
      });
    });
  });

  describe("authorization", () => {
    it("is 401 without a session", async () => {
      const { invoice } = await payableInvoice(w);
      expectApiError(await w.client.get(invoicePath(invoice.id)), {
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
      });
    });

    it("gives another customer 404, in the same words as an id that does not exist", async () => {
      const { invoice } = await payableInvoice(w, { owner: "alex" });
      const foreign = await readInvoice(invoice.id, w.priyaCookie);
      const missing = await readInvoice(MISSING_ID, w.priyaCookie);
      expectApiError(foreign, { status: 404, code: ErrorCode.NOT_FOUND });
      expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
      const withoutRequestId = (response: typeof foreign) => {
        const { error } = bodyOf<{ error: Record<string, unknown> }>(response);
        const { requestId: _requestId, ...rest } = error;
        return rest;
      };
      expect(withoutRequestId(foreign)).toEqual(withoutRequestId(missing));
    });

    it("gives the owner of a draft 404: a draft is the business's working copy", async () => {
      const { invoice } = await draftInvoice(w);
      expectApiError(await readInvoice(invoice.id), { status: 404, code: ErrorCode.NOT_FOUND });
    });

    it("gives the owner 404 for a draft that was voided before it was ever issued", async () => {
      const { invoice } = await draftInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "DRAFT",
      });
      expectApiError(await readInvoice(invoice.id), { status: 404, code: ErrorCode.NOT_FOUND });
    });

    it("is 422 for something that is not an id", async () => {
      expectApiError(await readInvoice("not-an-id"), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it("lets the admin read an issued invoice in the same shape the customer gets", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const asCustomer = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));
      const asAdmin = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id, w.adminCookie));
      expect(asAdmin).toEqual(asCustomer);
    });

    it("keeps an admin's view of a draft to the admin endpoint: here it is 404", async () => {
      const { invoice } = await draftInvoice(w);
      expectApiError(await readInvoice(invoice.id, w.adminCookie), {
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("changes nothing when it refuses", async () => {
      const { invoice } = await payableInvoice(w);
      const before = JSON.stringify(
        await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }),
      );
      await readInvoice(invoice.id, w.priyaCookie);
      await readInvoice(MISSING_ID);
      expect(
        JSON.stringify(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })),
      ).toBe(before);
    });
  });

  describe("what a customer is never sent (D-41, BR-19)", () => {
    it("has exactly the allowlisted fields and nothing else", async () => {
      const { invoice } = await payableInvoice(w);
      await paid(w, invoice.id, "100.00");
      const body = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));

      expect(keysOf(body)).toEqual(
        [
          "id",
          "invoiceNumber",
          "status",
          "statusLabel",
          "issueDate",
          "dueDate",
          "currencyCode",
          "totalAmount",
          "amountPaid",
          "balanceDue",
          "daysOverdue",
          "serviceName",
          "jobReference",
          "taxRate",
          "lines",
          "subtotal",
          "discountAmount",
          "taxableBase",
          "taxAmount",
          "customerNote",
          "business",
          "customer",
          "paymentInstructions",
          "footer",
          "job",
          "request",
          "payments",
          "paidOn",
          "voidedAt",
          "timeZone",
        ].sort(),
      );
      expect(keysOf(body.payments[0])).toEqual(
        ["amount", "id", "method", "methodLabel", "paymentDate"].sort(),
      );
      expect(keysOf(body.lines[0])).toEqual(
        ["description", "id", "lineTotal", "position", "quantity", "taxable", "unitPrice"].sort(),
      );
      expect(keysOf(body.business)).toEqual(
        ["address", "email", "logoKey", "logoUrl", "name", "phone", "tagline"].sort(),
      );
      expect(keysOf(body.customer)).toEqual(["address", "email", "name"]);
      expect(keysOf(body.job)).toEqual(["id", "reference"]);
      expect(keysOf(body.request)).toEqual(["id", "reference"]);
    });

    it("carries none of the internal words, whatever the business wrote or did", async () => {
      const { invoice, job } = await payableInvoice(w);
      // The job's own internal note, the invoice's internal history and the payment's internals.
      await prisma.workOrder.update({
        where: { id: job.id },
        data: { internalCompletionNote: INTERNAL.completionNote },
      });
      const first = await paid(w, invoice.id, "100.00", {
        reference: INTERNAL.paymentReference,
        notes: INTERNAL.paymentNotes,
      });
      await paid(w, invoice.id, "50.00", {
        reference: INTERNAL.paymentReference,
        notes: INTERNAL.paymentNotes,
      });
      await voidPaymentRequest(w, invoice.id, first.payments[0]?.id ?? "", {
        reason: INTERNAL.paymentVoidReason,
      });

      const asAdmin = bodyOf<{ data: AdminInvoiceDto }>(
        await w.client.get(`${ADMIN_INVOICES}/${invoice.id}`, { cookie: w.adminCookie }),
      ).data;
      // The admin's own view does carry them: this proves the words are real and would leak.
      expect(JSON.stringify(asAdmin)).toContain(INTERNAL.paymentReference);
      expect(JSON.stringify(asAdmin)).toContain(INTERNAL.recorder);

      for (const cookie of [w.alexCookie, w.adminCookie]) {
        const detail = await readInvoice(invoice.id, cookie);
        expect(detail.status).toBe(200);
        const text = JSON.stringify(detail.body);
        for (const secret of Object.values(INTERNAL)) {
          expect(text, secret).not.toContain(secret);
        }
        expect(text).not.toContain("createdBy");
        expect(text).not.toContain("issuedBy");
        expect(text).not.toContain("voidReason");
        expect(text).not.toContain("recordedBy");
      }
      const list = JSON.stringify((await mine()).body);
      for (const secret of Object.values(INTERNAL)) {
        expect(list, secret).not.toContain(secret);
      }
    });

    it("does not tell a customer why an invoice was voided", async () => {
      const { invoice } = await payableInvoice(w);
      await voidInvoiceRequest(w, invoice.id, {
        reason: INTERNAL_VOID_REASON,
        expectedStatus: "ISSUED",
      });
      const response = await readInvoice(invoice.id);
      const body = dataOf<CustomerInvoiceDto>(response);
      expect(body.status).toBe("VOID");
      expect(body.voidedAt).toEqual(expect.any(String));
      expect(JSON.stringify(response.body)).not.toContain(INTERNAL_VOID_REASON);
    });
  });

  describe("it is the invoice as it was issued (DM-04)", () => {
    it("is unchanged by later changes to the business settings", async () => {
      const { invoice } = await payableInvoice(w);
      const before = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));

      await prisma.businessSettings.updateMany({
        data: {
          businessName: "A Different Company Ltd",
          phone: "(999) 000-1111",
          paymentInstructions: "Send everything to a new account instead.",
          invoiceFooter: "A brand new footer.",
          currencyCode: "EUR",
          defaultTaxRate: "20.00",
        },
      });
      const after = dataOf<CustomerInvoiceDto>(await readInvoice(invoice.id));
      expect(after.business).toEqual(before.business);
      expect(after.paymentInstructions).toBe(before.paymentInstructions);
      expect(after.footer).toBe(before.footer);
      expect(after.currencyCode).toBe("USD");
      expect(after.taxRate).toBe(before.taxRate);
      expect(after.totalAmount).toBe(before.totalAmount);
    });
  });
});

describe("the job's invoice link (T22, T18)", () => {
  const jobOf = (id: string, cookie = w.alexCookie) =>
    w.client.get(`/api/v1/work-orders/${id}`, { cookie });

  it("has no link before an invoice is issued: not for a draft either", async () => {
    const { job } = await draftInvoice(w);
    const body = dataOf<CustomerWorkOrderDto>(await jobOf(job.id));
    expect(body.invoice).toBeNull();
  });

  it("links the issued invoice with its number, status and id, and follows its status", async () => {
    const { job, invoice } = await payableInvoice(w);
    const issuedLink = dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice;
    expect(issuedLink).toEqual({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: "ISSUED",
      statusLabel: "Issued",
    });

    await paid(w, invoice.id, "100.00");
    expect(dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice).toMatchObject({
      status: "PARTIALLY_PAID",
    });
    await paid(w, invoice.id, "200.00");
    expect(dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice).toMatchObject({
      status: "PAID",
      statusLabel: "Paid",
    });
  });

  it("says Overdue once the due date has passed", async () => {
    const { job } = await payableInvoice(w);
    await moveClockTo(w, "2026-03-20T15:00:00.000Z");
    w.alexCookie = await signInAs(w.app, ALEX);
    expect(dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice).toMatchObject({
      status: "OVERDUE",
    });
  });

  it("has no link for an invoice that was voided (the business withdrew it)", async () => {
    const { job, invoice } = await payableInvoice(w);
    await voidInvoiceRequest(w, invoice.id, {
      reason: INTERNAL_VOID_REASON,
      expectedStatus: "ISSUED",
    });
    expect(dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice).toBeNull();
  });

  it("links only the customer's own invoice: another customer cannot open the job at all", async () => {
    const { job } = await issuedInvoice(w, "alex");
    expectApiError(await jobOf(job.id, w.priyaCookie), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("carries only the link's four fields", async () => {
    const { job } = await payableInvoice(w);
    const link = dataOf<CustomerWorkOrderDto>(await jobOf(job.id)).invoice;
    expect(keysOf(link)).toEqual(["id", "invoiceNumber", "status", "statusLabel"]);
  });
});

describe("payments are not recorded through the customer's endpoints", () => {
  it("has no way for a customer to record or void a payment on an invoice", async () => {
    const { invoice } = await payableInvoice(w);
    const attempt = await recordPaymentRequest(w, invoice.id, paymentBody(), w.alexCookie);
    expectApiError(attempt, { status: 403, code: ErrorCode.FORBIDDEN });
    const customerPost = await w.client
      .post(`${invoicePath(invoice.id)}/payments`, { cookie: w.alexCookie })
      .send(paymentBody());
    expect(customerPost.status).toBe(404);
  });
});
