import { expect, type Locator, type Page } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../../fixtures/accounts.js";
import { quotationsOf } from "../../fixtures/quotations.js";
import { createRequestsFor, type InsertedRequest } from "../../fixtures/requests.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "./layout.js";

/** Shared steps of the quotation specs (T14): each is something a person does on the screens. */

export const QUOTATION_PATH = /\/app\/quotations\/[0-9a-f-]{36}$/;
export const INTERNAL_REASON = "Priced the wrong unit: the internal margin was far too low.";

/** The three lines of the worked example in D-19 (subtotal 252.00, taxable 45.50). */
export const LINES = [
  { description: "Diagnostic visit", quantity: "1", unitPrice: "79.00", taxable: false },
  { description: "Run capacitor", quantity: "1", unitPrice: "45.50", taxable: true },
  { description: "Labour", quantity: "1.5", unitPrice: "85.00", taxable: false },
] as const;

export type LineValues = (typeof LINES)[number];

export const line = (page: Page, n: number): Locator =>
  page.getByRole("group", { name: `Line ${n}` });
export const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole("button", { name, exact: typeof name === "string" });
export const totalsCard = (page: Page): Locator =>
  page.getByRole("heading", { name: "Totals", level: 2 }).locator("xpath=ancestor::div[2]");
/**
 * Next keeps the page you came from mounted, hidden, after a navigation, so a test id can match two
 * elements. A person only ever sees the visible one.
 */
export const banner = (page: Page): Locator =>
  page.getByTestId("quotation-banner").filter({ visible: true });
export const quotationDocument = (page: Page): Locator =>
  page.getByTestId("quotation-document").filter({ visible: true });
export const toast = (page: Page, text: string): Locator =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });
/** The status badge in the header of a request or quotation page. */
export const headerBadge = (page: Page): Locator =>
  page.locator("main header [data-status]").first();

export async function customerWithRequest(
  name = "Quinn Quotable",
  options: { status?: "UNDER_REVIEW" | "SUBMITTED"; serviceName?: string } = {},
): Promise<{ customer: FixtureAccount; request: InsertedRequest }> {
  const customer = await createCustomerAccount({ name });
  const [request] = await createRequestsFor(customer.id, 1, {
    status: options.status ?? "UNDER_REVIEW",
    ...(options.serviceName !== undefined && { serviceName: options.serviceName }),
  });
  if (request === undefined) throw new Error("No request was created.");
  return { customer, request };
}

export async function openRequest(page: Page, request: InsertedRequest): Promise<void> {
  await page.goto(`/app/requests/${request.id}`);
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("form", { name: "Add a note" }));
}

export async function expectEditor(page: Page): Promise<void> {
  await expect(page).toHaveURL(QUOTATION_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: /^Quotation QT-/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const form = page.getByRole("form", { name: "Quotation draft" });
  await expect(form).toBeVisible();
  await expectHydrated(form);
  // The last field to hydrate, so a screenshot or a keystroke is never ahead of the page.
  await expectHydrated(page.getByLabel("Note for the customer"));
}

/** "Create quotation" on the request page, then the editor it opens. */
export async function createDraft(page: Page, request: InsertedRequest): Promise<void> {
  await openRequest(page, request);
  await button(page, "Create quotation").click();
  await expectEditor(page);
}

export async function openQuotation(page: Page, id: string): Promise<void> {
  await page.goto(`/app/quotations/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Quotation QT-/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

export async function referenceOnPage(page: Page): Promise<string> {
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  return heading.replace(/^Quotation\s+/, "").trim();
}

async function setTaxable(row: Locator, taxable: boolean): Promise<void> {
  const box = row.getByRole("checkbox", { name: "Taxable" });
  if ((await box.getAttribute("aria-checked")) !== String(taxable)) {
    await box.click();
  }
  await expect(box).toHaveAttribute("aria-checked", String(taxable));
}

/** Types one line into the editor, the way a person would. */
export async function fillLine(page: Page, n: number, values: LineValues): Promise<void> {
  const row = line(page, n);
  await row.getByLabel("Description").fill(values.description);
  await row.getByLabel("Quantity").fill(values.quantity);
  await row.getByLabel(/^Unit price/).fill(values.unitPrice);
  await setTaxable(row, values.taxable);
}

/**
 * The worked example of D-19 as the editor's first three rows, at a tax rate of 8 per cent so the
 * figures do not depend on what the business settings say. Starts from a fresh draft (one row).
 */
export async function fillWorkedExample(page: Page, discount = "0"): Promise<void> {
  await fillLine(page, 1, LINES[0]);
  for (const index of [1, 2] as const) {
    await button(page, "Add line").click();
    await expect(line(page, index + 1)).toBeVisible();
    await fillLine(page, index + 1, LINES[index]);
  }
  await page.getByLabel(/^Discount/).fill(discount);
  await page.getByLabel("Tax rate (%)").fill("8.00");
}

export async function saveDraft(page: Page): Promise<void> {
  await button(page, "Save draft").click();
  await expect(toast(page, "Draft saved")).toBeVisible();
  await expect(page.getByText("All changes are saved.")).toBeVisible();
}

export async function sendThroughDialog(page: Page): Promise<void> {
  await button(page, "Send to customer…").click();
  const dialog = page.getByRole("alertdialog", { name: /^Send QT-/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Send to customer", exact: true }).click();
  await expect(page.getByRole("form", { name: "Quotation draft" })).toHaveCount(0, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(banner(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}

/** A draft with the worked-example lines, saved and sent. Leaves the browser on the read-only page. */
export async function sendWorkedExample(page: Page, request: InsertedRequest, discount = "0") {
  await createDraft(page, request);
  await fillWorkedExample(page, discount);
  await saveDraft(page);
  await sendThroughDialog(page);
  const [sent] = await quotationsOf(request.id);
  if (sent === undefined) throw new Error("The quotation was not stored.");
  return sent;
}

/** Voids through the "More actions" menu and the reason dialog. */
export async function voidThroughDialog(
  page: Page,
  { reason, message }: { reason: string; message?: string },
): Promise<void> {
  await button(page, "More actions").click();
  await page.getByRole("menuitem", { name: "Void quotation" }).click();
  const dialog = page.getByRole("alertdialog", { name: /^Void QT-/ });
  await dialog.getByLabel(/Reason \(internal\)/).fill(reason);
  if (message !== undefined) {
    await dialog.getByLabel("Message to the customer").fill(message);
  }
  await dialog.getByRole("button", { name: "Void quotation", exact: true }).click();
}
