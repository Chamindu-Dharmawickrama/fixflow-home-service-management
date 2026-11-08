import { type AdminInvoiceDto, ErrorCode, InvoiceAction, InvoiceStatus } from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signInAs } from "../../test/auth-helpers.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { expectApiError } from "../../test/http.js";
import {
  ADMIN_INVOICES,
  completedJob,
  draftInvoice,
  getInvoiceRequest,
  invoiceFootprint,
  type InvoiceWorld,
  invoiceWorld,
  issued,
  issueRequest,
  saveInvoice,
  startInvoice,
} from "../../test/invoice-world.js";
import { dataOf, MISSING_ID } from "../../test/quotation-world.js";

const prisma = getTestPrisma();
let w: InvoiceWorld;

beforeEach(async () => {
  await resetDatabase(prisma);
  w = await invoiceWorld(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ALEX_EMAIL = "alex.morgan@example.test";

/** Moves the clock and signs the admin in again: a session does not outlive days of fake time. */
async function moveClockTo(time: string) {
  w.clock.set(time);
  w.adminCookie = await signInAs(w.app, w.admin.email);
}

describe("POST /admin/invoices/:id/issue (FR-071, D-17, D-26)", () => {
  it("assigns the next INV- number and issues the invoice", async () => {
    const { invoice: draft } = await draftInvoice(w);

    const response = await issueRequest(w, draft.id);

    expect(response.status).toBe(200);
    const invoice = dataOf<AdminInvoiceDto>(response);
    expect(invoice.invoiceNumber).toBe("INV-2026-00001");
    expect(invoice.status).toBe(InvoiceStatus.ISSUED);
    expect(invoice.statusLabel).toBe("Issued");
    expect(invoice.isSnapshot).toBe(true);
    expect(invoice.issuedAt).toBe("2026-03-02T09:00:00.000Z");
    expect(invoice.issuedBy).toEqual({ name: "Morgan Reyes" });
    // Totals are what the draft held; the balance is the whole total, nothing is paid.
    expect(invoice.totalAmount).toBe(draft.totalAmount);
    expect(invoice.amountPaid).toBe("0.00");
    expect(invoice.balanceDue).toBe(draft.totalAmount);
    expect(invoice.availableActions).toEqual([InvoiceAction.VOID]);
  });

  it("numbers are sequential and unique across invoices", async () => {
    const numbers: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { invoice } = await draftInvoice(w, index % 2 === 0 ? "alex" : "priya");
      numbers.push((await issued(w, invoice.id)).invoiceNumber ?? "");
    }
    expect(numbers).toEqual(["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"]);
  });

  it("follows the business's calendar year: late on 31 December in New York is still that year", async () => {
    await moveClockTo("2027-01-01T03:00:00.000Z"); // 22:00 on 31 December 2026 in New York
    const { invoice } = await draftInvoice(w);
    expect((await issued(w, invoice.id)).invoiceNumber).toBe("INV-2026-00001");

    await moveClockTo("2027-01-01T06:00:00.000Z"); // 01:00 on 1 January 2027
    const { invoice: next } = await draftInvoice(w, "priya");
    expect((await issued(w, next.id)).invoiceNumber).toBe("INV-2027-00001");
  });

  describe("dates", () => {
    it("issues today (business calendar) when no issue date was chosen, and keeps the due date", async () => {
      const { invoice: draft } = await draftInvoice(w);
      expect(draft.issueDate).toBeNull();

      const invoice = await issued(w, draft.id);

      expect(invoice.issueDate).toBe("2026-03-02");
      expect(invoice.dueDate).toBe(draft.dueDate);
    });

    it("uses the New York day, not the UTC day, when it is already tomorrow in UTC", async () => {
      const { invoice: draft } = await draftInvoice(w);
      w.clock.set("2026-03-03T02:00:00.000Z"); // 21:00 on 2 March in New York
      expect((await issued(w, draft.id)).issueDate).toBe("2026-03-02");
    });

    it("keeps an issue date chosen on the draft", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const saved = await saveInvoice(w, draft, { issueDate: "2026-02-27", dueDate: "2026-03-13" });
      const invoice = await issued(w, saved.id);
      expect(invoice.issueDate).toBe("2026-02-27");
      expect(invoice.dueDate).toBe("2026-03-13");
    });

    it("refuses a draft whose due date is before the day it would be issued, leaving it a draft", async () => {
      const { invoice: draft } = await draftInvoice(w);
      // Saved while the issue date was still open; a week later the due date has gone by.
      const saved = await saveInvoice(w, draft, { dueDate: "2026-03-05" });
      await moveClockTo("2026-03-09T15:00:00.000Z");

      const error = expectApiError(await issueRequest(w, saved.id), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(error.fieldErrors).toEqual({
        dueDate: "The due date can't be before the issue date.",
      });
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: saved.id } });
      expect(row.status).toBe("DRAFT");
      expect(row.invoiceNumber).toBeNull();
    });
  });

  describe("what issuing writes", () => {
    it("records the event, notifies only the customer and emails them after the commit", async () => {
      const { invoice: draft, job } = await draftInvoice(w);
      const before = await invoiceFootprint(w);

      const invoice = await issued(w, draft.id);
      const after = await invoiceFootprint(w);

      const events = await prisma.activityEvent.findMany({
        where: { entityType: "INVOICE", entityId: invoice.id, action: "invoice.issued" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatus: "DRAFT",
        toStatus: "ISSUED",
        actorUserId: w.admin.id,
        customerId: job.customerId,
        requestId: job.requestId,
        publicSummary: "We issued invoice INV-2026-00001.",
      });
      expect(events[0]?.summary).toBe("Morgan Reyes issued invoice INV-2026-00001 to Alex Morgan.");
      expect(events[0]?.metadata).toMatchObject({
        invoiceReference: "INV-2026-00001",
        totalAmount: draft.totalAmount,
        currencyCode: "USD",
        issueDate: "2026-03-02",
        dueDate: draft.dueDate,
      });

      const notifications = await prisma.notification.findMany();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        recipientUserId: w.alex.user.id,
        type: "INVOICE_ISSUED",
        linkPath: `/portal/invoices/${invoice.id}`,
        entityType: "INVOICE",
        entityId: invoice.id,
      });
      expect(notifications[0]?.title).toBe("Invoice INV-2026-00001 is ready");
      expect(after.notifications - before.notifications).toBe(1);

      expect(after.emails - before.emails).toBe(1);
      const mail = w.emails.last;
      expect(mail?.to).toBe(ALEX_EMAIL);
      expect(mail?.subject).toContain("INV-2026-00001");
      expect(mail?.text).toContain("INV-2026-00001");
      expect(mail?.text).toContain("$");
      expect(mail?.text).toContain(`http://localhost:3000/portal/invoices/${invoice.id}`);
      const log = await prisma.emailDeliveryLog.findFirstOrThrow({
        where: { template: "invoice-issued" },
      });
      expect(log.notificationId).toBe(notifications[0]?.id);
    });

    it("shows the customer's timeline sentence and the admin's, from the same event", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const invoice = await issued(w, draft.id);
      expect(invoice.timeline.map((event) => event.summary)).toEqual([
        "Morgan Reyes created a draft invoice for job " + invoice.job.reference + ".",
        "Morgan Reyes issued invoice INV-2026-00001 to Alex Morgan.",
      ]);
    });

    it("does not roll back the issue when the email cannot be sent", async () => {
      const { invoice: draft } = await draftInvoice(w);
      w.emails.failWith = new Error("SMTP is down");

      const response = await issueRequest(w, draft.id);
      await w.deps.emailDispatcher.idle();

      expect(response.status).toBe(200);
      expect(dataOf<AdminInvoiceDto>(response).status).toBe(InvoiceStatus.ISSUED);
      const log = await prisma.emailDeliveryLog.findFirstOrThrow({
        where: { template: "invoice-issued" },
      });
      expect(log.status).toBe("FAILED");
    });
  });

  describe("snapshots (DM-04, FR-102)", () => {
    it("freezes the business, customer, payment instructions and footer at the moment of issue", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const settings = await prisma.businessSettings.findFirstOrThrow();

      const invoice = await issued(w, draft.id);

      expect(invoice.business.name).toBe(settings.businessName);
      expect(invoice.business.email).toBe(settings.contactEmail);
      expect(invoice.business.phone).toBe(settings.phone);
      expect(invoice.business.address.line1).toBe(settings.addressLine1);
      expect(invoice.customer.name).toBe("Alex Morgan");
      expect(invoice.customer.email).toBe(ALEX_EMAIL);
      expect(invoice.customer.address.line1).not.toBe("");
      expect(invoice.paymentInstructions).toBe(settings.paymentInstructions);
      expect(invoice.footer).toBe(settings.invoiceFooter);

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.paymentInstructionsSnapshot).toBe(settings.paymentInstructions);
      expect(row.footerSnapshot).toBe(settings.invoiceFooter);
      expect(row.businessSnapshot).not.toBeNull();
      expect(row.customerSnapshot).not.toBeNull();
    });

    it("never carries the service address's access notes", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await prisma.workOrder.updateMany({
        data: { accessNotesSnapshot: "Gate code 4417, beware the dog" },
      });
      const invoice = await issued(w, draft.id);
      expect(JSON.stringify(invoice)).not.toContain("4417");
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(JSON.stringify(row)).not.toContain("4417");
    });

    it("does not change when the settings, the customer or the service price change afterwards", async () => {
      const { invoice: draft, job } = await draftInvoice(w);
      const invoice = await issued(w, draft.id);

      // Everything the invoice shows is changed at the source.
      await prisma.businessSettings.updateMany({
        data: {
          businessName: "Renamed Cooling Co.",
          tagline: "New tagline",
          contactEmail: "new@renamed.test",
          phone: "(212) 555-0199",
          addressLine1: "99 Another Street",
          city: "Newark",
          postalCode: "07101",
          paymentInstructions: "Pay by courier pigeon.",
          invoiceFooter: "A completely different footer.",
          defaultTaxRate: "20.00",
          currencyCode: "EUR",
        },
      });
      await prisma.user.update({
        where: { id: w.alex.user.id },
        data: { name: "Alexandra Renamed", email: "renamed@example.test" },
      });
      await prisma.workOrder.update({
        where: { id: job.id },
        data: { addressLine1: "1 Moved Away Road", addressCity: "Elsewhere" },
      });
      await prisma.service.update({
        where: { id: w.service.id },
        data: { name: "Renamed Service", pricingMode: "FIXED", startingPrice: "9999.00" },
      });

      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));

      expect(read.business).toEqual(invoice.business);
      expect(read.business.name).not.toBe("Renamed Cooling Co.");
      expect(read.customer).toEqual(invoice.customer);
      expect(read.customer.name).toBe("Alex Morgan");
      expect(read.customer.address.line1).not.toBe("1 Moved Away Road");
      expect(read.paymentInstructions).toBe(invoice.paymentInstructions);
      expect(read.paymentInstructions).not.toContain("pigeon");
      expect(read.footer).toBe(invoice.footer);
      expect(read.currencyCode).toBe("USD");
      expect(read.taxRate).toBe(invoice.taxRate);
      expect(read.lines).toEqual(invoice.lines);
      expect(read.subtotal).toBe(invoice.subtotal);
      expect(read.discountAmount).toBe(invoice.discountAmount);
      expect(read.taxAmount).toBe(invoice.taxAmount);
      expect(read.totalAmount).toBe(invoice.totalAmount);
      expect(read.invoiceNumber).toBe(invoice.invoiceNumber);
      expect(read.issueDate).toBe(invoice.issueDate);
      expect(read.dueDate).toBe(invoice.dueDate);
    });

    it("a draft still shows the current details, as a preview", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await prisma.businessSettings.updateMany({
        data: {
          businessName: "Renamed Cooling Co.",
          paymentInstructions: "Pay by courier pigeon.",
        },
      });
      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, draft.id));
      expect(read.isSnapshot).toBe(false);
      expect(read.business.name).toBe("Renamed Cooling Co.");
      expect(read.paymentInstructions).toBe("Pay by courier pigeon.");
    });

    it("keeps the empty payment instructions and footer as empty, not as the new settings", async () => {
      await prisma.businessSettings.updateMany({
        data: { paymentInstructions: null, invoiceFooter: null },
      });
      const { invoice: draft } = await draftInvoice(w);
      const invoice = await issued(w, draft.id);
      await prisma.businessSettings.updateMany({
        data: { paymentInstructions: "Added later.", invoiceFooter: "Added later too." },
      });
      const read = dataOf<AdminInvoiceDto>(await getInvoiceRequest(w, invoice.id));
      expect(read.paymentInstructions).toBeNull();
      expect(read.footer).toBeNull();
    });
  });

  describe("what stops an issue", () => {
    it("refuses a draft with a total of zero (422) and leaves it a draft with no number taken", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const free = await saveInvoice(w, draft, {
        lines: [{ description: "Goodwill visit", quantity: "1", unitPrice: "0.00", taxable: true }],
        discountAmount: "0.00",
      });
      const before = await invoiceFootprint(w);

      const error = expectApiError(await issueRequest(w, free.id), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(error.fieldErrors?.totalAmount).toBe(
        "The total must be more than zero before the invoice can be issued.",
      );
      expect(await invoiceFootprint(w)).toEqual(before);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: free.id } })).status).toBe(
        "DRAFT",
      );
    });

    it("a refused issue does not use up a number: the next issue is still 00001", async () => {
      const { invoice: first } = await draftInvoice(w);
      const free = await saveInvoice(w, first, {
        lines: [{ description: "Goodwill visit", quantity: "1", unitPrice: "0.00", taxable: true }],
        discountAmount: "0.00",
      });
      expect((await issueRequest(w, free.id)).status).toBe(422);

      const { invoice: second } = await draftInvoice(w, "priya");
      expect((await issued(w, second.id)).invoiceNumber).toBe("INV-2026-00001");
    });

    it("a failure after the number was taken rolls the number back with everything else", async () => {
      const { invoice: draft } = await draftInvoice(w);
      // Make the notification insert, which comes after the number was taken, fail: a check that
      // refuses every new row (NOT VALID leaves the existing rows alone). The whole transaction must roll back.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "notifications" ADD CONSTRAINT "t20_reject_all_chk" CHECK (false) NOT VALID',
      );
      try {
        const response = await issueRequest(w, draft.id);
        expect(response.status).toBe(500);
      } finally {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "notifications" DROP CONSTRAINT "t20_reject_all_chk"',
        );
      }

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
      expect(row.status).toBe("DRAFT");
      expect(row.invoiceNumber).toBeNull();
      expect(row.businessSnapshot).toBeNull();
      expect(await prisma.activityEvent.count({ where: { action: "invoice.issued" } })).toBe(0);
      expect(await prisma.referenceCounter.count({ where: { type: "INVOICE" } })).toBe(0);

      // The number was given back: the retry gets 00001, so there is no gap.
      expect((await issued(w, draft.id)).invoiceNumber).toBe("INV-2026-00001");
    });

    it("a second issue of an issued invoice is 409 STALE_STATE and changes nothing", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await issued(w, draft.id);
      const before = await invoiceFootprint(w);

      const error = expectApiError(await issueRequest(w, draft.id), {
        status: 409,
        code: ErrorCode.STALE_STATE,
      });

      expect(error.details).toEqual({ currentStatus: "ISSUED" });
      expect(await invoiceFootprint(w)).toEqual(before);
    });

    it("issuing a voided invoice is 409 STALE_STATE", async () => {
      const { invoice: draft } = await draftInvoice(w);
      await w.client
        .post(`${ADMIN_INVOICES}/${draft.id}/void`, { cookie: w.adminCookie })
        .send({ reason: "Raised on the wrong job.", expectedStatus: "DRAFT" });
      expectApiError(await issueRequest(w, draft.id), { status: 409, code: ErrorCode.STALE_STATE });
    });

    it("expectedStatus must be DRAFT, and nothing else may be sent", async () => {
      const { invoice: draft } = await draftInvoice(w);
      for (const body of [
        {},
        { expectedStatus: "ISSUED" },
        { expectedStatus: "DRAFT", invoiceNumber: "INV-1" },
      ]) {
        const response = await w.client
          .post(`${ADMIN_INVOICES}/${draft.id}/issue`, { cookie: w.adminCookie })
          .send(body);
        expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      }
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        "DRAFT",
      );
    });
  });

  describe("duplicate safety", () => {
    it("two issues at the same moment take one number: one succeeds, the other is 409", async () => {
      const { invoice: draft } = await draftInvoice(w);

      const responses = await Promise.all([issueRequest(w, draft.id), issueRequest(w, draft.id)]);
      await w.deps.emailDispatcher.idle();

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expectApiError(
        responses.find((response) => response.status === 409)!,
        {
          status: 409,
          code: ErrorCode.STALE_STATE,
        },
      );
      expect(await prisma.invoice.count({ where: { status: "ISSUED" } })).toBe(1);
      const counter = await prisma.referenceCounter.findFirstOrThrow({
        where: { type: "INVOICE" },
      });
      expect(counter.value).toBe(1);
      expect(await prisma.activityEvent.count({ where: { action: "invoice.issued" } })).toBe(1);
      expect(await prisma.notification.count({ where: { type: "INVOICE_ISSUED" } })).toBe(1);
      expect(w.emails.sent.filter((mail) => mail.subject.includes("INV-"))).toHaveLength(1);
    });

    it("issues of different invoices at the same moment take different numbers", async () => {
      const first = await draftInvoice(w, "alex");
      const second = await draftInvoice(w, "priya");
      const third = await draftInvoice(w, "alex");

      const responses = await Promise.all(
        [first, second, third].map(({ invoice }) => issueRequest(w, invoice.id)),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      const numbers = responses
        .map((response) => dataOf<AdminInvoiceDto>(response).invoiceNumber)
        .sort();
      expect(numbers).toEqual(["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"]);
    });

    it("an issue racing a save writes either the saved draft or refuses the save, never a mixture", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const body = {
        lines: [
          { description: "Replaced line", quantity: "2", unitPrice: "10.00", taxable: false },
        ],
        discountAmount: "0.00",
        taxRate: "0.00",
        issueDate: null,
        dueDate: draft.dueDate,
        customerNote: null,
        expectedUpdatedAt: draft.updatedAt,
      };

      const [save, issue] = await Promise.all([
        w.client.patch(`${ADMIN_INVOICES}/${draft.id}`, { cookie: w.adminCookie }).send(body),
        issueRequest(w, draft.id),
      ]);

      expect(issue.status).toBe(200);
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
        include: { lineItems: true },
      });
      expect(row.status).toBe("ISSUED");
      // The issued invoice's lines always add up to its stored total.
      const subtotal = row.lineItems.reduce((sum, line) => sum + Number(line.lineSubtotal), 0);
      expect(Number(row.subtotal)).toBeCloseTo(subtotal, 2);
      if (save.status === 200) {
        expect(row.lineItems.map((line) => line.description)).toEqual(["Replaced line"]);
      } else {
        expectApiError(save, { status: 409, code: ErrorCode.INVOICE_NOT_EDITABLE });
        expect(row.lineItems).toHaveLength(3);
      }
    });
  });

  describe("access", () => {
    it("is 401 without a session and 403 for a customer, changing nothing", async () => {
      const { invoice: draft } = await draftInvoice(w);
      const before = await invoiceFootprint(w);
      const visitor = await w.client
        .post(`${ADMIN_INVOICES}/${draft.id}/issue`)
        .send({ expectedStatus: "DRAFT" });
      expectApiError(visitor, { status: 401, code: ErrorCode.UNAUTHENTICATED });
      for (const cookie of [w.alexCookie, w.priyaCookie]) {
        expectApiError(await issueRequest(w, draft.id, cookie), {
          status: 403,
          code: ErrorCode.FORBIDDEN,
        });
      }
      expect(await invoiceFootprint(w)).toEqual(before);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        "DRAFT",
      );
    });

    it("is 404 for an invoice that does not exist", async () => {
      expectApiError(await issueRequest(w, MISSING_ID), { status: 404, code: ErrorCode.NOT_FOUND });
    });

    it("an invoice for a job that was started from another job's draft is independent", async () => {
      const { job } = await completedJob(w);
      const draft = await startInvoice(w, job.id);
      const other = await draftInvoice(w, "priya");
      await issued(w, other.invoice.id);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
        "DRAFT",
      );
    });
  });
});
