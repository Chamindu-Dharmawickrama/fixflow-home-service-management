import { addDaysToDateOnly, preferredDateRange } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount, withDatabase } from "../fixtures/accounts.js";
import { createInvoiceFor } from "../fixtures/customers.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  invoiceById,
  invoiceEventsOf,
  invoicesOfJob,
  paymentsOfInvoice,
} from "../fixtures/invoices.js";
import {
  businessDay,
  createSentQuotationFor,
  decisionTrailOf,
  quotationDecisionOf,
  quotationLinesOf,
  quotationsOf,
} from "../fixtures/quotations.js";
import { countRequestsOf } from "../fixtures/requests.js";
import { newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { WEB_URL } from "../support/env.js";
import { jobBadge, openJob } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  acceptButton,
  declineButton,
  openAwaitingQuotation,
  openPortalQuotation,
  pageBadge,
} from "./helpers/portal-quotations.js";
import { seriousViolations } from "./helpers/public.js";
import {
  button,
  createDraft,
  customerWithRequest,
  fillWorkedExample,
  line,
  saveDraft,
  toast,
} from "./helpers/quotations.js";

/**
 * The negative journeys of spec §18.3 (T25, TS-E2E-02): another customer's records by URL, an expired
 * quotation, invalid input on the three main forms, double clicks on the four irreversible actions,
 * and a customer on the business's pages. Every test makes its own customers; what was stored is read
 * back to prove that nothing happened (or happened once). The network-failure cases are in
 * `resilience.spec.ts`.
 */

test.describe.configure({ timeout: 180_000 });

const BUSINESS_TIME_ZONE = "America/New_York";

