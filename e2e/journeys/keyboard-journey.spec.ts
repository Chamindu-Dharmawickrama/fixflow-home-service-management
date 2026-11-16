import { addDaysToDateOnly, preferredDateRange } from "@fixflow/shared";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import { invoiceById, paymentsOfInvoice } from "../fixtures/invoices.js";
import { uniqueFutureDay, workOrderById } from "../fixtures/jobs.js";
import { quotationsOf } from "../fixtures/quotations.js";
import {
  deleteTechniciansTagged,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { credentials, DEMO_ADMIN_EMAIL } from "../support/env.js";
import { JOB_PATH, jobBadge } from "../tests/helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "../tests/helpers/layout.js";

/**
 * The main journey with the keyboard alone (T25, UX-08, NFR-03; the walkthrough recorded in
 * `docs/QA_CHECKLIST.md`). Every control is reached with Tab (or Shift+Tab) from where the focus
 * already is, never by clicking or by focusing it from the test, and is used with Enter, Space, arrow
 * keys or typing. `tabTo` fails if a control cannot be reached within a fixed number of presses, which
 * is the defect this test is here to find. Each dialog must take the focus when it opens.
 *
 * Addresses are typed into the address bar, as a keyboard user would. Chromium only: the other
 * engines run the pointer journey (`main-journey.spec.ts`) and the T04 keyboard spec.
 */

test.describe.configure({ timeout: 360_000 });

const BUSINESS_TIME_ZONE = "America/New_York";
const DESCRIPTION =
  "The bedroom wall unit drips water onto the floor whenever it runs for more than an hour.";
const SUMMARY = "Cleared the blocked condensate drain and re-sealed the drip tray. No more leaks.";
const tags: string[] = [];

test.afterEach(async () => {
  for (const tag of tags.splice(0)) await deleteTechniciansTagged(tag);
});

/** Presses Tab until `target` has the focus; fails if it never gets it (it is not reachable). */
async function tabTo(page: Page, target: Locator, options: { max?: number; back?: boolean } = {}) {
  const max = options.max ?? 150;
  await expect(target).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  for (let press = 0; press <= max; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      // The focus can be seen: the design system's ring is drawn for keyboard focus.
      expect(
        await target.evaluate((element) => element.matches(":focus-visible")),
        "the focused control shows a focus ring",
      ).toBe(true);
      return;
    }
    await page.keyboard.press(options.back === true ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Not reachable with the keyboard in ${String(max)} presses: ${String(target)}`);
}

/** Types into the focused field, replacing what was there. */
async function typeOver(page: Page, text: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
}

/** A native date input in Chromium (en-US): month, day and year typed as digits. */
async function typeDate(page: Page, date: string): Promise<void> {
  const [year = "", month = "", day = ""] = date.split("-");
  await page.keyboard.type(`${month}${day}${year}`);
}

/** Moves a focused native `<select>` with the arrow keys until it shows `label`. */
async function arrowToOption(page: Page, select: Locator, label: string): Promise<void> {
  for (let press = 0; press < 40; press += 1) {
    const shown = await select.evaluate(
      (element) => (element as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? "",
    );
    if (shown === label) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`"${label}" was not reached with the arrow keys.`);
}

async function signInWithKeyboard(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  const form = page.getByRole("form", { name: "Sign in" });
  await expectHydrated(form);
  await tabTo(page, page.getByLabel(/^Email address/));
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/^Password/)).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function personFor(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}

test("the whole journey can be done with the keyboard alone", async ({ browser }) => {
  const tag = newTechnicianTag();
  tags.push(tag);
  const technician = await insertTechnician(tag, { name: `Quincy Keys ${tag}` });
  const account = await createCustomerAccount({ name: `Kim Keyboard ${tag}` });
  await createAddressesFor(account.id, [
    {
      label: "Home",
      line1: "48 Juniper Row",
      city: "Harbor City",
      postalCode: "10999",
      isDefault: true,
    },
  ]);
  const customer = await personFor(await browser.newContext());
  const admin = await personFor(await browser.newContext());

  // ---- The customer signs in and asks for a repair ---------------------------------------------------
  await signInWithKeyboard(customer, account.email, account.password);
  await expect(customer).toHaveURL(/\/portal$/);
  await expect(customer.getByRole("heading", { level: 1 })).toBeVisible();
  const requestLink = customer.getByRole("link", { name: "Request a service" }).first();
  await tabTo(customer, requestLink);
  await customer.keyboard.press("Enter");
  await expect(customer.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const form = customer.getByRole("form", { name: "Request a service" });
  await expectHydrated(form);
  await expectHydrated(customer.getByLabel(/^Preferred date/));

  // The services are a radio group: Tab enters it on the first service, Space chooses it.
  const firstService = form.getByRole("radio", { name: /AC Diagnostic Visit/ });
  await tabTo(customer, firstService);
  await customer.keyboard.press("Space");
  await expect(firstService).toBeChecked();
  await tabTo(customer, form.getByLabel(/^What needs fixing/));
  await customer.keyboard.type(DESCRIPTION);
  await tabTo(customer, form.getByLabel(/^Preferred date/));
  const { min } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
  const preferredDate = addDaysToDateOnly(min, 2);
  await typeDate(customer, preferredDate);
  await expect(form.getByLabel(/^Preferred date/)).toHaveValue(preferredDate);
  const morning = form.getByRole("radio", { name: /Morning/ });
  await tabTo(customer, morning);
  await customer.keyboard.press("Space");
  await expect(morning).toBeChecked();
  await tabTo(customer, form.getByRole("button", { name: "Send request" }));
  await customer.keyboard.press("Enter");
  await customer.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}\?submitted=1$/, {
    timeout: NAVIGATION_TIMEOUT,
  });
  const requestId = new URL(customer.url()).pathname.split("/").at(-1) ?? "";
  // The confirmation takes the focus, so a screen reader announces it.
  await expect(customer.getByRole("heading", { name: "Your request has been sent" })).toBeFocused();

  // ---- The admin reviews it and sends a quotation ---------------------------------------------------
  await signInWithKeyboard(admin, DEMO_ADMIN_EMAIL, credentials.demoAdminPassword);
  await admin.goto(`/app/requests/${requestId}`);
  await expect(admin.getByText(DESCRIPTION)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  const startReview = admin.getByRole("button", { name: "Start review" });
  await expectHydrated(startReview);
  await tabTo(admin, startReview);
  await admin.keyboard.press("Enter");
  await expect(admin.locator("main header [data-status]").first()).toHaveAttribute(
    "data-status",
    "UNDER_REVIEW",
    { timeout: NAVIGATION_TIMEOUT },
  );
  const createQuotation = admin.getByRole("button", { name: "Create quotation", exact: true });
  await expectHydrated(createQuotation);
  await tabTo(admin, createQuotation);
  await admin.keyboard.press("Enter");
  const editor = admin.getByRole("form", { name: "Quotation draft" });
  await expect(editor).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(editor);
  await expectHydrated(admin.getByLabel("Note for the customer"));
  const firstLine = admin.getByRole("group", { name: "Line 1" });
  await tabTo(admin, firstLine.getByLabel("Description"));
  await typeOver(admin, "Clear condensate drain and reseal tray");
  await tabTo(admin, firstLine.getByLabel("Quantity"));
  await typeOver(admin, "1");
  await tabTo(admin, firstLine.getByLabel(/^Unit price/));
  await typeOver(admin, "145.00");
  const saveDraft = admin.getByRole("button", { name: "Save draft", exact: true });
  await tabTo(admin, saveDraft);
  await admin.keyboard.press("Enter");
  await expect(admin.getByText("All changes are saved.")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const send = admin.getByRole("button", { name: "Send to customer…" });
  await tabTo(admin, send, { back: true });
  await admin.keyboard.press("Enter");
  const sendDialog = admin.getByRole("alertdialog", { name: /^Send QT-/ });
  await expect(sendDialog).toBeVisible();
  // The dialog has the focus; Tab stays inside it until it closes.
  await expect
    .poll(() => sendDialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await tabTo(admin, sendDialog.getByRole("button", { name: "Send to customer", exact: true }), {
    max: 10,
  });
  await admin.keyboard.press("Enter");
  await expect(admin.getByRole("form", { name: "Quotation draft" })).toHaveCount(0, {
    timeout: NAVIGATION_TIMEOUT,
  });
  const [quotation] = await quotationsOf(requestId);
  expect(quotation?.status).toBe("SENT");

  // ---- The customer accepts it ----------------------------------------------------------------------
  await customer.goto(`/portal/quotations/${quotation?.id ?? ""}`);
  const accept = customer.getByRole("button", { name: "Accept quotation", exact: true });
  await expectHydrated(accept);
  await tabTo(customer, accept);
  await customer.keyboard.press("Enter");
  const acceptDialog = customer.getByRole("alertdialog", { name: /^Accept QT-/ });
  await expect(acceptDialog).toBeVisible();
  await tabTo(
    customer,
    acceptDialog.getByRole("button", { name: "Accept quotation", exact: true }),
    { max: 10 },
  );
  await customer.keyboard.press("Enter");
  await expect(
    customer.getByTestId("quotation-confirmation").filter({ visible: true }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

  // ---- The admin creates the job and books it ---------------------------------------------------------
  await admin.goto(`/app/requests/${requestId}`);
  const createJob = admin.getByRole("button", { name: "Create job", exact: true });
  await expectHydrated(createJob);
  await tabTo(admin, createJob);
  await admin.keyboard.press("Enter");
  await expect(admin).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const jobId = new URL(admin.url()).pathname.split("/").at(-1) ?? "";
  const schedule = admin.getByRole("dialog", { name: /^Schedule/ });
  await expect(schedule).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  const technicianSelect = schedule.getByLabel(/^Technician/);
  await expect(
    technicianSelect.locator("option", { hasText: new RegExp(`^${technician.name}$`) }),
  ).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  await tabTo(admin, schedule.getByLabel(/^Date/), { max: 20 });
  await typeDate(admin, uniqueFutureDay());
  await tabTo(admin, schedule.getByLabel(/^Start time/), { max: 5 });
  await admin.keyboard.type("1000AM");
  await tabTo(admin, technicianSelect, { max: 10 });
  await arrowToOption(admin, technicianSelect, technician.name);
  await expect(schedule.getByTestId("conflict-check")).toContainText("is free at that time", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await tabTo(admin, schedule.getByRole("button", { name: "Schedule visit" }), { max: 20 });
  await admin.keyboard.press("Enter");
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });

  // ---- Starts it and completes it ---------------------------------------------------------------------
  const startJob = admin.getByRole("button", { name: "Start job", exact: true });
  await expectHydrated(startJob);
  await tabTo(admin, startJob, { back: true });
  await admin.keyboard.press("Enter");
  const startDialog = admin.getByRole("alertdialog", { name: /^Start JOB-/ });
  await tabTo(admin, startDialog.getByRole("button", { name: "Start job" }), { max: 10 });
  await admin.keyboard.press("Enter");
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "IN_PROGRESS", { timeout: 20_000 });
  const completeJob = admin.getByRole("button", { name: "Complete job", exact: true });
  await expectHydrated(completeJob);
  await tabTo(admin, completeJob, { back: true });
  await admin.keyboard.press("Enter");
  const completeDialog = admin.getByRole("alertdialog", { name: /^Complete JOB-/ });
  await tabTo(admin, completeDialog.getByLabel(/Completion summary for the customer/), { max: 10 });
  await admin.keyboard.type(SUMMARY);
  await tabTo(admin, completeDialog.getByRole("button", { name: "Complete job" }), { max: 10 });
  await admin.keyboard.press("Enter");
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "COMPLETED", { timeout: 20_000 });
  expect((await workOrderById(jobId)).completionNote).toBe(SUMMARY);

  // ---- Creates and issues the invoice -----------------------------------------------------------------
  const createInvoice = admin.getByRole("button", { name: /^Create invoice for JOB-/ });
  await expectHydrated(createInvoice);
  await tabTo(admin, createInvoice, { back: true });
  await admin.keyboard.press("Enter");
  await expect(admin.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const invoiceId = new URL(admin.url()).pathname.split("/").at(-1) ?? "";
  const issue = admin.getByRole("button", { name: "Issue invoice…" });
  await expectHydrated(issue);
  await tabTo(admin, issue, { back: true });
  await admin.keyboard.press("Enter");
  const issueDialog = admin.getByRole("alertdialog", { name: /^Issue the invoice to / });
  await tabTo(admin, issueDialog.getByRole("button", { name: "Issue invoice" }), { max: 10 });
  await admin.keyboard.press("Enter");
  await expect(admin.getByRole("heading", { level: 1, name: /^INV-\d{4}-\d{5}$/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // ---- Records the payment in full -----------------------------------------------------------------
  const record = admin
    .getByTestId("invoice-payments")
    .filter({ visible: true })
    .getByRole("button", { name: "Record payment" });
  await expectHydrated(record);
  await tabTo(admin, record);
  await admin.keyboard.press("Enter");
  const payment = admin.getByRole("dialog", { name: "Record payment" });
  await expect(payment).toBeVisible();
  const method = payment.getByLabel(/How it was received/);
  await tabTo(admin, method, { max: 15 });
  await arrowToOption(admin, method, "Cash");
  await tabTo(admin, payment.getByRole("button", { name: "Record payment" }), { max: 15 });
  await admin.keyboard.press("Enter");
  await expect(payment).toBeHidden({ timeout: NAVIGATION_TIMEOUT });
  // Focus is not lost when the dialog closes: it goes back to the page, not to nowhere.
  expect(await admin.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await expect(jobBadge(admin)).toHaveAttribute("data-status", "PAID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  expect((await invoiceById(invoiceId)).status).toBe("PAID");
  expect(await paymentsOfInvoice(invoiceId)).toHaveLength(1);

  // ---- The customer downloads the invoice -----------------------------------------------------------
  await customer.goto(`/portal/invoices/${invoiceId}`);
  const download = customer.getByRole("button", { name: "Download PDF" }).filter({ visible: true });
  await expectHydrated(download);
  await tabTo(customer, download);
  const [file] = await Promise.all([
    customer.waitForEvent("download"),
    customer.keyboard.press("Enter"),
  ]);
  expect(file.suggestedFilename()).toMatch(/^INV-\d{4}-\d{5}\.pdf$/);

  await customer.context().close();
  await admin.context().close();
});
