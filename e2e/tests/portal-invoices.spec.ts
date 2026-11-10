import { balanceDue } from "@fixflow/shared";
import { expect, test } from "@playwright/test";

import { printedText } from "../../apps/server/src/test/pdf-text.js";
import { createCustomerAccount, withDatabase } from "../fixtures/accounts.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  banner,
  customerWithInvoices,
  documentPayments,
  dollars,
  downloadButton,
  downloadPdf,
  INTERNAL,
  invoiceDocument,
  openPortalInvoice,
  pageBadge,
  PORTAL_INVOICE_PATH,
  signInAsCustomer,
} from "./helpers/portal-invoices.js";

/**
 * The customer's invoices (T22, workflow 7.6 steps 4 to 5 and 7.7, FR-072, IA-C05): the customer signs
 * in through the real form, opens an invoice the business issued and has partly been paid, sees the
 * balance, the payments received and how to pay, and downloads the PDF, whose file name and contents
 * are checked. Another customer gets the not-found page for the same address. Each test makes the
 * customer and the invoices it needs, because the specs run in parallel on one database.
 */

test.describe.configure({ timeout: 180_000 });

const NOT_FOUND = "We couldn't find that invoice";

test("the customer opens a part-paid invoice, sees the balance and the payments, and downloads the PDF", async ({
  page,
  browser,
}) => {
  await useViewport(page, 1440);
  const { customer, make, pay } = await customerWithInvoices("Dana Downloader");
  const invoice = await make();
  const total = invoice.job.totals.totalAmount;
  const FIRST = "100.00";
  const left = balanceDue(total, FIRST);
  await pay(invoice.id, {
    amount: FIRST,
    paymentDate: "2026-11-03",
    method: "BANK_TRANSFER",
    reference: INTERNAL.paymentReference,
    notes: INTERNAL.paymentNotes,
  });
  await pay(invoice.id, {
    amount: "20.00",
    paymentDate: "2026-11-04",
    method: "CASH",
    voidReason: INTERNAL.paymentVoidReason,
  });
  const number = invoice.invoiceNumber ?? "";

  await signInAsCustomer(page, customer);
  await openPortalInvoice(page, invoice.id, number);
  expect(page.url()).toMatch(PORTAL_INVOICE_PATH);

  // ---- Where it stands: the status, and the balance with the day it is due -------------------------
  await expect(pageBadge(page)).toHaveAttribute("data-status", "PARTIALLY_PAID");
  await expect(banner(page)).toContainText(`Balance due ${dollars(left)} by Jan 1, 2999`);
  await expect(banner(page)).toContainText(
    `${dollars(FIRST)} of ${dollars(total)} has been received.`,
  );

  // ---- The document mirrors the PDF: parties, lines, totals, amount paid and balance ----------------
  const doc = invoiceDocument(page);
  await expect(doc).toContainText(number);
  await expect(doc).toContainText("Billed to");
  await expect(doc).toContainText("Diagnostic visit");
  await expect(doc).toContainText("Run capacitor");
  await expect(doc).toContainText(dollars(total));
  await expect(doc).toContainText(`-${dollars(FIRST)}`);
  await expect(doc).toContainText(dollars(left));

  // ---- The payments that stand: the voided one is not shown, and nothing internal is --------------
  const payments = documentPayments(page);
  await expect(payments).toContainText("Payments received");
  await expect(payments.getByRole("listitem")).toHaveCount(1);
  await expect(payments).toContainText("Nov 3, 2026");
  await expect(payments).toContainText("Bank transfer");
  await expect(payments).toContainText(dollars(FIRST));
  await expect(payments).not.toContainText("Cash");
  await expect(payments).not.toContainText("20.00");

  // ---- How to pay, and that FixFlow takes no money ----------------------------------------------------
  const how = doc.getByRole("region", { name: "How to pay" });
  await expect(how).toContainText(`Please quote ${number} with your payment.`);
  await expect(how).toContainText(
    /Payments are made directly to .+; FixFlow doesn't process payments\./,
  );

  const text = await page.locator("body").innerText();
  for (const secret of Object.values(INTERNAL)) {
    expect(text, secret).not.toContain(secret);
  }

  // ---- Download: the file the browser saves, under the invoice's number ----------------------------
  const file = await downloadPdf(page);
  expect(file.filename).toBe(`${number}.pdf`);
  expect(file.size).toBeGreaterThan(5_000);
  expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const printed = await printedText(file.bytes);
  for (const expected of [
    number,
    "Partially paid",
    `Total ${dollars(total)}`,
    `Balance due ${dollars(left)}`,
    `Nov 3, 2026 Bank transfer ${dollars(FIRST)}`,
    "FixFlow doesn't process payments",
  ]) {
    expect(printed, expected).toContain(expected);
  }
  for (const secret of Object.values(INTERNAL)) {
    expect(printed, secret).not.toContain(secret);
  }
  // The voided payment is in neither the page nor the file.
  expect(printed).not.toContain("$20.00");

  // ---- Another customer gets the not-found page for the same address, and 404 from the API ---------
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await loginAs(strangerPage, "customer-b");
  await strangerPage.goto(`/portal/invoices/${invoice.id}`);
  await expect(strangerPage.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(strangerPage.locator("body")).not.toContainText(number);
  expect((await strangerPage.request.get(`/api/v1/invoices/${invoice.id}`)).status()).toBe(404);
  expect((await strangerPage.request.get(`/api/v1/invoices/${invoice.id}/pdf`)).status()).toBe(404);
  await stranger.close();
});

test("a visitor who is not signed in cannot read an invoice or its PDF", async ({ page }) => {
  const { make } = await customerWithInvoices("Vera Visitor");
  const invoice = await make();
  expect((await page.request.get(`/api/v1/invoices/${invoice.id}`)).status()).toBe(401);
  expect((await page.request.get(`/api/v1/invoices/${invoice.id}/pdf`)).status()).toBe(401);
  await page.goto(`/portal/invoices/${invoice.id}`);
  await expect(page).toHaveURL(/\/login/, { timeout: NAVIGATION_TIMEOUT });
});

test("the customer's invoice list filters by Outstanding, Paid and All, and never shows a draft", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make, pay } = await customerWithInvoices("Lena Lister");
  const open = await make();
  const overdue = await make({ issueDate: "2026-01-05", dueDate: "2026-01-19" });
  const settled = await make();
  await pay(settled.id, { amount: settled.job.totals.totalAmount, paymentDate: "2026-11-03" });
  const withdrawn = await make({ status: "VOID", voidReason: INTERNAL.voidReason });
  const draft = await make({ status: "DRAFT" });

  await signInAsCustomer(page, customer);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Invoices", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Your invoices" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  const cards = page.getByTestId("portal-invoice-card").filter({ visible: true });
  const filters = page.getByRole("navigation", { name: "Filter invoices" });

  // ---- All: the four the customer was issued, newest first; the draft is nobody's but the business's
  await expect(filters.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  await expect(cards).toHaveCount(4);
  for (const invoice of [open, overdue, settled, withdrawn]) {
    await expect(
      page.getByRole("link", { name: new RegExp(invoice.invoiceNumber ?? "never") }),
    ).toBeVisible();
  }
  const text = await page.locator("main").innerText();
  expect(text).not.toContain(INTERNAL.voidReason);

  // Each card says what the invoice is, in words.
  const cardOf = (number: string | null) =>
    cards.filter({ has: page.getByRole("link", { name: new RegExp(number ?? "never") }) });
  await expect(cardOf(open.invoiceNumber)).toContainText("Issued");
  await expect(cardOf(open.invoiceNumber)).toContainText("Balance due");
  await expect(cardOf(overdue.invoiceNumber)).toContainText("Overdue");
  await expect(cardOf(overdue.invoiceNumber)).toContainText("was due Jan 19, 2026");
  await expect(cardOf(settled.invoiceNumber)).toContainText("Paid in full");
  await expect(cardOf(withdrawn.invoiceNumber)).toContainText("Withdrawn: nothing is owed");

  // ---- Outstanding: what still owes money --------------------------------------------------------------
  await filters.getByRole("link", { name: "Outstanding" }).click();
  await expect(page).toHaveURL(/filter=outstanding/);
  await expect(filters.getByRole("link", { name: "Outstanding" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(cards).toHaveCount(2);
  await expect(cardOf(open.invoiceNumber)).toBeVisible();
  await expect(cardOf(overdue.invoiceNumber)).toBeVisible();

  // ---- Paid ----------------------------------------------------------------------------------------------
  await filters.getByRole("link", { name: "Paid" }).click();
  await expect(page).toHaveURL(/filter=paid/);
  await expect(cards).toHaveCount(1);
  await expect(cardOf(settled.invoiceNumber)).toBeVisible();

  // ---- A card opens its invoice -----------------------------------------------------------------------------
  await cardOf(settled.invoiceNumber).getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Invoice ${settled.invoiceNumber ?? ""}` }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(pageBadge(page)).toHaveAttribute("data-status", "PAID");
  await expect(banner(page)).toContainText("Paid in full on Nov 3, 2026");

  // ---- The draft cannot be opened by address either: it looks like an id that does not exist --------
  await page.goto(`/portal/invoices/${draft.id}`);
  await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
});

test("a customer with no invoices is told what to expect, and Outstanding says nothing is owed", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Nora Newcomer" });
  await signInAsCustomer(page, customer);
  await page.goto("/portal/invoices");
  await expect(page.getByRole("heading", { level: 1, name: "Your invoices" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("heading", { name: "You don't have an invoice yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View your jobs" })).toBeVisible();

  await page.goto("/portal/invoices?filter=outstanding");
  await expect(page.getByRole("heading", { name: "Nothing to pay right now" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await page.getByRole("link", { name: "Show all invoices" }).click();
  await expect(page.getByRole("heading", { name: "You don't have an invoice yet" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // The overview draws no empty "Outstanding invoices" box.
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("region", { name: "Outstanding invoices" })).toHaveCount(0);
});

test("the overview lists the outstanding invoices, and the job links to its invoice", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make, pay } = await customerWithInvoices("Owen Overview");
  const open = await make();
  const settled = await make();
  await pay(settled.id, { amount: settled.job.totals.totalAmount });
  const number = open.invoiceNumber ?? "";

  await signInAsCustomer(page, customer);
  await page.goto("/portal");
  const section = page.getByRole("region", { name: "Outstanding invoices" });
  await expect(section).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  // Only what still owes money: the paid one is not here.
  await expect(section.getByTestId("portal-invoice-card")).toHaveCount(1);
  await expect(section).toContainText(number);
  await expect(section).toContainText("You have an invoice that still has a balance to pay.");
  await expect(section.getByRole("link", { name: "View all invoices" })).toHaveAttribute(
    "href",
    "/portal/invoices",
  );

  // The job's page links to its invoice, with its number and status.
  await page.goto(`/portal/jobs/${open.job.jobId}`);
  const link = page.getByRole("link", { name: new RegExp(number) }).filter({ visible: true });
  await expect(link).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: `Invoice ${number}` })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  expect(page.url()).toMatch(PORTAL_INVOICE_PATH);

  // And from the invoice back to its job.
  await page
    .getByRole("link", { name: open.job.jobReference })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/portal/jobs/${open.job.jobId}`), {
    timeout: NAVIGATION_TIMEOUT,
  });
});

test("a download that fails says so in a toast, saves nothing and can be tried again", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make } = await customerWithInvoices("Fiona Failure");
  const invoice = await make();
  const number = invoice.invoiceNumber ?? "";
  await signInAsCustomer(page, customer);
  await openPortalInvoice(page, invoice.id, number);

  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  let attempts = 0;
  await page.route("**/api/v1/invoices/*/pdf", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong on our side. Please try again.",
            requestId: "e2e-request",
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  const button = downloadButton(page);
  await expectHydrated(button);
  await button.click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "The PDF could not be downloaded" }),
  ).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Something went wrong on our side. Please try again.",
  );
  expect(downloads).toBe(0);
  // The page is as it was and the button is ready again.
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await expect(banner(page)).toBeVisible();

  // Trying again works.
  const file = await downloadPdf(page, button);
  expect(file.filename).toBe(`${number}.pdf`);
  expect(file.size).toBeGreaterThan(5_000);
  expect(downloads).toBe(1);
});