async function expectNotFound(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

test.describe("another customer's records", () => {
  test("customer B sees not-found for customer A's request, quotation, job, invoice and PDF, and the API answers 404", async ({
    page,
  }) => {
    const owner = await createCustomerAccount({ name: "Avery Owner" });
    const records = await createInvoiceFor(owner.id, { status: "ISSUED", total: "212.40" });
    await loginAs(page, "customer-b");

    const pages = [
      [`/portal/requests/${records.requestId}`, "We couldn't find that request"],
      [`/portal/quotations/${records.quotationId}`, "We couldn't find that quotation"],
      [`/portal/jobs/${records.jobId}`, "We couldn't find that job"],
      [`/portal/invoices/${records.invoiceId}`, "We couldn't find that invoice"],
    ] as const;
    for (const [path, heading] of pages) {
      await expectNotFound(page, path, heading);
      const main = await page.getByRole("main").innerText();
      for (const secret of [
        owner.name,
        records.requestReference,
        records.jobReference,
        records.invoiceNumber ?? "never",
      ]) {
        expect(main, `${path} shows nothing of customer A`).not.toContain(secret);
      }
    }

    // The API behind the pages: 404, exactly as for an id that does not exist (no probing).
    const api = [
      `/api/v1/requests/${records.requestId}`,
      `/api/v1/quotations/${records.quotationId}`,
      `/api/v1/work-orders/${records.jobId}`,
      `/api/v1/invoices/${records.invoiceId}`,
      `/api/v1/invoices/${records.invoiceId}/pdf`,
    ];
    for (const path of api) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(404);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    }
    const unknown = await page.request.get("/api/v1/invoices/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    expect(unknown.status()).toBe(404);
    // Accepting A's quotation by guessing its id is refused the same way, and nothing changes.
    const accept = await page.request.post(`/api/v1/quotations/${records.quotationId}/accept`, {
      data: {},
      // A browser sends its Origin with a POST; the API's CSRF check refuses one without it (D-11).
      headers: { Origin: WEB_URL },
    });
    expect(accept.status()).toBe(404);
  });

  test("a customer who opens a business page sees that it is not for them, with no admin navigation", async ({
    page,
  }) => {
    await loginAs(page, "customer");
    for (const path of [
      "/app/dashboard",
      "/app/requests",
      "/app/invoices",
      "/app/settings/business",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("link", { name: "Go to my account" })).toBeVisible();
      // No admin navigation: the customer's own shell.
      await expect(page.getByRole("link", { name: "Technicians" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Calendar" })).toHaveCount(0);
    }
    expect(await seriousViolations(page)).toBe("");
    const response = await page.request.get("/api/v1/admin/requests");
    expect(response.status()).toBe(403);
  });
});

test.describe("an expired quotation", () => {
  test("shows the customer that it ran out, with no way to accept or decline, and the API refuses an answer", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Ezra Expired" });
    const { quotation } = await createSentQuotationFor(customer.id, {
      validUntil: businessDay(-2),
    });
    await loginAs(page, { email: customer.email, password: customer.password });

    await openPortalQuotation(page, quotation);
    await expect(pageBadge(page)).toHaveAttribute("data-status", "EXPIRED");
    await expect(page.getByRole("main")).toContainText(/expired|ran out/i);
    await expect(acceptButton(page)).toHaveCount(0);
    await expect(declineButton(page)).toHaveCount(0);

    const answer = await page.request.post(`/api/v1/quotations/${quotation.id}/accept`, {
      data: {},
      // A browser sends its Origin with a POST; the API's CSRF check refuses one without it (D-11).
      headers: { Origin: WEB_URL },
    });
    expect(answer.status()).toBe(409);
    expect((await quotationDecisionOf(quotation.id)).respondedAt).toBeNull();
    expect(await seriousViolations(page)).toBe("");
  });
});

test.describe("form validation", () => {
  test("the request form says what is missing beside each field and creates nothing", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Vera Validation" });
    await loginAs(page, { email: customer.email, password: customer.password });
    await page.goto("/request-service");
    const form = page.getByRole("form", { name: "Request a service" });
    await expectHydrated(form);
    await expectHydrated(page.getByLabel(/^Preferred date/));

    await form.getByRole("button", { name: "Send request" }).click();
    const summary = page.getByRole("alert").filter({ hasText: "problems to fix" });
    await expect(summary).toBeFocused();
    await expect(form.getByLabel(/^What needs fixing/)).toHaveAttribute("aria-invalid", "true");

    // A date outside the allowed range is refused beside the date, and what was typed stays.
    const { max } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
    await form.getByLabel(/^What needs fixing/).fill("Tiny");
    await form.getByLabel(/^Preferred date/).fill(addDaysToDateOnly(max, 30));
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(form.getByLabel(/^What needs fixing/)).toHaveAccessibleDescription(
      /at least 20 characters/,
    );
    await expect(form.getByLabel(/^Preferred date/)).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByLabel(/^What needs fixing/)).toHaveValue("Tiny");
    expect(await countRequestsOf(customer.id)).toBe(0);
  });

  test("the quotation editor keeps a line's errors beside it and saves nothing invalid", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest("Lena Lines");
    await loginAs(page, "admin");
    await createDraft(page, request);
    const [draft] = await quotationsOf(request.id);
    const linesBefore = await quotationLinesOf(draft?.id ?? "");

    const first = line(page, 1);
    await first.getByLabel("Description").fill("");
    await first.getByLabel("Quantity").fill("-2");
    await first.getByLabel(/^Unit price/).fill("abc");
    await button(page, "Save draft").click();

    await expect(first.getByLabel("Description")).toHaveAttribute("aria-invalid", "true");
    await expect(first.getByLabel("Quantity")).toHaveAttribute("aria-invalid", "true");
    await expect(first.getByLabel(/^Unit price/)).toHaveAttribute("aria-invalid", "true");
    await expect(toast(page, "Draft saved")).toHaveCount(0);
    // What was typed is still there to correct.
    await expect(first.getByLabel("Quantity")).toHaveValue("-2");
    const [stored] = await quotationsOf(request.id);
    expect(stored?.status).toBe("DRAFT");
    // The stored lines are the ones the draft started with: nothing invalid was saved.
    expect(await quotationLinesOf(stored?.id ?? "")).toEqual(linesBefore);
    await expect(button(page, "Send to customer…")).toBeVisible();
  });

  test("the payment dialog refuses a zero, a negative and a too-large amount beside the field, and records nothing", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: `Pax Payment ${newTechnicianTag()}` });
    const job = await createCompletedJobWithQuote(customer.id);
    const invoice = await insertInvoiceFor(job, customer.id, {
      status: "ISSUED",
      issueDate: "2026-11-02",
      dueDate: "2999-01-01",
    });
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: invoice.invoiceNumber ?? "" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    const record = page
      .getByTestId("invoice-payments")
      .filter({ visible: true })
      .getByRole("button", { name: "Record payment" });
    await expectHydrated(record);
    await record.click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByLabel(/How it was received/).selectOption({ label: "Cash" });
    const amount = dialog.getByLabel(/Amount received/);

    for (const value of ["0", "-5", "9999999"]) {
      await amount.fill(value);
      await dialog.getByRole("button", { name: "Record payment" }).click();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(dialog).toBeVisible();
      await expect(amount).toHaveValue(value);
    }
    expect(await paymentsOfInvoice(invoice.id)).toHaveLength(0);
    expect((await invoiceById(invoice.id)).status).toBe("ISSUED");
    expect(await seriousViolations(page, "[role=dialog]")).toBe("");
  });
});

