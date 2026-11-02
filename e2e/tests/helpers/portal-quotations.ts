import { expect, type Locator, type Page } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../../fixtures/accounts.js";
import {
  businessDay,
  createSentQuotationFor,
  type InsertedQuotation,
} from "../../fixtures/quotations.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "./layout.js";

/** Shared steps of the customer's quotation specs (T15): each is something a person does or sees. */

export const PORTAL_QUOTATION_PATH = /\/portal\/quotations\/[0-9a-f-]{36}$/;

/**
 * Next keeps the page you came from mounted, hidden, after a navigation, so a test id can match two
 * elements. A person only ever sees the visible one.
 */
export const portalBanner = (page: Page): Locator =>
  page.getByTestId("quotation-banner").filter({ visible: true });
export const decisionBar = (page: Page): Locator =>
  page.getByTestId("quotation-decision").filter({ visible: true });
export const confirmation = (page: Page): Locator =>
  page.getByTestId("quotation-confirmation").filter({ visible: true });
export const awaitingDecision = (page: Page): Locator =>
  page.getByRole("region", { name: "Awaiting your decision" });
export const acceptButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Accept quotation", exact: true });
export const declineButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Decline", exact: true });
/** The status badge in the header of the page in front. */
export const pageBadge = (page: Page): Locator =>
  page.locator("main header [data-status]").filter({ visible: true }).first();

export interface CustomerWithQuotation extends InsertedQuotation {
  customer: FixtureAccount;
}

/** A new customer and a quotation the business sent them, valid for `validInDays` more days. */
export async function customerWithQuotation(
  name = "Quinn Quotable",
  options: { validInDays?: number; status?: "SENT" | "VOID" } = {},
): Promise<CustomerWithQuotation> {
  const customer = await createCustomerAccount({ name });
  const inserted = await createSentQuotationFor(customer.id, {
    validUntil: businessDay(options.validInDays ?? 5),
    ...(options.status !== undefined && { status: options.status }),
  });
  return { customer, ...inserted };
}

/** Opens a quotation's page in the portal and waits for it to be drawn. */
export async function openPortalQuotation(
  page: Page,
  quotation: { id: string; reference: string },
) {
  await page.goto(`/portal/quotations/${quotation.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Quotation ${quotation.reference}` }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}

/** Opens a quotation that is waiting for an answer and waits until its buttons will respond. */
export async function openAwaitingQuotation(
  page: Page,
  quotation: { id: string; reference: string },
): Promise<void> {
  await openPortalQuotation(page, quotation);
  await expect(decisionBar(page)).toBeVisible();
  await expectHydrated(acceptButton(page));
}

export async function openPortalRequest(
  page: Page,
  request: { id: string; reference: string },
): Promise<void> {
  await page.goto(`/portal/requests/${request.id}`);
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

/** Presses Accept and confirms in the dialog; returns once the confirmation is on the page. */
export async function acceptThroughDialog(page: Page, reference: string): Promise<void> {
  await acceptButton(page).click();
  const dialog = page.getByRole("alertdialog", { name: `Accept ${reference}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Accept quotation", exact: true }).click();
  await expect(confirmation(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}

/** Presses Decline, optionally says why, and confirms; returns once the confirmation is on the page. */
export async function declineThroughDialog(
  page: Page,
  reference: string,
  reason?: string,
): Promise<void> {
  await declineButton(page).click();
  const dialog = page.getByRole("alertdialog", { name: `Decline ${reference}?` });
  await expect(dialog).toBeVisible();
  if (reason !== undefined) {
    await dialog.getByLabel(/why are you declining/).fill(reason);
  }
  await dialog.getByRole("button", { name: "Decline quotation", exact: true }).click();
  await expect(confirmation(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}
