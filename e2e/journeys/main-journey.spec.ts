import {
  addDaysToDateOnly,
  balanceDue,
  calculateDocumentTotals,
  preferredDateRange,
} from "@fixflow/shared";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import { printedText } from "../../apps/server/src/test/pdf-text.js";
import { withDatabase } from "../fixtures/accounts.js";
import { invoiceById, paymentsOfInvoice } from "../fixtures/invoices.js";
import { ownTechnician, uniqueFutureDay, workOrderById } from "../fixtures/jobs.js";
import { quotationsOf } from "../fixtures/quotations.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
import { demoAccount, loginAs } from "../support/auth.js";
import {
  card,
  conflictCheck,
  dialogReady,
  fillSchedule,
  JOB_PATH,
  jobBadge,
} from "../tests/helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "../tests/helpers/layout.js";
import { downloadPdf } from "../tests/helpers/portal-invoices.js";
import {
  acceptThroughDialog,
  decisionBar,
  openAwaitingQuotation,
} from "../tests/helpers/portal-quotations.js";
import {
  banner,
  button,
  expectEditor,
  fillWorkedExample,
  LINES,
  saveDraft,
  sendThroughDialog,
  toast,
} from "../tests/helpers/quotations.js";

/**
 * The complete primary journey of spec §18.3 (T25, TS-E2E-01, WF-7.1 to WF-7.7, SC-03, SC-06), on the
 * demo accounts, through the real screens only: no row is planted, every step is a person's click,
 * and each step's outcome is checked on screen and in the database it wrote to.
 *
 *  1. the demo customer signs in            6. the admin creates the job and schedules it
 *  2. and asks for an AC repair             7. starts it, then completes it
 *  3. the demo admin signs in, finds it     8. creates the invoice and issues it
 *  4. starts the review, sends a quotation  9. records a part payment, then the rest
 *  5. the customer accepts it              10. the customer sees the job, the invoice, the payments
 *                                              and downloads the PDF
 *
 * It runs on Chromium, Firefox and WebKit (see playwright.config.ts). The demo customer is shared with
 * other specs and with the other engines' runs of this one, so everything is found by the references
 * this run creates, never by "the latest" or a count. The technician is made for the run (a seeded
 * technician's diary is shared, T17), and removed afterwards.
 */

test.describe.configure({ timeout: 360_000 });

const DESCRIPTION =
  "The upstairs air conditioner runs but blows warm air, and the outdoor unit hums without the fan turning.";
const COMPLETION_SUMMARY =
  "Replaced the failed run capacitor on the outdoor unit and checked the refrigerant pressure. The system now cools normally.";
const BUSINESS_TIME_ZONE = "America/New_York";
const REQUEST_REFERENCE = /^FF-\d{4}-\d{5}$/;
const QUOTATION_REFERENCE = /^QT-\d{4}-\d{5}$/;
const INVOICE_NUMBER = /^INV-\d{4}-\d{5}$/;
const FIRST_PAYMENT = "100.00";

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

/** A browser context of its own for each person, so the two sessions never mix. */
async function personFor(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}

const paymentsPanel = (page: Page): Locator =>
  page.getByTestId("invoice-payments").filter({ visible: true });
const figure = (page: Page, label: string): Locator =>
  paymentsPanel(page)
    .getByTestId("payment-summary")
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::dd[1]");

