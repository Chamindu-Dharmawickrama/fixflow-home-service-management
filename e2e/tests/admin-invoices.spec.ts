import { calculateDocumentTotals } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  invoiceById,
  invoiceEventsOf,
  invoiceNotificationsFor,
  invoicesOfJob,
  QUOTED_DISCOUNT,
  QUOTED_LINES,
} from "../fixtures/invoices.js";
import { newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { readOutbox } from "../support/outbox.js";
import { openJob, toast } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Invoicing a completed job (T20, workflow 7.6 steps 1 to 4, FR-070, FR-071, FR-074, FR-076, FR-077):
 * the admin creates the draft from a completed job, adds an extra parts line, saves, issues it with a
 * confirmation, and finds it in the list; voids an invoice with a reason; and sees an overdue one
 * for what it is. The admin signs in through the real form and uses the real screens; what happened
 * is checked against what was stored. Every test makes a customer and a completed job of its own,
 * because the specs run in parallel on one database.
 */

test.describe.configure({ timeout: 180_000 });

const INVOICE_PATH = /\/app\/invoices\/[0-9a-f-]{36}$/;
const NUMBER = /^INV-\d{4}-\d{5}$/;

/** The newest email to `to` whose subject contains `subject`. Emails are sent a moment after the page answers. */
async function emailWithSubject(to: string, subject: string) {
  let found: ReturnType<typeof readOutbox>[number] | undefined;
  await expect
    .poll(
      () => {
        found = readOutbox()
          .filter(
            (email) =>
              email.to.toLowerCase() === to.toLowerCase() && email.subject.includes(subject),
          )
          .at(-1);
        return found !== undefined;
      },
      { message: `No email "${subject}" to ${to} reached the outbox`, timeout: 20_000 },
    )
    .toBe(true);
  if (found === undefined) throw new Error("No email found.");
  return found;
}

/** A completed job for a customer made for the test. */
async function completedJob(label: string) {
  const tag = newTechnicianTag();
  const customer = await createCustomerAccount({ name: `${label} ${tag}` });
  const job = await createCompletedJobWithQuote(customer.id);
  return { tag, customer, job };
}

async function openInvoice(page: Page, id: string, heading: string | RegExp) {
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

test("an admin creates an invoice from a completed job, adds a parts line, saves, issues it and finds it in the list", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await completedJob("Ivy Invoice");
  await loginAs(page, "admin");

  // ---- The completed job offers Create invoice ---------------------------------------------------
  await openJob(page, job, { expectButton: `Create invoice for ${job.jobReference}` });
  await expect(page.getByRole("link", { name: /View (draft )?invoice/ })).toHaveCount(0);
  await page.getByRole("button", { name: `Create invoice for ${job.jobReference}` }).click();

  // ---- It lands on the draft, filled in from the accepted quotation ------------------------------
  await expect(page).toHaveURL(INVOICE_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("main").locator("header [data-status]").first()).toHaveAttribute(
    "data-status",
    "DRAFT",
  );
  const [draft] = await invoicesOfJob(job.jobId);
  expect(draft).toBeDefined();
  if (draft === undefined) throw new Error("No draft was stored.");
  expect(draft.status).toBe("DRAFT");
  expect(draft.invoiceNumber).toBeNull();
  expect(draft.quotationId).toBe(job.quotationId);
  expect(draft.totalAmount.toFixed(2)).toBe(job.totals.totalAmount);
  expect(draft.lineItems.map((line) => line.description)).toEqual(
    QUOTED_LINES.map((line) => line.description),
  );

  await expect(page.getByRole("group", { name: /^Line \d+$/ })).toHaveCount(3);
  await expect(page.getByLabel(/^Discount/)).toHaveValue(QUOTED_DISCOUNT);
  await expect(page.getByLabel("Tax rate (%)")).toHaveValue("8.00");
  await expect(page.getByLabel(/^Due date/)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByLabel("Issue date")).toHaveValue("");

  // A draft cannot be issued until what is typed is saved.
  const issueButton = page.getByRole("button", { name: "Issue invoice…" });
  await expect(issueButton).toBeEnabled();

  // ---- Add an extra parts line, with the totals following live -----------------------------------
  const extra = { description: "Contactor relay (extra part)", quantity: "2", unitPrice: "37.25" };
  const expected = calculateDocumentTotals({
    lines: [...QUOTED_LINES, { ...extra, taxable: true }],
    discountAmount: QUOTED_DISCOUNT,
    taxRate: "8.00",
  });
  await expectHydrated(page.getByRole("button", { name: "Add line" }));
  await page.getByRole("button", { name: "Add line" }).click();
  const added = page.getByRole("group", { name: "Line 4" });
  await added.getByLabel(/Description/).fill(extra.description);
  await added.getByLabel("Quantity").fill(extra.quantity);
  await added.getByLabel(/Unit price/).fill(extra.unitPrice);
  await expect(page.getByText("Save your changes to preview or issue.").first()).toBeVisible();
  await expect(issueButton).toBeDisabled();
  const totals = page
    .getByRole("heading", { name: "Totals" })
    .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await expect(totals).toContainText(`$${expected.totalAmount}`);

  // ---- Save: the server works the totals out again -----------------------------------------------
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(toast(page, "Draft saved")).toBeVisible();
  const saved = await invoiceById(draft.id);
  expect(saved.lineItems).toHaveLength(4);
  expect(saved.lineItems[3]?.description).toBe(extra.description);
  expect(saved.subtotal.toFixed(2)).toBe(expected.subtotal);
  expect(saved.taxAmount.toFixed(2)).toBe(expected.taxAmount);
  expect(saved.totalAmount.toFixed(2)).toBe(expected.totalAmount);
  expect(saved.status).toBe("DRAFT");
  await expect(issueButton).toBeEnabled();

  // ---- Preview shows the saved draft as a document, not issued ----------------------------------
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview of the invoice" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(extra.description).first()).toBeVisible({ timeout: 20_000 });
  await expect(preview.getByText("Draft: not issued yet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();

  // ---- Issue: asks first, says it locks, then numbers it -----------------------------------------
  await issueButton.click();
  const confirm = page.getByRole("alertdialog", { name: `Issue the invoice to ${customer.name}?` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "This assigns invoice number INV-… and locks its contents. Corrections after issuing require voiding.",
  );
  expect((await invoiceById(draft.id)).status).toBe("DRAFT"); // nothing happened yet
  await confirm.getByRole("button", { name: "Issue invoice" }).click();

  await expect(page.getByRole("heading", { level: 1, name: NUMBER })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  await expect(toast(page, `Invoice ${number} was issued`)).toBeVisible();

  // ---- The issued document: number, dates, lines, totals, balance due, payment instructions -----
  const doc = page.getByTestId("invoice-document");
  await expect(doc).toBeVisible();
  await expect(doc.getByRole("heading", { level: 2, name: number })).toBeVisible();
  await expect(doc.getByText(extra.description).first()).toBeVisible();
  await expect(doc.getByText("Balance due")).toBeVisible();
  await expect(doc.getByText(`$${expected.totalAmount}`).first()).toBeVisible();
  await expect(doc.getByRole("heading", { name: "How to pay" })).toBeVisible();
  await expect(doc.getByText(`Please quote ${number} with your payment.`)).toBeVisible();
  await expect(page.getByTestId("invoice-banner")).toContainText("Issued");
  await expect(page.getByTestId("invoice-banner")).toContainText("The contents are locked");
  // Issued is kept apart from received: nothing has been paid, and no payment button is offered.
  const payments = page.getByTestId("invoice-payments");
  await expect(payments).toContainText("Payments are recorded in the next step");
  await expect(payments.getByRole("button")).toHaveCount(0);
  // The editor is gone: no fields, no Save draft.
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);

  // ---- What was stored ---------------------------------------------------------------------------
  const issued = await invoiceById(draft.id);
  expect(issued.status).toBe("ISSUED");
  expect(issued.invoiceNumber).toBe(number);
  expect(issued.issuedAt).not.toBeNull();
  expect(issued.issueDate).not.toBeNull();
  expect(issued.businessSnapshot).not.toBeNull();
  expect(issued.customerSnapshot).toMatchObject({ name: customer.name, email: customer.email });
  expect(issued.paymentInstructionsSnapshot).not.toBeNull();
  const events = await invoiceEventsOf(draft.id);
  expect(events.map((event) => event.action)).toEqual(["invoice.created", "invoice.issued"]);
  expect(events[1]?.publicSummary).toBe(`We issued invoice ${number}.`);

  // ---- The customer is told, in the app and by email, with a link and no internal detail --------
  const notifications = await invoiceNotificationsFor(customer.id);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    type: "INVOICE_ISSUED",
    linkPath: `/portal/invoices/${draft.id}`,
  });
  const email = await emailWithSubject(customer.email, number);
  expect(email.text).toContain(`$${expected.totalAmount}`);
  expect(email.text).toContain(`/portal/invoices/${draft.id}`);

  // ---- The list has it, as Issued; the job links to it ------------------------------------------
  await page.goto(`/app/invoices?q=${number}`);
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const row = page.getByRole("row").filter({ hasText: number });
  await expect(row).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "ISSUED");
  await expect(row).toContainText(customer.name);
  await expect(row).toContainText(job.jobReference);
  await expect(row).toContainText(`$${expected.totalAmount}`);
  await expect(page.getByRole("link", { name: /^Issued \d+$/ })).toBeVisible();
  await row.getByRole("link", { name: number }).click();
  await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  await openJob(page, job);
  await expect(page.getByRole("link", { name: `View invoice ${number}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create invoice/ })).toHaveCount(0);
});

test("the Ready to invoice tab has a Create invoice button in each row, which opens the new draft", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { job } = await completedJob("Rowan Row");
  await loginAs(page, "admin");

  await page.goto(`/app/jobs?view=ready-to-invoice&q=${job.jobReference}`);
  const row = page.getByRole("row").filter({ hasText: job.jobReference });
  await expect(row).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  const create = row.getByRole("button", { name: `Create invoice for ${job.jobReference}` });
  await expectHydrated(create);
  await create.click();

  await expect(page).toHaveURL(INVOICE_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  expect(await invoicesOfJob(job.jobId)).toHaveLength(1);

  // The job has left the tab now that it has an invoice.
  await page.goto(`/app/jobs?view=ready-to-invoice&q=${job.jobReference}`);
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: job.jobReference })).toHaveCount(0);
});

test("a second Create invoice opens the invoice that already exists instead of making another", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { job, customer } = await completedJob("Dana Double");
  await loginAs(page, "admin");
  await openJob(page, job, { expectButton: `Create invoice for ${job.jobReference}` });

  // Another admin (or another tab) makes the invoice first.
  const existing = await insertInvoiceFor(job, customer.id, { status: "DRAFT" });
  await page.getByRole("button", { name: `Create invoice for ${job.jobReference}` }).click();

  await expect(page).toHaveURL(new RegExp(`/app/invoices/${existing.id}$`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  expect(await invoicesOfJob(job.jobId)).toHaveLength(1);
});

test("the draft editor stops a bad line before it is sent and keeps what was typed", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await completedJob("Vera Validate");
  const draft = await insertInvoiceFor(job, customer.id, { status: "DRAFT" });
  await loginAs(page, "admin");
  await openInvoice(page, draft.id, "Draft invoice");
  await expectHydrated(page.getByRole("button", { name: "Add line" }));

  const line = page.getByRole("group", { name: "Line 2" });
  await line.getByLabel("Quantity").fill("0");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(line.getByText(/Enter a quantity from 0.01 to 9,999.99/)).toBeVisible();
  await expect(line.getByLabel("Quantity")).toHaveValue("0");
  expect((await invoiceById(draft.id)).lineItems[1]?.quantity.toFixed(2)).toBe("1.00");

  // A due date before the issue date is named beside the field.
  await line.getByLabel("Quantity").fill("1");
  await page.getByLabel("Issue date").fill("2030-06-10");
  await page.getByLabel(/^Due date/).fill("2030-06-01");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByText("The due date can't be before the issue date.").first(),
  ).toBeVisible();
  expect((await invoiceById(draft.id)).issueDate).toBeNull();
});

test("an admin voids an issued invoice with a reason: the customer is told safely and the job can be invoiced again", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await completedJob("Vic Void");
  const issued = await insertInvoiceFor(job, customer.id, {
    status: "ISSUED",
    issueDate: "2026-11-02",
    dueDate: "2999-01-01",
  });
  const number = issued.invoiceNumber ?? "";
  expect(number).toMatch(NUMBER);
  await loginAs(page, "admin");
  await openInvoice(page, issued.id, number);

  const reason =
    "INTERNAL-REASON: the labour hours were entered twice and the customer disputes it.";
  const voidButton = page.getByRole("button", { name: "Void invoice…" });
  await expectHydrated(voidButton);
  await voidButton.click();
  const dialog = page.getByRole("alertdialog", { name: `Void ${number}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("cannot be undone");
  const confirm = dialog.getByRole("button", { name: "Void invoice" });
  await expect(confirm).toBeDisabled(); // a reason is required
  await dialog.getByLabel(/Reason/).fill(reason);
  await confirm.click();

  await expect(toast(page, `${number} was voided`)).toBeVisible();
  await expect(page.getByTestId("invoice-banner")).toContainText("Voided");
  await expect(page.getByTestId("invoice-banner")).toContainText(reason);
  await expect(page.getByTestId("invoice-void-mark")).toBeVisible();
  await expect(page.getByRole("button", { name: "Void invoice…" })).toHaveCount(0);

  const stored = await invoiceById(issued.id);
  expect(stored.status).toBe("VOID");
  expect(stored.voidReason).toBe(reason);
  expect(stored.voidedAt).not.toBeNull();
  expect(stored.invoiceNumber).toBe(number); // the number stays, and is never reused

  // The customer is told, with nothing internal.
  const [notification] = await invoiceNotificationsFor(customer.id);
  expect(notification?.type).toBe("INVOICE_VOIDED");
  expect(`${notification?.title} ${notification?.message}`).not.toContain("INTERNAL-REASON");
  const email = await emailWithSubject(customer.email, number);
  expect(`${email.subject} ${email.text}`).not.toContain("INTERNAL-REASON");
  expect(`${email.subject} ${email.text}`).not.toContain("labour hours");

  // The list shows it as void; the job offers a new invoice.
  await page.goto(`/app/invoices?status=VOID&q=${number}`);
  await expect(page.getByRole("row").filter({ hasText: number })).toHaveCount(1, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await openJob(page, job, { expectButton: `Create invoice for ${job.jobReference}` });
});

test("an overdue invoice is listed under Overdue with its days, and says so on its page", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await completedJob("Olive Overdue");
  const overdue = await insertInvoiceFor(job, customer.id, {
    status: "ISSUED",
    issueDate: "2026-01-05",
    dueDate: "2026-01-19",
  });
  const number = overdue.invoiceNumber ?? "";
  await loginAs(page, "admin");

  // Stored as issued, it is overdue by the business's calendar: the list saves that and shows it.
  await page.goto(`/app/invoices?status=OVERDUE&q=${number}`);
  const row = page.getByRole("row").filter({ hasText: number });
  await expect(row).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "OVERDUE");
  await expect(row).toContainText(/Overdue by \d+ days?/);
  expect((await invoiceById(overdue.id)).status).toBe("OVERDUE");
  expect((await invoiceEventsOf(overdue.id)).map((event) => event.action)).toContain(
    "invoice.overdue",
  );

  await row.getByRole("link", { name: number }).click();
  await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByTestId("invoice-banner")).toContainText(/Overdue by \d+ days?/);
  await expect(page.getByTestId("invoice-document")).toContainText(/Overdue by \d+ days?/);
});

test("the invoice list filters by status and search, and says why when nothing matches", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await completedJob("Lena List");
  const draft = await insertInvoiceFor(job, customer.id, { status: "DRAFT" });
  expect(draft.invoiceNumber).toBeNull();
  await loginAs(page, "admin");

  await page.goto(`/app/invoices?q=${encodeURIComponent(customer.name)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const row = page.getByRole("row").filter({ hasText: customer.name });
  await expect(row).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  await expect(row.getByRole("link", { name: "Draft" })).toBeVisible();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "DRAFT");

  // A status chip narrows the list and keeps the search.
  await page.getByRole("link", { name: /^Paid \d+$/ }).click();
  await expect(page).toHaveURL(/status=PAID/);
  await expect(page.getByRole("heading", { name: "No invoices match" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(/status=PAID/);
  await expect(page).not.toHaveURL(/q=/);
});
