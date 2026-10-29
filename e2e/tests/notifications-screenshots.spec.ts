import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createNotificationsFor,
  SAMPLE_NOTIFICATIONS,
  userIdFor,
} from "../fixtures/notifications.js";
import { loginAs } from "../support/auth.js";
import { DEMO_ADMIN_EMAIL } from "../support/env.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T06 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the open notification bell (with notifications, and
 * empty) for a customer and for the admin, and the activity-timeline specimens in the styleguide.
 * They are written to the git-ignored artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 90_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t06");

async function shoot(target: Page | Locator, width: number, name: string): Promise<void> {
  const page = "page" in target ? target.page() : target;
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await target.screenshot({ path: resolve(dir, `${name}.png`) });
}

async function openBell(page: Page, name: string | RegExp): Promise<Locator> {
  const bell = page.getByRole("button", { name });
  await expect(bell).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(bell);
  await bell.click();
  const popover = page.getByRole("dialog", { name: "Notifications" });
  // The popover fades in; a picture taken before it finishes shows the page through it.
  await expect(popover).toHaveCSS("opacity", "1");
  return popover;
}

for (const width of [360, 1440]) {
  test.describe(`notification screens at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await useViewport(page, width);
    });

    test("the customer's bell, with notifications and empty", async ({ page }) => {
      const account = await createCustomerAccount({ name: "Alex Morgan" });
      await createNotificationsFor(account.id, SAMPLE_NOTIFICATIONS);
      await loginAs(page, account);

      const popover = await openBell(page, "2 unread notifications");
      await expect(popover.getByRole("link")).toHaveCount(3);
      await shoot(page, width, "customer-bell-open");

      await page.keyboard.press("Escape");
      await popover.waitFor({ state: "hidden" });
      await shoot(page, width, "customer-bell-closed");
    });

    test("the empty bell", async ({ page }) => {
      const account = await createCustomerAccount({ name: "Quiet Customer" });
      await loginAs(page, account);

      const popover = await openBell(page, "Notifications");
      await expect(popover.getByText("You're all caught up")).toBeVisible();
      await shoot(page, width, "customer-bell-empty");
    });

    test("the admin's bell", async ({ page }) => {
      await createNotificationsFor(await userIdFor(DEMO_ADMIN_EMAIL), [
        {
          title: "New request FF-2026-00012",
          message: "Alex Morgan asked for AC Repair.",
          linkPath: "/app/account",
          type: "REQUEST_RECEIVED",
          ageMinutes: 3,
        },
        {
          title: "Quotation QT-2026-00004 was accepted",
          message: "Alex Morgan accepted the quotation.",
          linkPath: "/app/dashboard",
          type: "QUOTATION_ACCEPTED",
          ageMinutes: 200,
        },
      ]);
      await loginAs(page, "admin");

      const popover = await openBell(page, /unread notifications?$/);
      await expect(popover.getByRole("link").first()).toBeVisible();
      await shoot(page, width, "admin-bell-open");
    });

    test("the activity timeline in the styleguide", async ({ page }) => {
      await page.goto("/styleguide");
      const section = page.locator("#data-display");
      await expect(section.getByRole("list", { name: "Staff activity history" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(section.getByRole("list", { name: "Customer request history" })).toBeVisible();
      await shoot(section, width, "activity-timeline");
    });
  });
}
