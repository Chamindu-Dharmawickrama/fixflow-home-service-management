import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { businessDay, createSentQuotationFor } from "../fixtures/quotations.js";
import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  acceptButton,
  acceptThroughDialog,
  awaitingDecision,
  declineButton,
  declineThroughDialog,
  openAwaitingQuotation,
  openPortalQuotation,
  openPortalRequest,
  pageBadge,
} from "./helpers/portal-quotations.js";

/**
 * Screenshots of the T15 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the overview with a quotation waiting, the quotation,
 * both dialogs, the confirmation, the accepted and declined pages, the expired and withdrawn pages,
 * the request with its quotation card, and the printed document. They are written to the git-ignored
 * artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 180_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t15");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  // Toasts slide in from the edge; wait for them to go so the picture shows the page.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

for (const width of [360, 1440]) {
  test.describe(`at ${width} px`, () => {
    test("the overview, the request and the quotation awaiting an answer", async ({ page }) => {
      await useViewport(page, width);
      const customer = await createCustomerAccount({ name: "Morgan Reyes" });
      const sent = await createSentQuotationFor(customer.id, {
        validUntil: businessDay(5),
        customerNote: "The price assumes the part is in stock. We will confirm before ordering.",
      });
      // A second quotation, for another request, running out sooner: it leads the overview.
      await createSentQuotationFor(customer.id, {
        validUntil: businessDay(1),
        serviceName: "Washing Machine Repair",
      });
      await loginAs(page, customer);

      await page.goto("/portal");
      await expect(awaitingDecision(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await shoot(page, width, "overview-awaiting");

      await openPortalRequest(page, sent.request);
      await expect(page.getByTestId("current-quotation")).toBeVisible();
      await shoot(page, width, "request-with-quotation");

      await openAwaitingQuotation(page, sent.quotation);
      await shoot(page, width, "quotation-awaiting");

      await acceptButton(page).click();
      await expect(
        page.getByRole("alertdialog", { name: `Accept ${sent.quotation.reference}?` }),
      ).toBeVisible();
      await shoot(page, width, "accept-dialog");
      await page.getByRole("button", { name: "Go back" }).click();

      await declineButton(page).click();
      const dialog = page.getByRole("alertdialog", {
        name: `Decline ${sent.quotation.reference}?`,
      });
      await dialog.getByLabel(/why are you declining/).fill("The price is higher than I expected.");
      await shoot(page, width, "decline-dialog");
    });

    test("the confirmation, and the accepted and declined pages", async ({ page }) => {
      await useViewport(page, width);
      const customer = await createCustomerAccount({ name: "Morgan Reyes" });
      const toAccept = await createSentQuotationFor(customer.id, { validUntil: businessDay(5) });
      const toDecline = await createSentQuotationFor(customer.id, { validUntil: businessDay(5) });
      await loginAs(page, customer);

      await openAwaitingQuotation(page, toAccept.quotation);
      await acceptThroughDialog(page, toAccept.quotation.reference);
      await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "confirmation-accepted");
      await page.reload();
      await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED");
      await shoot(page, width, "quotation-accepted");

      await openAwaitingQuotation(page, toDecline.quotation);
      await declineThroughDialog(page, toDecline.quotation.reference, "Found another provider.");
      await expect(pageBadge(page)).toHaveAttribute("data-status", "DECLINED", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "confirmation-declined");
      await openPortalRequest(page, toDecline.request);
      await shoot(page, width, "request-declined");
    });

    test("the expired and the withdrawn quotation, and the request that follows a replacement", async ({
      page,
    }) => {
      await useViewport(page, width);
      const customer = await createCustomerAccount({ name: "Morgan Reyes" });
      const expired = await createSentQuotationFor(customer.id, { validUntil: businessDay(-3) });
      const first = await createSentQuotationFor(customer.id, {
        status: "VOID",
        validUntil: businessDay(10),
      });
      const second = await createSentQuotationFor(customer.id, {
        request: first.request,
        replacesQuotationId: first.quotation.id,
        validUntil: businessDay(7),
      });
      await loginAs(page, customer);

      await openPortalQuotation(page, expired.quotation);
      await shoot(page, width, "quotation-expired");

      await openPortalQuotation(page, first.quotation);
      await shoot(page, width, "quotation-withdrawn");

      await openPortalRequest(page, second.request);
      await expect(page.getByRole("region", { name: "Current quotation" })).toBeVisible();
      await shoot(page, width, "request-with-replacement");
    });
  });
}

test("the printed quotation on A4", async ({ page }) => {
  await page.setViewportSize({ width: 794, height: 1123 });
  const customer = await createCustomerAccount({ name: "Morgan Reyes" });
  const sent = await createSentQuotationFor(customer.id, {
    validUntil: businessDay(5),
    customerNote: "The price assumes the part is in stock.",
  });
  await loginAs(page, customer);
  await openAwaitingQuotation(page, sent.quotation);

  await page.emulateMedia({ media: "print" });

  mkdirSync(resolve(SCREENSHOT_DIR, "print"), { recursive: true });
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "print", "printed.png"),
    fullPage: true,
  });
});
