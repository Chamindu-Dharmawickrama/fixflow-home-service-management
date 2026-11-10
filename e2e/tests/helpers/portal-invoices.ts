import { readFileSync, statSync } from "node:fs";

import { type Download, expect, type Locator, type Page } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../../fixtures/accounts.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  insertPaymentFor,
} from "../../fixtures/invoices.js";
import { loginAs } from "../../support/auth.js";
import { NAVIGATION_TIMEOUT } from "./layout.js";

/** Shared steps of the customer's invoice specs (T22): each is something a person does or sees. */

export const PORTAL_INVOICE_PATH = /\/portal\/invoices\/[0-9a-f-]{36}$/;

/** Words only the business may know: none may appear anywhere a customer can see. */
export const INTERNAL = {
  paymentReference: "TRF-INTERNAL-LEDGER-7731",
  paymentNotes: "Chase the landlord about the second instalment",
  paymentVoidReason: "Entered twice by mistake: ignore the first one",
  voidReason: "Raised for the wrong visit: internal margin far too low.",
  recorder: "Morgan Reyes",
} as const;

/**
 * Next keeps the page you came from mounted, hidden, after a navigation, so a test id can match two
 * elements. A person only ever sees the visible one.
 */
export const banner = (page: Page): Locator =>
  page.getByTestId("portal-invoice-banner").filter({ visible: true });
export const invoiceDocument = (page: Page): Locator =>
  page.getByTestId("invoice-document").filter({ visible: true });
export const documentPayments = (page: Page): Locator =>
  page.getByTestId("invoice-document-payments").filter({ visible: true });
export const downloadButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Download PDF" }).filter({ visible: true });
/** The status badge in the header of the page in front. */
export const pageBadge = (page: Page): Locator =>
  page.locator("main header [data-status]").filter({ visible: true }).first();

export type StoredInvoice = Awaited<ReturnType<typeof insertInvoiceFor>> & {
  job: Awaited<ReturnType<typeof createCompletedJobWithQuote>>;
};

/** A new customer who can sign in, and a way to give them invoices in any state. */
export async function customerWithInvoices(name = "Dana Customer") {
  const customer: FixtureAccount = await createCustomerAccount({ name });
  const make = async (
    options: Parameters<typeof insertInvoiceFor>[2] = {},
  ): Promise<StoredInvoice> => {
    const job = await createCompletedJobWithQuote(customer.id);
    const invoice = await insertInvoiceFor(job, customer.id, {
      status: "ISSUED",
      issueDate: "2026-11-02",
      dueDate: "2999-01-01",
      ...options,
    });
    return { ...invoice, job };
  };
  return { customer, make, pay: insertPaymentFor };
}

export async function signInAsCustomer(page: Page, customer: FixtureAccount): Promise<void> {
  await loginAs(page, { email: customer.email, password: customer.password });
}

export async function openPortalInvoice(page: Page, id: string, number: string): Promise<void> {
  await page.goto(`/portal/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Invoice ${number}` })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

/** Presses "Download PDF" and returns the file the browser saved. */
export async function downloadPdf(page: Page, button: Locator = downloadButton(page)) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  return savedFile(download);
}

export async function savedFile(download: Download) {
  const path = await download.path();
  const bytes = readFileSync(path);
  return {
    download,
    path,
    bytes,
    filename: download.suggestedFilename(),
    size: statSync(path).size,
  };
}

/** `$1,284.50`-style text of a decimal string, as the app prints it (the amounts here stay under 1,000). */
export const dollars = (amount: string): string => `$${amount}`;
