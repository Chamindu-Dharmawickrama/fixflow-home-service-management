import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Full-page screenshots of the T05 screens at the narrowest and widest required widths, for the
 * visual review recorded in docs/IMPLEMENTATION_PROGRESS.md. They are written to the git-ignored
 * artifacts folder; the test fails only if a page does not render.
 */

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t05");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

for (const width of [360, 1440]) {
  test.describe(`screens at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await useViewport(page, width);
    });

    test("sign-in, sign-up and recovery pages", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("region", { name: "Demo accounts" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "login");

      await page.getByLabel(/^Email address/).fill("nobody@example.test");
      await page.getByLabel(/^Password/).fill("not the password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.locator('[role="alert"]', { hasText: "Email or password is incorrect" }),
      ).toBeVisible();
      await shoot(page, width, "login-error");

      await page.goto("/register");
      await expect(page.getByRole("form", { name: "Create your account" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "register");
      await page.getByLabel(/^Password/).fill("a long enough passphrase");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(
        page.locator('[role="alert"]', { hasText: "Enter your full name." }),
      ).toBeVisible();
      await shoot(page, width, "register-errors");

      await page.goto("/forgot-password");
      await expect(page.getByRole("form", { name: "Reset your password" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "forgot-password");

      await page.goto("/reset-password");
      await expect(page.getByTestId("reset-invalid")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await shoot(page, width, "reset-password-invalid");
    });

    test("signed-in screens", async ({ page }) => {
      await loginAs(page, "customer");
      await shoot(page, width, "portal");
      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "no-access-customer-on-admin-url");

      await page.context().clearCookies();
      await loginAs(page, "admin");
      await shoot(page, width, "admin-dashboard");
      await page.goto("/app/account");
      await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "admin-account");
    });
  });
}
