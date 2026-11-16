import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import {
  createInvoiceFor,
  createJobFor,
  newPhone,
  newTag,
  profileIdOf,
  setPhone,
} from "../fixtures/customers.js";
import { createRequestsFor } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T13 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the directory (populated, with no match), a customer
 * with a full history (each tab), the internal notes, and a customer with nothing yet. They are
 * written to the git-ignored artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 150_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t13");

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
    test("the directory: populated, and with no match", async ({ page }) => {
      await useViewport(page, width);
      const tag = newTag();
      const names = ["Imogen", "Desmond", "Marisol"].map((first) => `${first} Hartley ${tag}`);
      for (const name of names) {
        const account = await createCustomerAccount({ name });
        await setPhone(account.id, newPhone().text);
        await createAddressesFor(account.id, [
          { label: "Home", city: name.startsWith("Imogen") ? "Harbor City" : "Port Elm" },
        ]);
        await createRequestsFor(account.id, name.startsWith("Marisol") ? 0 : 2);
      }
      const owing = await createCustomerAccount({ name: `Priya Hartley ${tag}` });
      await createInvoiceFor(owing.id, {
        status: "PARTIALLY_PAID",
        total: "216.00",
        paid: "100.50",
      });
      await createJobFor(owing.id, { status: "IN_PROGRESS" });
      await loginAs(page, "admin");

      await page.goto("/app/customers");
      await expectHydrated(page.getByRole("search", { name: "Search customers" }));
      // The box itself, not only the form around it (see admin-requests-screenshots.spec.ts).
      await expectHydrated(page.getByRole("searchbox", { name: "Search" }));
      await page.getByRole("searchbox", { name: "Search" }).fill(`Hartley ${tag}`);
      await expect(page.getByText(/Showing 1–4 of 4 customers/)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "directory");

      await page.getByRole("searchbox", { name: "Search" }).fill("nobody-has-this-name");
      await expect(page.getByRole("heading", { name: "No customers match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "directory-no-match");
    });

    test("a customer with a full history: the page, each tab, and the notes", async ({ page }) => {
      await useViewport(page, width);
      const account = await createCustomerAccount({ name: "Alexandra Brightwell" });
      await setPhone(account.id, "(212) 555-0142");
      await createAddressesFor(account.id, [
        {
          label: "Home",
          line1: "214 Larkspur Lane",
          line2: "Unit 4",
          accessNotes: "Gate code 4821.\nDog in the yard, please close the gate.",
        },
        { label: "Rental flat", line1: "9 Quay Street", city: "Port Elm", postalCode: "20002" },
      ]);
      await createRequestsFor(account.id, 2, { status: "UNDER_REVIEW", firstAgeMinutes: 4000 });
      await createJobFor(account.id, {
        status: "SCHEDULED",
        scheduledStart: new Date(Date.now() + 4 * 86_400_000),
      });
      await createJobFor(account.id, { status: "PENDING_SCHEDULING" });
      await createInvoiceFor(account.id, {
        status: "PARTIALLY_PAID",
        total: "216.00",
        paid: "100.50",
      });
      await createInvoiceFor(account.id, { status: "OVERDUE", total: "54.00" });
      await createInvoiceFor(account.id, { status: "PAID", total: "180.00", paid: "180.00" });
      await createInvoiceFor(account.id, { status: "DRAFT", total: "77.00" });
      await loginAs(page, "admin");

      const profileId = await profileIdOf(account.id);
      await page.goto(`/app/customers/${profileId}`);
      await expect(page.getByRole("form", { name: "Add an internal note" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectHydrated(page.getByRole("form", { name: "Add an internal note" }));
      await expect(
        page
          .getByRole("table", { name: "Requests" })
          .or(page.getByRole("list", { name: "Requests" })),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "customer-requests");

      for (const tab of ["quotations", "jobs", "invoices"] as const) {
        await page.goto(`/app/customers/${profileId}?tab=${tab}`);
        await expect(
          page
            .getByRole("table", { name: new RegExp(tab, "i") })
            .or(page.getByRole("list", { name: new RegExp(tab, "i") })),
        ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
        await shoot(page, width, `customer-${tab}`);
      }

      await expectHydrated(page.getByRole("form", { name: "Add an internal note" }));
      await page
        .getByRole("textbox", { name: /^Note/ })
        .fill("Prefers a call after 5pm. Do not text.");
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(
        page.getByRole("list", { name: "Internal notes about this customer" }),
      ).toContainText("Prefers a call after 5pm.", { timeout: NAVIGATION_TIMEOUT });
      await page
        .getByRole("textbox", { name: /^Note/ })
        .fill("Second visit: bring the long ladder.");
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(
        page.getByRole("list", { name: "Internal notes about this customer" }),
      ).toContainText("bring the long ladder", { timeout: NAVIGATION_TIMEOUT });
      await shoot(page, width, "customer-notes");
    });

    test("a customer with nothing yet", async ({ page }) => {
      await useViewport(page, width);
      const account = await createCustomerAccount({ name: "Nikolai Voss" });
      await loginAs(page, "admin");

      const profileId = await profileIdOf(account.id);
      await page.goto(`/app/customers/${profileId}?tab=quotations`);
      await expect(page.getByRole("heading", { level: 3, name: "No quotations yet" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "customer-empty");
    });
  });
}
