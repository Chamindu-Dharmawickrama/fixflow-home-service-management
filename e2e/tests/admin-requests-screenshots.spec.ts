import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createRequestsFor, type InsertedRequest } from "../fixtures/requests.js";
import { loginAs, signOut } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T12 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the queue (populated, no match), a new request, a
 * request under review with notes and history, the cancel dialog, the cancelled request and the
 * customer's view of it. They are written to the git-ignored artifacts folder; the tests fail only
 * if a page does not render.
 */

test.describe.configure({ timeout: 150_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t12");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  // Toasts slide in from the edge; wait for them to go so the picture shows the page.
  // A toast under the pointer stays until the pointer leaves it.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

for (const width of [360, 1440]) {
  test.describe(`at ${width} px`, () => {
    test("the queue: populated, narrowed by a status, and with no match", async ({ page }) => {
      await useViewport(page, width);
      const account = await createCustomerAccount({ name: "Daniela Brooks" });
      await createRequestsFor(account.id, 2, { status: "SUBMITTED", firstAgeMinutes: 600 });
      await createRequestsFor(account.id, 1, {
        status: "UNDER_REVIEW",
        serviceName: "Washing Machine Repair",
        firstAgeMinutes: 2000,
      });
      await createRequestsFor(account.id, 1, {
        status: "QUOTED",
        serviceName: "Electrical Safety Inspection",
        firstAgeMinutes: 4000,
      });
      await createRequestsFor(account.id, 1, {
        status: "CANCELLED",
        serviceName: "Home Deep Cleaning",
        firstAgeMinutes: 9000,
      });
      await loginAs(page, "admin");

      await page.goto("/app/requests");
      await expectHydrated(page.getByRole("search", { name: "Search and filter requests" }));
      await page.getByRole("searchbox", { name: "Search" }).fill(account.email);
      await expect(page.getByText(/Showing 1–5 of 5 requests/)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "queue");

      await page
        .getByRole("navigation", { name: "Filter requests by status" })
        .getByRole("link", { name: /^Submitted/ })
        .click();
      await page.waitForURL(/status=SUBMITTED/, { timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByText(/Showing 1–2 of 2 requests/)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "queue-submitted");

      await page.getByRole("searchbox", { name: "Search" }).fill("nobody-has-this-name");
      await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "queue-no-match");
    });

    test("a new request, one under review with notes and history, and the cancel dialog", async ({
      page,
    }) => {
      await useViewport(page, width);
      const account = await createCustomerAccount({ name: "Marcus Webb" });
      await createRequestsFor(account.id, 1, { status: "CANCELLED", firstAgeMinutes: 20_000 });
      const [request] = (await createRequestsFor(account.id, 1, {
        serviceName: "AC Diagnostic Visit",
      })) as [InsertedRequest];
      await loginAs(page, "admin");

      await page.goto(`/app/requests/${request.id}`);
      await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectHydrated(page.getByRole("form", { name: "Add a note" }));
      await shoot(page, width, "request-new");

      await page.getByRole("button", { name: "Start review" }).click();
      await expect(page.getByRole("main").locator("header [data-status]")).toHaveAttribute(
        "data-status",
        "UNDER_REVIEW",
        { timeout: NAVIGATION_TIMEOUT },
      );
      for (const [text, shared] of [
        ["Called the customer: the unit is a ducted system, about eight years old.", false],
        ["We will bring a spare run capacitor and a contactor to the visit.", true],
      ] as const) {
        await page.getByRole("textbox", { name: /^Note/ }).fill(text);
        if (shared) {
          await page.getByRole("radio", { name: /^Shared with the customer/ }).click();
        }
        await page.getByRole("button", { name: "Add note" }).click();
        await expect(
          page.getByRole("list", { name: "Notes on this request" }).getByText(text),
        ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      }
      await shoot(page, width, "request-under-review");

      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Cancel request" })).toBeVisible();
      await shoot(page, width, "request-menu");
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByLabel(/Reason \(internal\)/).fill("Outside our service area.");
      await dialog
        .getByLabel("Message to the customer")
        .fill("Sorry, we do not cover your street at the moment.");
      await shoot(page, width, "cancel-dialog");
      await dialog.getByRole("button", { name: "Cancel request" }).click();
      await expect(page.getByRole("main").locator("header [data-status]")).toHaveAttribute(
        "data-status",
        "CANCELLED",
        { timeout: NAVIGATION_TIMEOUT },
      );
      await shoot(page, width, "request-cancelled");

      await signOut(page);
      await loginAs(page, account);
      await page.goto(`/portal/requests/${request.id}`);
      await expect(page.getByText("Message from us")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await shoot(page, width, "customer-cancelled");
    });
  });
}