test("a customer's AC repair, from the request to the paid invoice, through every screen", async ({
  browser,
}) => {
  const tag = newTechnicianTag();
  tags.push(tag);
  const technician = await ownTechnician(tag);
  const visitDay = uniqueFutureDay();
  const alex = demoAccount("customer");

  const customerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const customer = await personFor(customerContext);
  const admin = await personFor(adminContext);

  // ---- 1. The demo customer signs in through the sign-in form --------------------------------------
  expect(await loginAs(customer, "customer")).toBe("/portal");

  // ---- 2. They ask for an AC repair -----------------------------------------------------------------
  await customer.goto("/request-service");
  await expect(customer.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const form = customer.getByRole("form", { name: "Request a service" });
  await expectHydrated(form);
  await expectHydrated(customer.getByLabel(/^Preferred date/));
  const { min } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
  const preferredDate = addDaysToDateOnly(min, 3);
  await form.getByRole("radio", { name: /AC Diagnostic Visit/ }).click();
  await form.getByLabel(/^What needs fixing/).fill(DESCRIPTION);
  await form.getByLabel(/^Preferred date/).fill(preferredDate);
  await form.getByRole("radio", { name: /Morning/ }).click();
  await form.getByRole("button", { name: "Send request" }).click();

  await customer.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}\?submitted=1$/, {
    timeout: NAVIGATION_TIMEOUT,
  });
  const sent = customer.getByRole("region", { name: "Your request has been sent" });
  await expect(sent).toBeVisible();
  const requestReference = ((await sent.getByText(REQUEST_REFERENCE).textContent()) ?? "").trim();
  expect(requestReference).toMatch(REQUEST_REFERENCE);
  const requestId = new URL(customer.url()).pathname.split("/").at(-1) ?? "";
  const storedRequest = await withDatabase((prisma) =>
    prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { reference: true, status: true, serviceNameSnapshot: true, description: true },
    }),
  );
  expect(storedRequest).toEqual({
    reference: requestReference,
    status: "SUBMITTED",
    serviceNameSnapshot: "AC Diagnostic Visit",
    description: DESCRIPTION,
  });

  // ---- 3. The demo admin signs in and finds the request in the queue --------------------------------
  expect(await loginAs(admin, "admin")).toBe("/app/dashboard");
  await admin.goto("/app/requests");
  await expect(admin.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(admin.getByRole("search", { name: "Search and filter requests" }));
  // The box itself, not only the form around it: text typed before its handler is attached is never
  // searched for (Firefox, run 4).
  await expectHydrated(admin.getByRole("searchbox", { name: "Search" }));
  await admin.getByRole("searchbox", { name: "Search" }).fill(requestReference);
  await admin.waitForURL((url) => url.searchParams.get("q") === requestReference, {
    timeout: NAVIGATION_TIMEOUT,
  });
  const row = admin
    .getByRole("table", { name: "Service requests" })
    .getByRole("row")
    .filter({ hasText: requestReference });
  await expect(row).toContainText(alex.name);
  await expect(row).toContainText("Submitted");
  await row.getByRole("link", { name: requestReference }).click();
  await expect(admin.getByRole("heading", { level: 1, name: requestReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(admin.getByText(DESCRIPTION)).toBeVisible();

  // ---- 4. Starts the review, then writes and sends a quotation --------------------------------------
  const headerBadge = admin.locator("main header [data-status]").first();
  const startReview = admin.getByRole("button", { name: "Start review" });
  await expectHydrated(startReview);
  await startReview.click();
  await expect(headerBadge).toHaveAttribute("data-status", "UNDER_REVIEW", {
    timeout: NAVIGATION_TIMEOUT,
  });
  const createQuotation = button(admin, "Create quotation");
  await expectHydrated(createQuotation);
  await createQuotation.click();
  await expectEditor(admin);
  await fillWorkedExample(admin);
  const expected = calculateDocumentTotals({
    lines: LINES.map((line) => ({ ...line })),
    discountAmount: "0",
    taxRate: "8.00",
  });
  await saveDraft(admin);
  await sendThroughDialog(admin);
  await expect(banner(admin)).toContainText("Sent");
  const [quotation] = await quotationsOf(requestId);
  expect(quotation?.status).toBe("SENT");
  expect(quotation?.reference).toMatch(QUOTATION_REFERENCE);
  // The server worked the totals out itself, and they are the line items, discount and tax.
  expect(quotation?.totalAmount).toBe(expected.totalAmount);
  await expect(admin.getByTestId("quotation-document").filter({ visible: true })).toContainText(
    `$${expected.totalAmount}`,
  );
  if (quotation === undefined) throw new Error("The quotation was not stored.");

  // ---- 5. The customer accepts it --------------------------------------------------------------------
  await openAwaitingQuotation(customer, quotation);
  await expect(decisionBar(customer)).toBeVisible();
  await expect(customer.getByRole("main")).toContainText(`$${expected.totalAmount}`);
  await acceptThroughDialog(customer, quotation.reference);
  expect((await quotationsOf(requestId))[0]?.status).toBe("ACCEPTED");

  // ---- 6. The admin creates the job and schedules it with a technician -------------------------------
  await admin.goto(`/app/requests/${requestId}`);
  await expect(admin.getByRole("heading", { level: 1, name: requestReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(headerBadge).toHaveAttribute("data-status", "ACCEPTED");
  const createJob = admin.getByRole("button", { name: "Create job", exact: true });
  await expectHydrated(createJob);
  await createJob.click();
  await expect(admin).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const jobId = new URL(admin.url()).pathname.split("/").at(-1) ?? "";
  const job = await workOrderById(jobId);
  expect(job.status).toBe("PENDING_SCHEDULING");
  const schedule = await dialogReady(admin, technician.name);
  await fillSchedule(schedule, { date: visitDay, time: "10:00", technician: technician.name });
  await expect(conflictCheck(schedule)).toContainText(`${technician.name} is free at that time.`);
  await schedule.getByRole("button", { name: "Schedule visit" }).click();
  await expect(toast(admin, `${job.reference} is scheduled`)).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });
  await expect(card(admin, "Appointment")).toContainText(technician.name);

  // ---- 7. Marks it in progress, then completed ------------------------------------------------------
  const startJob = admin.getByRole("button", { name: "Start job", exact: true });
  await expectHydrated(startJob);
  await startJob.click();
  const start = admin.getByRole("alertdialog", { name: `Start ${job.reference}?` });
  // The visit is booked for a later day, and the dialog says so before anything happens.
  await expect(start.getByRole("note")).toContainText("later than now");
  await start.getByRole("button", { name: "Start job" }).click();
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "IN_PROGRESS", { timeout: 20_000 });

  const complete = admin.getByRole("button", { name: "Complete job", exact: true });
  await expectHydrated(complete);
  await complete.click();
  const completion = admin.getByRole("alertdialog", { name: `Complete ${job.reference}?` });
  await completion.getByLabel(/Completion summary for the customer/).fill(COMPLETION_SUMMARY);
  await completion.getByRole("button", { name: "Complete job" }).click();
  await expect(toast(admin, `${job.reference} is complete`)).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "COMPLETED", { timeout: 20_000 });
  const completed = await workOrderById(jobId);
  expect(completed.status).toBe("COMPLETED");
  expect(completed.completionNote).toBe(COMPLETION_SUMMARY);

  // ---- 8. Creates the invoice from the job and issues it --------------------------------------------
  const createInvoice = admin.getByRole("button", { name: `Create invoice for ${job.reference}` });
  await expectHydrated(createInvoice);
  await createInvoice.click();
  await expect(admin.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const invoiceId = new URL(admin.url()).pathname.split("/").at(-1) ?? "";
  // Drafted from the accepted quotation: the same lines and total.
  expect((await invoiceById(invoiceId)).totalAmount.toFixed(2)).toBe(expected.totalAmount);
  const issue = admin.getByRole("button", { name: "Issue invoice…" });
  await expectHydrated(issue);
  await issue.click();
  const confirmIssue = admin.getByRole("alertdialog", {
    name: `Issue the invoice to ${alex.name}?`,
  });
  await confirmIssue.getByRole("button", { name: "Issue invoice" }).click();
  await expect(admin.getByRole("heading", { level: 1, name: INVOICE_NUMBER })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const invoiceNumber = (await admin.getByRole("heading", { level: 1 }).innerText()).trim();
  const issued = await invoiceById(invoiceId);
  expect(issued.status).toBe("ISSUED");
  expect(issued.invoiceNumber).toBe(invoiceNumber);

  // ---- 9. Records a part payment, then the rest -------------------------------------------------------
  const rest = balanceDue(expected.totalAmount, FIRST_PAYMENT);
  for (const [amount, method, status] of [
    [FIRST_PAYMENT, "Bank transfer", "PARTIALLY_PAID"],
    [rest, "Cash", "PAID"],
  ] as const) {
    const record = paymentsPanel(admin).getByRole("button", { name: "Record payment" });
    await expectHydrated(record);
    await record.click();
    const dialog = admin.getByRole("dialog", { name: "Record payment" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Amount received/).fill(amount);
    await dialog.getByLabel(/How it was received/).selectOption({ label: method });
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog).toBeHidden({ timeout: NAVIGATION_TIMEOUT });
    await expect(jobBadge(admin)).toHaveAttribute("data-status", status, {
      timeout: NAVIGATION_TIMEOUT,
    });
  }
  await expect(figure(admin, "Balance due")).toContainText("$0.00");
  const paid = await invoiceById(invoiceId);
  expect(paid.status).toBe("PAID");
  expect(paid.amountPaid.toFixed(2)).toBe(expected.totalAmount);
  expect((await paymentsOfInvoice(invoiceId)).map((payment) => payment.amount.toFixed(2))).toEqual([
    FIRST_PAYMENT,
    rest,
  ]);

  // ---- 10. The customer sees the finished job, the paid invoice and its payments, and the PDF --------
  await customer.goto(`/portal/jobs/${jobId}`);
  await expect(customer.getByRole("heading", { level: 1, name: job.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const jobPage = customer.getByRole("main");
  await expect(jobPage.locator("header [data-status]").first()).toHaveAttribute(
    "data-status",
    "COMPLETED",
  );
  await expect(jobPage).toContainText(COMPLETION_SUMMARY);
  // The technician is a first name only (BR-19): never the full name.
  await expect(jobPage).toContainText("Jordan");
  await expect(jobPage).not.toContainText(technician.name);
  const invoiceLink = jobPage.getByRole("link", { name: new RegExp(invoiceNumber) });
  await expect(invoiceLink).toBeVisible();
  await invoiceLink.click();

  await expect(
    customer.getByRole("heading", { level: 1, name: `Invoice ${invoiceNumber}` }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  const invoicePage = customer.getByRole("main");
  await expect(
    invoicePage.locator("header [data-status]").filter({ visible: true }).first(),
  ).toHaveAttribute("data-status", "PAID");
  await expect(invoicePage).toContainText(`$${FIRST_PAYMENT}`);
  await expect(invoicePage).toContainText(`$${rest}`);
  await expect(invoicePage).toContainText("Bank transfer");
  await expect(invoicePage).toContainText("Cash");

  const file = await downloadPdf(customer);
  expect(file.filename).toBe(`${invoiceNumber}.pdf`);
  expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const printed = await printedText(file.bytes);
  expect(printed).toContain(invoiceNumber);
  expect(printed).toContain(`$${expected.totalAmount}`);
  expect(printed).toContain(alex.name);

  // The request the customer started from shows where it ended: converted into the job.
  await customer.goto(`/portal/requests/${requestId}`);
  await expect(customer.getByRole("heading", { level: 1, name: requestReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(customer.getByRole("main")).toContainText(job.reference);

  await customerContext.close();
  await adminContext.close();
});
