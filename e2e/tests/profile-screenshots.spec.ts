import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T10 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the profile with addresses, with none, the add and
 * edit dialogs, the delete confirmation, and the portal home summary. They are written to the
 * git-ignored artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 90_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t10");

async function shoot(page: Page, width: number, name: string, fullPage = true): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage });
}

async function openProfile(page: Page, addresses: Parameters<typeof createAddressesFor>[1]) {
  const account = await createCustomerAccount({ name: "Alex Morgan" });
  if (addresses.length > 0) await createAddressesFor(account.id, addresses);
  await loginAs(page, account);
  return account;
}

async function gotoProfile(page: Page): Promise<void> {
  await page.goto("/portal/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const form = page.getByRole("form", { name: "Contact details" });
  await expectHydrated(form);
  // The last control of the page: when it is interactive, the whole page has hydrated.
  await expectHydrated(page.getByLabel(/^Phone number/));
}

const ADDRESSES = [
  {
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: "Apt 2B",
    city: "Harbor City",
    postalCode: "10999",
    accessNotes:
      "Buzz apartment 2B. There is a friendly dog in the flat, so please keep the door closed.",
  },
  { label: "Rental unit", line1: "73 Millrace Court", city: "Harbor City", postalCode: "10998" },
  { label: "Office", line1: "9 Dock Street", city: "Harbor City", postalCode: "10001" },
];

async function opaque(locator: Locator): Promise<void> {
  // Dialogs fade in; a picture taken mid-fade shows the page through them.
  await expect(locator).toHaveCSS("opacity", "1");
}

for (const width of [360, 1440]) {
  test.describe(`profile screens at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await useViewport(page, width);
    });

    test("the profile with addresses", async ({ page }) => {
      await openProfile(page, ADDRESSES);
      await gotoProfile(page);
      await expect(page.getByRole("heading", { level: 3, name: "Rental unit" })).toBeVisible();
      await shoot(page, width, "profile");
    });

    test("the profile with no address", async ({ page }) => {
      await openProfile(page, []);
      await gotoProfile(page);
      await expect(page.getByRole("heading", { name: "No saved addresses yet" })).toBeVisible();
      await shoot(page, width, "profile-empty");
    });

    test("the add dialog, with its error summary", async ({ page }) => {
      await openProfile(page, ADDRESSES);
      await gotoProfile(page);
      await page.getByRole("button", { name: "Add address" }).click();
      const dialog = page.getByRole("dialog", { name: "Add an address" });
      await opaque(dialog);
      await shoot(page, width, "dialog-add", false);
      await dialog.getByRole("button", { name: "Save address" }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: "Enter the label." })).toBeVisible();
      await shoot(page, width, "dialog-add-errors", false);
    });

    test("the edit dialog and the delete confirmation", async ({ page }) => {
      await openProfile(page, ADDRESSES);
      await gotoProfile(page);
      await page.getByRole("button", { name: "Edit Home" }).click();
      const edit = page.getByRole("dialog", { name: "Edit “Home”" });
      await opaque(edit);
      await shoot(page, width, "dialog-edit", false);
      await page.keyboard.press("Escape");
      await expect(edit).toBeHidden();

      await page.getByRole("button", { name: "Delete Home" }).click();
      const confirm = page.getByRole("alertdialog");
      await opaque(confirm);
      await shoot(page, width, "dialog-delete", false);
    });

    test("the portal home with the profile summary", async ({ page }) => {
      await openProfile(page, ADDRESSES);
      await page.goto("/portal");
      await expect(page.getByRole("heading", { level: 2, name: "Your profile" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "portal-home");
    });
  });
}