test("a printed invoice is the document alone: no sidebar, no top bar, no buttons, no banner", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make, pay } = await customerWithInvoices("Pat Printer");
  const invoice = await make();
  await pay(invoice.id, { amount: "50.00" });
  await signInAsCustomer(page, customer);
  await openPortalInvoice(page, invoice.id, invoice.invoiceNumber ?? "");

  await page.emulateMedia({ media: "print" });

  await expect(invoiceDocument(page)).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.locator("body > div header").first()).toBeHidden();
  await expect(downloadButton(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Print invoice" })).toBeHidden();
  await expect(banner(page)).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await expect(invoiceDocument(page)).toContainText("Payments received");
  await expect(invoiceDocument(page)).toContainText(dollars("50.00"));
});

test.describe("the business downloads the same PDFs (IA-A12)", () => {
  test("an admin downloads an issued invoice's PDF from its page", async ({ page }) => {
    await useViewport(page, 1440);
    const { make } = await customerWithInvoices("Ada Admin");
    const invoice = await make();
    const number = invoice.invoiceNumber ?? "";
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(page.getByRole("heading", { level: 1, name: number })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    const file = await downloadPdf(page);
    expect(file.filename).toBe(`${number}.pdf`);
    const printed = await printedText(file.bytes);
    expect(printed).toContain(number);
    expect(printed).toContain(`Total ${dollars(invoice.job.totals.totalAmount)}`);
    expect(printed).not.toContain("DRAFT");
  });

  test("an admin downloads a draft: watermarked, and named as a draft", async ({ page }) => {
    await useViewport(page, 1440);
    const { make } = await customerWithInvoices("Dora Draft");
    const draft = await make({ status: "DRAFT" });
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${draft.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    const button = downloadButton(page);
    await expectHydrated(button);
    const file = await downloadPdf(page, button);
    expect(file.filename).toBe("invoice-draft.pdf");
    const printed = await printedText(file.bytes);
    expect(printed).toContain("DRAFT");
    expect(printed).toContain("Not numbered yet");
  });

  test("an admin downloads a void invoice's PDF with the VOID watermark, and without the reason", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { make } = await customerWithInvoices("Vic Void");
    const voided = await make({ status: "VOID", voidReason: INTERNAL.voidReason });
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${voided.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: voided.invoiceNumber ?? "" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    const file = await downloadPdf(page);
    expect(file.filename).toBe(`${voided.invoiceNumber ?? ""}.pdf`);
    const printed = await printedText(file.bytes);
    expect(printed).toContain("VOID");
    expect(printed).not.toContain(INTERNAL.voidReason);
  });
});

test("an invoice's PDF is the same document before and after the business changes its details", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make } = await customerWithInvoices("Sam Snapshot");
  const invoice = await make();
  await signInAsCustomer(page, customer);
  await openPortalInvoice(page, invoice.id, invoice.invoiceNumber ?? "");
  const first = await downloadPdf(page);
  const before = await printedText(first.bytes);

  // Someone changes the customer's name and the job's address after the invoice was issued.
  await withDatabase(async (prisma) => {
    await prisma.user.update({
      where: { id: customer.id },
      data: { name: "Someone Else Entirely" },
    });
  });
  const second = await downloadPdf(page);
  expect(await printedText(second.bytes)).toBe(before);
  expect(before).toContain("Sam Snapshot");
  expect(before).not.toContain("Someone Else Entirely");
});
