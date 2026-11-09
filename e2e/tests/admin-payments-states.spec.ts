import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  insertPaymentFor,
} from "../fixtures/invoices.js";
import { newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectInsideScreen,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The states of the payments panel and its dialogs (T21) at the four required widths: nothing paid
 * yet, partly paid with a history that holds a voided payment, paid in full, and a voided invoice,
 * with ordinary content and with text as long as the rules allow (an unbroken word included). Each
 * screen is axe-clean, nothing scrolls sideways, and each dialog stays inside the screen. Each test
 * makes the customer it needs (the tests run in parallel on one database).
 */

test.describe.configure({ timeout: 240_000 });

/** A word with no space to break at, the way a pasted transfer id reads. */
const UNBROKEN = "L".repeat(100);
const LONG_NOTES = `${UNBROKEN}\n${"Left with the neighbour at number twelve. ".repeat(10)}`.slice(
  0,
  500,
);
const LONG_REASON = `${UNBROKEN} ${"Entered against the wrong invoice. ".repeat(8)}`.slice(0, 500);

/** One customer with an invoice in every interesting payment state. */
async function world() {
  const tag = newTechnicianTag();
  const customer = await createCustomerAccount({ name: `Penny Payment ${tag}` });
  const make = async (options: Parameters<typeof insertInvoiceFor>[2]) => {
    const job = await createCompletedJobWithQuote(customer.id);
    return { job, ...(await insertInvoiceFor(job, customer.id, options)) };
  };
  const unpaid = await make({ status: "ISSUED", issueDate: "2026-11-02", dueDate: "2999-01-01" });
  const partly = await make({ status: "ISSUED", issueDate: "2026-11-02", dueDate: "2999-01-01" });
  await insertPaymentFor(partly.id, {
    amount: "60.00",
    paymentDate: "2026-11-03",
    method: "CHEQUE",
    reference: UNBROKEN,
    notes: LONG_NOTES,
  });
  await insertPaymentFor(partly.id, {
    amount: "25.50",
    paymentDate: "2026-11-04",
    method: "CASH",
    voidReason: LONG_REASON,
  });
  const paid = await make({ status: "ISSUED", issueDate: "2026-11-02", dueDate: "2999-01-01" });
  await insertPaymentFor(paid.id, { amount: paid.job.totals.totalAmount, reference: "TRF-77" });
  const voided = await make({ status: "ISSUED", issueDate: "2026-11-02", dueDate: "2999-01-01" });
  await insertPaymentFor(voided.id, { amount: "10.00", voidReason: LONG_REASON });
  await insertPaymentFor(voided.id, { amount: "10.00", voidReason: "Duplicate entry." });
  return { tag, customer, unpaid, partly, paid, voided };
}

async function expectPageFits(page: Page, label: string, width: number) {
  await expectNoHorizontalOverflow(page);
  expect(await seriousViolations(page), `${label} at ${String(width)} px`).toBe("");
}

async function openInvoice(page: Page, id: string, number: string | null) {
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: number ?? "" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByTestId("invoice-payments").filter({ visible: true })).toBeVisible();
}

/** Next keeps the page you came from mounted, hidden: only the panel a person sees counts. */
const panel = (page: Page): Locator =>
  page.getByTestId("invoice-payments").filter({ visible: true });

/** Below 1024 px the table is replaced by cards, so the list a person sees is the other one. */
const paymentRows = (page: Page, width: number): Locator =>
  width >= 1024
    ? panel(page).getByRole("table", { name: "Payments recorded against this invoice" })
    : panel(page).getByRole("list", { name: "Payments recorded against this invoice" });

async function closeDialog(page: Page, role: "dialog" | "alertdialog") {
  await page.keyboard.press("Escape");
  await expect(page.getByRole(role)).toBeHidden();
}

test.describe("the payments panel and its dialogs at the four widths", () => {
  for (const width of WIDTHS) {
    test(`work at ${String(width)} px: nothing paid, partly paid with a voided payment, paid in full, all payments voided, and both dialogs`, async ({
      page,
    }) => {
      const w = await world();
      await useViewport(page, width);
      await loginAs(page, "admin");

      // ---- Nothing paid: the empty state guides, the dialog works -----------------------------------
      await openInvoice(page, w.unpaid.id, w.unpaid.invoiceNumber);
      await expect(panel(page).getByTestId("payments-empty")).toContainText(
        "No payments recorded yet",
      );
      await expectPageFits(page, "an invoice with no payments", width);

      const record = panel(page).getByRole("button", { name: "Record payment" });
      await expectHydrated(record);
      await record.click();
      const dialog = page.getByRole("dialog", { name: "Record payment" });
      await expect(dialog).toBeVisible();
      await expectInsideScreen(page, dialog, "the Record payment dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the Record payment dialog at ${String(width)} px`,
      ).toBe("");

      // Validation errors beside the fields, with text as long as allowed in the optional fields.
      await dialog.getByLabel(/Amount received/).fill("0");
      await dialog.getByLabel(/Reference/).fill(UNBROKEN);
      await dialog.getByLabel(/Notes/).fill(LONG_NOTES);
      await dialog.getByRole("button", { name: "Record payment" }).click();
      await expect(dialog.getByText("The amount must be more than zero.")).toBeVisible();
      await expect(dialog.getByText("Choose how the payment was received.")).toBeVisible();
      await expectInsideScreen(page, dialog, "the Record payment dialog with errors");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the Record payment dialog with errors at ${String(width)} px`,
      ).toBe("");
      await closeDialog(page, "dialog");
      // Focus is handed back to the button that opened the dialog.
      await expect(record).toBeFocused();

      // ---- Partly paid: a history with long text and a voided payment ------------------------------
      await openInvoice(page, w.partly.id, w.partly.invoiceNumber);
      await expect(paymentRows(page, width)).toBeVisible();
      await expect(panel(page).getByText("Voided").filter({ visible: true }).first()).toBeVisible();
      await expect(
        panel(page)
          .getByText(/Reason: L{20}/)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expectPageFits(page, "a partly paid invoice with long text", width);

      const voidPayment = panel(page)
        .getByRole("button", { name: /^Void the \$60\.00 payment/ })
        .filter({ visible: true });
      await expectHydrated(voidPayment);
      await voidPayment.click();
      const confirm = page.getByRole("alertdialog", { name: "Void the $60.00 payment?" });
      await expect(confirm).toBeVisible();
      await confirm.getByLabel(/Reason/).fill(LONG_REASON);
      await expectInsideScreen(page, confirm, "the Void payment dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        `the Void payment dialog at ${String(width)} px`,
      ).toBe("");
      await closeDialog(page, "alertdialog");

      // ---- Paid in full -----------------------------------------------------------------------------
      await openInvoice(page, w.paid.id, w.paid.invoiceNumber);
      await expect(panel(page).getByText("Paid in full").first()).toBeVisible();
      await expect(panel(page).getByRole("button", { name: "Record payment" })).toHaveCount(0);
      await expectPageFits(page, "a paid invoice", width);

      // ---- Every payment voided: the history stays, and the invoice can be voided again --------------
      await openInvoice(page, w.voided.id, w.voided.invoiceNumber);
      await expect(
        panel(page).getByText("Duplicate entry.").filter({ visible: true }).first(),
      ).toBeVisible();
      await expectPageFits(page, "an invoice whose payments were all voided", width);
    });
  }
});
