import { randomInt } from "node:crypto";

import {
  addDaysToDateOnly,
  balanceDue,
  calculateDocumentTotals,
  preferredDateRange,
} from "@fixflow/shared";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import { printedText } from "../../apps/server/src/test/pdf-text.js";
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
  referenceOnPage,
  saveDraft,
  sendThroughDialog,
  toast,
} from "../tests/helpers/quotations.js";

/**
 * The primary journey of spec §18.3 for a **hosted** site (T26, acceptance criterion 2), run with
 * `BASE_URL=https://<web> npx playwright test --grep @hosted-journey` (docs/DEPLOYMENT.md §11).
 *
 * It is the T25 main journey (`main-journey.spec.ts`) with one difference: it never touches a database.
 * A hosted site has none that a test may read, so every step's outcome is checked on the screens a person
 * sees (the status badges, the references, the totals, the PDF), and the only things it needs from the
 * deployment are the seeded demo accounts and the seeded technician Jordan Lee. It leaves one finished
 * request, quotation, job, invoice and two payments behind: reset the demo afterwards (`db:reset-demo`).
 *
 * It also runs in the local Chromium suite, so the hosted path stays covered. The demo customer is shared
 * with other specs, so everything is found by the references this run creates.
 */
test.describe.configure({ timeout: 360_000 });

const HOSTED_TAG = "@hosted-journey";
const TECHNICIAN = "Jordan Lee";
const DESCRIPTION =
  "The upstairs air conditioner runs but blows warm air, and the outdoor unit hums without the fan turning.";
const COMPLETION_SUMMARY =
  "Replaced the failed run capacitor on the outdoor unit and checked the refrigerant pressure. The system now cools normally.";
const BUSINESS_TIME_ZONE = "America/New_York";
const REQUEST_REFERENCE = /^FF-\d{4}-\d{5}$/;
const INVOICE_NUMBER = /^INV-\d{4}-\d{5}$/;
const FIRST_PAYMENT = "100.00";

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

/** The last path segment of the page's address (its query string is not part of it): the record's id. */
const idInUrl = (page: Page): string => new URL(page.url()).pathname.split("/").at(-1) ?? "";