test.describe("double clicks on the irreversible actions", () => {
  test("sending a quotation twice sends it once", async ({ page }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest("Dora Double");
    await loginAs(page, "admin");
    await createDraft(page, request);
    await fillWorkedExample(page);
    await saveDraft(page);
    await button(page, "Send to customer…").click();
    const dialog = page.getByRole("alertdialog", { name: /^Send QT-/ });
    await dialog.getByRole("button", { name: "Send to customer", exact: true }).dblclick();
    await expect(page.getByRole("form", { name: "Quotation draft" })).toHaveCount(0, {
      timeout: NAVIGATION_TIMEOUT,
    });

    const quotations = await quotationsOf(request.id);
    expect(quotations.map((quotation) => quotation.status)).toEqual(["SENT"]);
    const sent = await withDatabase((prisma) =>
      prisma.activityEvent.count({
        where: { entityId: quotations[0]?.id ?? "", action: "quotation.sent" },
      }),
    );
    expect(sent).toBe(1);
    const notices = await withDatabase((prisma) =>
      prisma.notification.count({
        where: { recipientUserId: customer.id, type: "QUOTATION_SENT" },
      }),
    );
    expect(notices).toBe(1);
  });

  test("accepting a quotation twice accepts it once", async ({ page }) => {
    const customer = await createCustomerAccount({ name: "Abel Accept" });
    const { quotation } = await createSentQuotationFor(customer.id, { validUntil: businessDay(7) });
    await loginAs(page, { email: customer.email, password: customer.password });
    await openAwaitingQuotation(page, quotation);
    await acceptButton(page).click();
    const dialog = page.getByRole("alertdialog", { name: `Accept ${quotation.reference}?` });
    await dialog.getByRole("button", { name: "Accept quotation", exact: true }).dblclick();
    await expect(page.getByTestId("quotation-confirmation").filter({ visible: true })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    expect((await quotationDecisionOf(quotation.id)).status).toBe("ACCEPTED");
    const trail = await decisionTrailOf(quotation.id);
    expect(trail.events.map((event) => event.action)).toEqual(["quotation.accepted"]);
  });

  test("issuing an invoice twice issues it once, with one number", async ({ page }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: `Ida Issue ${newTechnicianTag()}` });
    const job = await createCompletedJobWithQuote(customer.id);
    await loginAs(page, "admin");
    await openJob(page, job, { expectButton: `Create invoice for ${job.jobReference}` });
    await page.getByRole("button", { name: `Create invoice for ${job.jobReference}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    const issue = page.getByRole("button", { name: "Issue invoice…" });
    await expectHydrated(issue);
    await issue.click();
    const confirm = page.getByRole("alertdialog", {
      name: `Issue the invoice to ${customer.name}?`,
    });
    await confirm.getByRole("button", { name: "Issue invoice" }).dblclick();
    await expect(page.getByRole("heading", { level: 1, name: /^INV-\d{4}-\d{5}$/ })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    const invoices = await invoicesOfJob(job.jobId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe("ISSUED");
    const events = await invoiceEventsOf(invoices[0]?.id ?? "");
    expect(events.filter((event) => event.action === "invoice.issued")).toHaveLength(1);
  });

  test("recording a payment twice records it once", async ({ page }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: `Dax Deposit ${newTechnicianTag()}` });
    const job = await createCompletedJobWithQuote(customer.id);
    const invoice = await insertInvoiceFor(job, customer.id, {
      status: "ISSUED",
      issueDate: "2026-11-02",
      dueDate: "2999-01-01",
    });
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: invoice.invoiceNumber ?? "" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    const record = page
      .getByTestId("invoice-payments")
      .filter({ visible: true })
      .getByRole("button", { name: "Record payment" });
    await expectHydrated(record);
    await record.click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByLabel(/Amount received/).fill("50.00");
    await dialog.getByLabel(/How it was received/).selectOption({ label: "Cash" });
    await dialog.getByRole("button", { name: "Record payment" }).dblclick();
    await expect(dialog).toBeHidden({ timeout: NAVIGATION_TIMEOUT });
    await expect(jobBadge(page)).toHaveAttribute("data-status", "PARTIALLY_PAID", {
      timeout: NAVIGATION_TIMEOUT,
    });

    const payments = await paymentsOfInvoice(invoice.id);
    expect(payments.map((payment) => payment.amount.toFixed(2))).toEqual(["50.00"]);
    expect((await invoiceById(invoice.id)).amountPaid.toFixed(2)).toBe("50.00");
  });
});
