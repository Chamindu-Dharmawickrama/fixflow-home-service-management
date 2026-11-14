import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { AdminServiceDto } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { ensureSettingsAdmin } from "../fixtures/accounts.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";

/**
 * The T07 screens at the four required widths (spec §17.4): the business settings, the service
 * list, the new-service form and a service's edit page. Each is checked for sideways scrolling and,
 * at the phone width where the layout changes most, for serious accessibility problems; and each is
 * photographed into the git-ignored artifacts folder for the visual review recorded in
 * docs/IMPLEMENTATION_PROGRESS.md. The tests fail only if a page does not render, overflows or is inaccessible.
 */

test.describe.configure({ timeout: 120_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t07");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

async function expectAccessible(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const report = serious
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary ?? ""}`)
          .join("\n"),
    )
    .join("\n");
  expect(serious, report).toEqual([]);
}

/** The id of a seeded service, found through the API as the signed-in admin would. */
async function seededServiceId(page: Page): Promise<string> {
  const response = await page.request.get("/api/v1/admin/services?search=AC%20Routine");
  const { data } = (await response.json()) as { data: AdminServiceDto[] };
  const service = data.find((candidate) => candidate.slug === "ac-routine-maintenance");
  expect(service, "the seeded AC Routine Maintenance service").toBeDefined();
  return (service as AdminServiceDto).id;
}

for (const width of WIDTHS) {
  test.describe(`settings and services at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await useViewport(page, width);
      // The business settings test types into the identity fields, which the shared demo admin cannot
      // change in the public demo (T24, Q-11), so it signs in as an admin who is not a demo account.
      await loginAs(
        page,
        test.info().title === "business settings" ? await ensureSettingsAdmin() : "admin",
      );
    });

    test("business settings", async ({ page }) => {
      await page.goto("/app/settings/business");
      const form = page.getByRole("form", { name: "Business settings" });
      await expect(form).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(form);
      await expectHydrated(page.getByLabel(/^Invoice footer/));

      await expectNoHorizontalOverflow(page);
      if (width === 360) await expectAccessible(page);
      await shoot(page, width, "business-settings");

      // With a change made, the save bar says so.
      await page.getByLabel(/^Tagline/).fill("A tagline that has not been saved");
      await expect(page.getByText("You have unsaved changes.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, width, "business-settings-unsaved");
    });

    test("service list", async ({ page }) => {
      await page.goto("/app/settings/services");
      await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      // The list holds the table (wide screens) and the cards (narrow ones); only one is visible.
      await expect(
        page.getByText("AC Routine Maintenance").and(page.locator(":visible")).first(),
      ).toBeVisible();
      // Wait for React to take over before photographing: a picture taken mid-hydration changes
      // the page under it (the screenshot's own caret styling) and makes the dev server complain.
      await expectHydrated(page.getByRole("search", { name: "Search services" }));

      await expectNoHorizontalOverflow(page);
      if (width === 360) await expectAccessible(page);
      await shoot(page, width, "service-list");

      await page.goto("/app/settings/services?search=no-such-service-anywhere");
      await expect(page.getByRole("heading", { name: "No services match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectHydrated(page.getByRole("search", { name: "Search services" }));
      await expectNoHorizontalOverflow(page);
      await shoot(page, width, "service-list-empty");
    });

    test("new service", async ({ page }) => {
      await page.goto("/app/settings/services/new");
      const form = page.getByRole("form", { name: "New service" });
      await expect(form).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(form);
      await expectHydrated(page.getByLabel(/^Display order/));

      await expectNoHorizontalOverflow(page);
      if (width === 360) await expectAccessible(page);
      await shoot(page, width, "new-service");

      // With every control open: fixed price, an illustration to choose, two inclusions, errors shown.
      await page.getByRole("radio", { name: /Fixed starting price/ }).click();
      await page.getByRole("radio", { name: "One of the illustrations" }).click();
      await page.getByRole("button", { name: "Add inclusion" }).click();
      await page.getByRole("button", { name: "Add inclusion" }).click();
      await page.getByLabel(/^Service name/).fill("AC");
      await page.getByRole("button", { name: "Create service" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "problems to fix" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, width, "new-service-errors");
    });

    test("edit service", async ({ page }) => {
      const id = await seededServiceId(page);
      await page.goto(`/app/settings/services/${id}`);
      const form = page.getByRole("form", { name: "Edit service" });
      await expect(form).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(form);
      await expectHydrated(page.getByLabel(/^Display order/));
      await expect(
        page.getByRole("heading", { level: 1, name: "AC Routine Maintenance" }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page);
      if (width === 360) await expectAccessible(page);
      await shoot(page, width, "edit-service");
    });
  });
}