test(
  "a customer's AC repair, from the request to the paid invoice, with nothing but the screens",
  { tag: HOSTED_TAG },
  async ({ browser }) => {
    // 100 to 800 days ahead, so the shared technician's diary is clear on that day.
    const visitDay = addDaysToDateOnly(
      preferredDateRange(new Date(), BUSINESS_TIME_ZONE).min,
      randomInt(100, 800),
    );
    const alex = demoAccount("customer");

    const customerContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const customer = await personFor(customerContext);
    const admin = await personFor(adminContext);

    // ---- 1. The demo customer signs in through the sign-in form ------------------------------------
    expect(await loginAs(customer, "customer")).toBe("/portal");

    // ---- 2. They ask for an AC repair ---------------------------------------------------------------
    await customer.goto("/request-service");
    await expect(
      customer.getByRole("heading", { level: 1, name: "Request a service" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    const form = customer.getByRole("form", { name: "Request a service" });
    await expectHydrated(form);
    await expectHydrated(customer.getByLabel(/^Preferred date/));
    const { min } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
    await form.getByRole("radio", { name: /AC Diagnostic Visit/ }).click();
    await form.getByLabel(/^What needs fixing/).fill(DESCRIPTION);
    await form.getByLabel(/^Preferred date/).fill(addDaysToDateOnly(min, 3));
    await form.getByRole("radio", { name: /Morning/ }).click();
    await form.getByRole("button", { name: "Send request" }).click();

    await customer.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}\?submitted=1$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    const sent = customer.getByRole("region", { name: "Your request has been sent" });
    await expect(sent).toBeVisible();
    const requestReference = ((await sent.getByText(REQUEST_REFERENCE).textContent()) ?? "").trim();
    expect(requestReference).toMatch(REQUEST_REFERENCE);
    const requestId = idInUrl(customer);
    // What the customer's own page now says about the request.
    await expect(customer.getByRole("main")).toContainText("AC Diagnostic Visit");
    await expect(customer.getByRole("main")).toContainText(DESCRIPTION);
    await expect(customer.locator("main header [data-status]").first()).toHaveAttribute(
      "data-status",
      "SUBMITTED",
    );

    // ---- 3. The demo admin signs in and finds the request in the queue ------------------------------
    expect(await loginAs(admin, "admin")).toBe("/app/dashboard");
    await admin.goto("/app/requests");
    await expect(admin.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(admin.getByRole("search", { name: "Search and filter requests" }));
    // The box itself, not only the form around it: text typed before its handler is attached is never
    // searched for.
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

    // ---- 4. Starts the review, then writes and sends a quotation ------------------------------------
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
    const quotation = { id: idInUrl(admin), reference: await referenceOnPage(admin) };
    await fillWorkedExample(admin);
    // The worked example at 8 per cent tax (the editor sets the rate itself): the server works the totals
    // out, and they must be what the shared calculation says.
    const expected = calculateDocumentTotals({
      lines: LINES.map((line) => ({ ...line })),
      discountAmount: "0",
      taxRate: "8.00",
    });
    await saveDraft(admin);
    await sendThroughDialog(admin);
    await expect(banner(admin)).toContainText("Sent");
    await expect(admin.getByTestId("quotation-document").filter({ visible: true })).toContainText(
      `$${expected.totalAmount}`,
    );

    // ---- 5. The customer accepts it ----------------------------------------------------------------
    await openAwaitingQuotation(customer, quotation);
    await expect(decisionBar(customer)).toBeVisible();
    await expect(customer.getByRole("main")).toContainText(`$${expected.totalAmount}`);
    await acceptThroughDialog(customer, quotation.reference);

    // ---- 6. The admin creates the job and schedules it with the technician -------------------------
    await admin.goto(`/app/requests/${requestId}`);
    await expect(admin.getByRole("heading", { level: 1, name: requestReference })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(headerBadge).toHaveAttribute("data-status", "ACCEPTED");
    const createJob = admin.getByRole("button", { name: "Create job", exact: true });
    await expectHydrated(createJob);
    await createJob.click();
    await expect(admin).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
    const jobId = idInUrl(admin);
    // A new job opens with the scheduling dialog, and while it is open the page behind it is aria-hidden,
    // which a role query cannot see: read the visible heading element itself.
    const jobHeading = admin.locator("h1").filter({ visible: true });
    await expect(jobHeading).toHaveText(/^JOB-\d{4}-\d{5}$/, { timeout: NAVIGATION_TIMEOUT });
    const jobReference = (await jobHeading.innerText()).trim();
    await expect(jobBadge(admin)).toHaveAttribute("data-status", "PENDING_SCHEDULING");
    const schedule = await dialogReady(admin, TECHNICIAN);
    await fillSchedule(schedule, { date: visitDay, time: "10:00", technician: TECHNICIAN });
    await expect(conflictCheck(schedule)).toContainText(`${TECHNICIAN} is free at that time.`);
    await schedule.getByRole("button", { name: "Schedule visit" }).click();
    await expect(toast(admin, `${jobReference} is scheduled`)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(jobBadge(admin)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });
    await expect(card(admin, "Appointment")).toContainText(TECHNICIAN);

    // ---- 7. Marks it in progress, then completed ----------------------------------------------------
    const startJob = admin.getByRole("button", { name: "Start job", exact: true });
    await expectHydrated(startJob);
    await startJob.click();
    const start = admin.getByRole("alertdialog", { name: `Start ${jobReference}?` });
    // The visit is booked for a later day, and the dialog says so before anything happens.
    await expect(start.getByRole("note")).toContainText("later than now");
    await start.getByRole("button", { name: "Start job" }).click();
    await expect(jobBadge(admin)).toHaveAttribute("data-status", "IN_PROGRESS", {
      timeout: 20_000,
    });

    const complete = admin.getByRole("button", { name: "Complete job", exact: true });
    await expectHydrated(complete);
    await complete.click();
    const completion = admin.getByRole("alertdialog", { name: `Complete ${jobReference}?` });
    await completion.getByLabel(/Completion summary for the customer/).fill(COMPLETION_SUMMARY);
    await completion.getByRole("button", { name: "Complete job" }).click();
    await expect(toast(admin, `${jobReference} is complete`)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(jobBadge(admin)).toHaveAttribute("data-status", "COMPLETED", { timeout: 20_000 });

    // ---- 8. Creates the invoice from the job and issues it ----------------------------------------
    const createInvoice = admin.getByRole("button", { name: `Create invoice for ${jobReference}` });
    await expectHydrated(createInvoice);
    await createInvoice.click();
    await expect(admin.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    // Drafted from the accepted quotation: the same total.
    await expect(admin.getByRole("main")).toContainText(`$${expected.totalAmount}`);
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
    await expect(jobBadge(admin)).toHaveAttribute("data-status", "ISSUED");

    // ---- 9. Records a part payment, then the rest ---------------------------------------------------
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

    // ---- 10. The customer sees the finished job, the paid invoice and its payments, and the PDF -----
    await customer.goto(`/portal/jobs/${jobId}`);
    await expect(customer.getByRole("heading", { level: 1, name: jobReference })).toBeVisible({
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
    await expect(jobPage).not.toContainText(TECHNICIAN);
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
    await expect(customer.getByRole("main")).toContainText(jobReference);

    await customerContext.close();
    await adminContext.close();
  },
);
