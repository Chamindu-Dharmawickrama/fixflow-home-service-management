import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  assignJob,
  deleteTechniciansTagged,
  inDays,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T16 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the list (with a busy technician, an idle one and an
 * inactive one), a technician with jobs coming up, the add and edit sheets, the deactivate dialog,
 * an inactive technician and the screen that finds nobody. They are written to the git-ignored
 * artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 150_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t16");

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

async function shoot(page: Page, width: number, name: string): Promise<void> {
  // Toasts slide in from the edge; wait for them to go so the picture shows the page.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

async function team() {
  const tag = newTechnicianTag();
  tags.push(tag);
  const customer = await createCustomerAccount({ name: `Alex Morgan ${tag}` });
  const busy = await insertTechnician(tag, {
    name: `Jordan Lee ${tag}`,
    phone: "(212) 555-0151",
    email: `jordan.lee.${tag}@coolbreeze.test`,
    specialties: ["Air conditioning", "Heat pumps", "Diagnostics"],
    notes: "Senior technician. Takes the diagnostic visits first thing in the morning.",
    calendarColor: "blue",
  });
  const idle = await insertTechnician(tag, {
    name: `Sam Okafor ${tag}`,
    phone: "(212) 555-0162",
    email: `sam.okafor.${tag}@coolbreeze.test`,
    specialties: ["Washing machines", "Dryers", "Electrical safety"],
    calendarColor: "green",
  });
  const inactive = await insertTechnician(tag, {
    name: `Taylor Brooks ${tag}`,
    specialties: ["Deep cleaning"],
    calendarColor: "amber",
    isActive: false,
  });
  // Under way right now: it started an hour ago and the fixture lasts two hours.
  await assignJob(busy.id, customer.id, new Date(Date.now() - 3_600_000), "IN_PROGRESS");
  await assignJob(busy.id, customer.id, inDays(1));
  await assignJob(busy.id, customer.id, inDays(3));
  await assignJob(inactive.id, customer.id, inDays(2));
  return { tag, busy, idle, inactive };
}

for (const width of [360, 1440]) {
  test.describe(`at ${String(width)} px`, () => {
    test("the list, and the screen that finds nobody", async ({ page }) => {
      await useViewport(page, width);
      const { tag } = await team();
      await loginAs(page, "admin");

      await page.goto(`/app/technicians?active=all&q=${tag}`);
      await expect(
        page.getByRole(width >= 1024 ? "table" : "list", { name: "Technicians" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(page.getByRole("button", { name: "Add technician" }));
      await expectHydrated(page.getByRole("searchbox", { name: "Search" }));
      await shoot(page, width, "list");

      await page.goto("/app/technicians?active=all&q=zzz-nobody");
      await expect(
        page.getByRole("heading", { level: 2, name: "No technicians match" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      // Playwright puts a style on the inputs when it takes a picture: let React take hold first.
      await expectHydrated(page.getByRole("searchbox", { name: "Search" }));
      await shoot(page, width, "list-no-match");
    });

    test("a technician with jobs coming up, and the edit sheet", async ({ page }) => {
      await useViewport(page, width);
      const { busy } = await team();
      await loginAs(page, "admin");

      await page.goto(`/app/technicians/${busy.id}`);
      await expect(
        page.getByRole(width >= 768 ? "table" : "list", { name: `Upcoming jobs for ${busy.name}` }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(page.getByRole("button", { name: "Edit", exact: true }));
      await shoot(page, width, "technician");

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: `Edit ${busy.name}` });
      await expect(sheet).toBeVisible();
      await expectHydrated(sheet.getByLabel(/^Name/));
      await shoot(page, width, "edit-sheet");
    });

    test("the add sheet, filled in and with its first error", async ({ page }) => {
      await useViewport(page, width);
      await team();
      await loginAs(page, "admin");

      await page.goto("/app/technicians");
      await expectHydrated(page.getByRole("button", { name: "Add technician" }));
      await page.getByRole("button", { name: "Add technician" }).click();
      const sheet = page.getByRole("dialog", { name: "Add technician" });
      await expect(sheet).toBeVisible();
      await shoot(page, width, "add-sheet-empty");

      await sheet.getByRole("button", { name: "Add technician" }).click();
      await expect(sheet.getByText("Enter the name.", { exact: true })).toBeVisible();
      await shoot(page, width, "add-sheet-error");

      await sheet.getByLabel(/^Name/).fill("Riley Chen");
      await sheet.getByLabel("Phone number").fill("(212) 555-0187");
      await sheet.getByLabel("Add a specialty").fill("Heat pumps");
      await sheet.getByLabel("Add a specialty").press("Enter");
      await sheet.getByLabel("Add a specialty").fill("Gas safety");
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await sheet.getByRole("radio", { name: "Purple" }).check();
      await shoot(page, width, "add-sheet-filled");
    });

    test("the deactivate dialog, and an inactive technician", async ({ page }) => {
      await useViewport(page, width);
      const { busy, inactive } = await team();
      await loginAs(page, "admin");

      await page.goto(`/app/technicians/${busy.id}`);
      await expectHydrated(page.getByRole("button", { name: "Deactivate" }));
      await page.getByRole("button", { name: "Deactivate" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expect(page.getByRole("alertdialog")).toContainText("3 upcoming jobs");
      await shoot(page, width, "deactivate-dialog");

      await page.goto(`/app/technicians/${inactive.id}`);
      await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "technician-inactive");
    });
  });
}
