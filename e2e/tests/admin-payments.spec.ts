import { balanceDue, sumAmounts } from "@fixflow/shared";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  insertPaymentFor,
  invoiceById,
  invoiceEventsOf,
  paymentNotificationsFor,
  paymentsOfInvoice,
} from "../fixtures/invoices.js";
import { newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { readOutbox } from "../support/outbox.js";
import { jobBadge, toast } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Recording payments by hand (T21, workflow 7.6 steps 6 to 8, FR-073 to FR-076): the admin records a
 * part payment (the invoice becomes Partially paid), tries to record more than is owed and is stopped
 * beside the amount, records the rest (Paid), then voids one payment with a reason (the invoice falls
 * back to Partially paid and the voided payment stays in the list). The admin signs in through the
 * real form and uses the real screens; what happened is checked against what was stored, the
 * customer's notification and the email that left. Each test makes a customer and an invoice of its
 * own, because the specs run in parallel on one database.
 */

test.describe.configure({ timeout: 180_000 });

/** A customer with an issued invoice that is not yet due, nothing paid on it. */
async function issuedInvoiceWorld(label: string) {
  const tag = newTechnicianTag();
  const customer = await createCustomerAccount({ name: `${label} ${tag}` });
  const job = await createCompletedJobWithQuote(customer.id);
  const invoice = await insertInvoiceFor(job, customer.id, {
    status: "ISSUED",
    issueDate: "2026-11-02",
    dueDate: "2999-01-01",
  });
  return { tag, customer, job, invoice, number: invoice.invoiceNumber ?? "" };
}

async function openInvoice(page: Page, id: string, number: string) {
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

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

const panel = (page: Page): Locator =>
  page.getByTestId("invoice-payments").filter({ visible: true });
const status = (page: Page) => jobBadge(page);
const summaryFigure = (page: Page, label: string): Locator =>
  panel(page)
    .getByTestId("payment-summary")
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::dd[1]");

test("an admin records a part payment, cannot overpay, records the rest and voids one payment", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job, invoice, number } = await issuedInvoiceWorld("Pippa Payment");
  const total = job.totals.totalAmount;
  const FIRST = "100.00";
  const left = balanceDue(total, FIRST);
  await loginAs(page, "admin");
  await openInvoice(page, invoice.id, number);

  // ---- Nothing is paid yet: the panel says so and offers to record one -------------------------------
  await expect(status(page)).toHaveAttribute("data-status", "ISSUED");
  await expect(summaryFigure(page, "Total")).toHaveText(`$${total}`);
  await expect(summaryFigure(page, "Paid")).toHaveText("$0.00");
  await expect(summaryFigure(page, "Balance due")).toHaveText(`$${total}`);
  await expect(panel(page).getByTestId("payments-empty")).toContainText("No payments recorded yet");
  const record = panel(page).getByRole("button", { name: "Record payment" });
  await expectHydrated(record);

  // ---- A part payment: the dialog starts at the balance and says what it is for ----------------------
  await record.click();
  const dialog = page.getByRole("dialog", { name: "Record payment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Record only payments you've actually received outside FixFlow",
  );
  await expect(dialog.getByLabel(/Amount received/)).toHaveValue(total);
  await expect(dialog.getByLabel(/Date received/)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(dialog.getByText("Don't enter card numbers or bank login details.")).toHaveCount(2);

  // It asks for what is missing beside the field and sends nothing.
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog.getByText("Choose how the payment was received.")).toBeVisible();
  expect(await paymentsOfInvoice(invoice.id)).toHaveLength(0);

  await dialog.getByLabel(/Amount received/).fill("100");
  await dialog.getByLabel(/How it was received/).selectOption({ label: "Bank transfer" });
  await dialog.getByLabel(/Reference/).fill("TRF-2026-0042");
  await dialog.getByLabel(/Notes/).fill("Received in the morning");
  await dialog.getByRole("button", { name: "Record payment" }).click();

  await expect(toast(page, "Payment recorded")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveAttribute("data-status", "PARTIALLY_PAID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(summaryFigure(page, "Paid")).toHaveText(`$${FIRST}`);
  await expect(summaryFigure(page, "Balance due")).toHaveText(`$${left}`);
  await expect(page.getByTestId("invoice-banner")).toContainText("Partly paid");

  const row = panel(page).getByRole("table").getByRole("row").nth(1);
  await expect(row).toContainText("Bank transfer");
  await expect(row).toContainText("TRF-2026-0042");
  await expect(row).toContainText("Note: Received in the morning");
  await expect(row).toContainText(`$${FIRST}`);
  await expect(row).toContainText("Recorded");

  // ---- An overpayment is stopped beside the amount, and nothing is stored ----------------------------
  await panel(page).getByRole("button", { name: "Record payment" }).click();
  const second = page.getByRole("dialog", { name: "Record payment" });
  await expect(second.getByLabel(/Amount received/)).toHaveValue(left);
  await second.getByLabel(/Amount received/).fill("9999.00");
  await second.getByLabel(/How it was received/).selectOption({ label: "Cash" });
  await second.getByRole("button", { name: "Record payment" }).click();
  const overpayment = `This payment exceeds the remaining balance of $${left}`;
  await expect(second.getByText(overpayment)).toBeVisible();
  await expect(second.getByLabel(/Amount received/)).toHaveAttribute("aria-invalid", "true");
  await expect(second).toBeVisible();
  expect(await paymentsOfInvoice(invoice.id)).toHaveLength(1);
  expect((await invoiceById(invoice.id)).amountPaid.toFixed(2)).toBe(FIRST);

  // ---- The rest: the exact balance settles the invoice -----------------------------------------------
  await second.getByLabel(/Amount received/).fill(left);
  await second.getByRole("button", { name: "Record payment" }).click();
  await expect(toast(page, "Payment recorded").first()).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(status(page)).toHaveAttribute("data-status", "PAID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(summaryFigure(page, "Balance due")).toContainText("$0.00");
  await expect(summaryFigure(page, "Balance due")).toContainText("Paid in full");
  await expect(page.getByTestId("invoice-banner")).toContainText("Paid in full");
  // A paid invoice offers no way to record more.
  await expect(panel(page).getByRole("button", { name: "Record payment" })).toHaveCount(0);

  // ---- Voiding the first payment: a reason is required, the record stays ------------------------------
  const table = panel(page).getByRole("table");
  await table.getByRole("button", { name: /^Void the \$100\.00 payment received on/ }).click();
  const confirm = page.getByRole("alertdialog", { name: "Void the $100.00 payment?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`The invoice balance will increase by $${FIRST}`);
  await expect(confirm.getByRole("button", { name: "Void payment" })).toBeDisabled();
  await confirm.getByLabel(/Reason/).fill("Entered against the wrong invoice.");
  await confirm.getByRole("button", { name: "Void payment" }).click();

  await expect(toast(page, "Payment voided")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(status(page)).toHaveAttribute("data-status", "PARTIALLY_PAID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(summaryFigure(page, "Paid")).toHaveText(`$${left}`);
  await expect(summaryFigure(page, "Balance due")).toHaveText(`$${FIRST}`);
  const voidedRow = panel(page).getByRole("table").getByRole("row").nth(1);
  await expect(voidedRow).toContainText("Voided");
  await expect(voidedRow).toContainText("Reason: Entered against the wrong invoice.");
  await expect(voidedRow.getByRole("button")).toHaveCount(0);
  await expect(panel(page).getByRole("table").getByRole("row")).toHaveCount(3);

  // ---- What was stored: the history is permanent and the amount paid is the sum of what stands -------
  const payments = await paymentsOfInvoice(invoice.id);
  expect(payments).toHaveLength(2);
  expect(payments[0]).toMatchObject({
    method: "BANK_TRANSFER",
    reference: "TRF-2026-0042",
    voidReason: "Entered against the wrong invoice.",
  });
  expect(payments[0]?.voidedAt).not.toBeNull();
  expect(payments[0]?.voidedByUserId).not.toBeNull();
  expect(payments[1]?.voidedAt).toBeNull();
  const stored = await invoiceById(invoice.id);
  expect(stored.status).toBe("PARTIALLY_PAID");
  expect(stored.amountPaid.toFixed(2)).toBe(
    sumAmounts(
      payments
        .filter((payment) => payment.voidedAt === null)
        .map((payment) => payment.amount.toFixed(2)),
    ),
  );

  const events = await invoiceEventsOf(invoice.id);
  expect(events.map((event) => event.action)).toEqual([
    "payment.recorded",
    "payment.recorded",
    "payment.voided",
  ]);
  // Neither the reference nor the note nor the void reason is written into the history.
  expect(JSON.stringify(events)).not.toMatch(/TRF-2026-0042|Received in the morning|wrong invoice/);
  expect(events[0]?.publicSummary).toMatch(
    /^We recorded your payment of \$100\.00 received on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/,
  );

  // ---- The customer was told, safely, in the app and by email ----------------------------------------
  const notifications = await paymentNotificationsFor(customer.id);
  expect(notifications).toHaveLength(3);
  expect(notifications.map((notification) => notification.title)).toEqual([
    `A payment record on invoice ${number} was reversed`,
    `Payment recorded for invoice ${number}`,
    `Payment recorded for invoice ${number}`,
  ]);
  expect(JSON.stringify(notifications)).not.toMatch(
    /TRF-2026-0042|Received in the morning|wrong invoice/,
  );

  // Two payments were recorded, so two emails left: the first for the transfer, the last for the cash.
  const last = await emailWithSubject(customer.email, `Payment recorded for invoice ${number}`);
  expect(last.text).toContain("Method: Cash");
  expect(last.text).toContain("paid in full");
  const mails = readOutbox().filter(
    (mail) =>
      mail.to.toLowerCase() === customer.email.toLowerCase() &&
      mail.subject.includes(`Payment recorded for invoice ${number}`),
  );
  expect(mails).toHaveLength(2);
  const first = mails.find((mail) => mail.text.includes("Method: Bank transfer"));
  expect(first?.text).toContain("We have recorded your payment");
  expect(first?.text).toContain("Payment: $100.00");
  expect(first?.text).toContain("A balance remains");
  for (const mail of mails) {
    expect(mail.text).not.toMatch(/TRF-2026-0042|Received in the morning|processed/i);
  }
});

test("the invoice cannot be voided while a payment stands, and can be once it is voided", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { invoice, number } = await issuedInvoiceWorld("Vera Void");
  await insertPaymentFor(invoice.id, { amount: "50.00", reference: "CASH-1" });
  await loginAs(page, "admin");
  await openInvoice(page, invoice.id, number);

  // With a payment on it the invoice offers no Void, and the payment can be voided instead.
  await expect(status(page)).toHaveAttribute("data-status", "PARTIALLY_PAID");
  await expect(page.getByRole("button", { name: "Void invoice…" })).toHaveCount(0);
  const table = panel(page).getByRole("table");
  await expectHydrated(table.getByRole("button", { name: /^Void the \$50\.00 payment/ }));
  await table.getByRole("button", { name: /^Void the \$50\.00 payment/ }).click();
  const confirm = page.getByRole("alertdialog", { name: "Void the $50.00 payment?" });
  await confirm.getByLabel(/Reason/).fill("It was a deposit for another job.");
  await confirm.getByRole("button", { name: "Void payment" }).click();
  await expect(toast(page, "Payment voided")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

  // Now nothing stands, so the invoice can be voided and the voided payment stays in its history.
  await expect(status(page)).toHaveAttribute("data-status", "ISSUED", {
    timeout: NAVIGATION_TIMEOUT,
  });
  const voidInvoice = page.getByRole("button", { name: "Void invoice…" });
  await expect(voidInvoice).toBeVisible();
  await voidInvoice.click();
  const dialog = page.getByRole("alertdialog", { name: `Void ${number}?` });
  await dialog.getByLabel(/Reason/).fill("Billed the wrong customer.");
  await dialog.getByRole("button", { name: "Void invoice" }).click();
  await expect(status(page)).toHaveAttribute("data-status", "VOID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(panel(page).getByRole("button")).toHaveCount(0);
  await expect(panel(page)).toContainText("It was a deposit for another job.");
  expect((await paymentsOfInvoice(invoice.id)).every((payment) => payment.voidedAt !== null)).toBe(
    true,
  );
  expect((await invoiceById(invoice.id)).status).toBe("VOID");
});

test("a part payment on an overdue invoice leaves it overdue and the rest pays it", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const tag = newTechnicianTag();
  const customer = await createCustomerAccount({ name: `Olive Overdue ${tag}` });
  const job = await createCompletedJobWithQuote(customer.id);
  const invoice = await insertInvoiceFor(job, customer.id, {
    status: "ISSUED",
    issueDate: "2026-01-05",
    dueDate: "2026-01-19",
  });
  const number = invoice.invoiceNumber ?? "";
  await loginAs(page, "admin");
  await openInvoice(page, invoice.id, number);

  await expect(status(page)).toHaveAttribute("data-status", "OVERDUE");
  const record = panel(page).getByRole("button", { name: "Record payment" });
  await expectHydrated(record);
  await record.click();
  const dialog = page.getByRole("dialog", { name: "Record payment" });
  await dialog.getByLabel(/Amount received/).fill("40.00");
  await dialog.getByLabel(/How it was received/).selectOption({ label: "Cash" });
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(toast(page, "Payment recorded")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

  // Overdue wins over partly paid (D-26), and the amount paid is shown.
  await expect(summaryFigure(page, "Paid")).toHaveText("$40.00", { timeout: NAVIGATION_TIMEOUT });
  await expect(status(page)).toHaveAttribute("data-status", "OVERDUE");
  expect((await invoiceById(invoice.id)).status).toBe("OVERDUE");

  await panel(page).getByRole("button", { name: "Record payment" }).click();
  const rest = page.getByRole("dialog", { name: "Record payment" });
  await rest.getByLabel(/How it was received/).selectOption({ label: "Cheque" });
  await rest.getByRole("button", { name: "Record payment" }).click();
  await expect(status(page)).toHaveAttribute("data-status", "PAID", {
    timeout: NAVIGATION_TIMEOUT,
  });
  expect((await invoiceById(invoice.id)).amountPaid.toFixed(2)).toBe(job.totals.totalAmount);
});
