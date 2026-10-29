import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Accessibility gate for the authentication screens (T05): axe-core with the WCAG 2.2 AA rule
 * set must find no serious or critical violation. Pages are scanned once their form has loaded,
 * and the sign-in page is scanned with the demo-accounts panel showing (demo mode is on).
 */

test.describe.configure({ timeout: 90_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

function describeViolations(violations: Awaited<ReturnType<typeof seriousViolations>>): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map(
            (node) =>
              `    ${node.target.join(" ")}\n      ${node.failureSummary?.split("\n").join(" ")}`,
          )
          .join("\n"),
    )
    .join("\n");
}

async function expectAccessible(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const violations = await seriousViolations(page);
  expect(violations, describeViolations(violations)).toEqual([]);
}

const PUBLIC_AUTH_PAGES = [
  { name: "/login", path: "/login", ready: { level: 1, name: "Sign in" } },
  { name: "/register", path: "/register", ready: { level: 1, name: "Create your account" } },
  {
    name: "/forgot-password",
    path: "/forgot-password",
    ready: { level: 1, name: "Reset your password" },
  },
  {
    name: "/reset-password (no link)",
    path: "/reset-password",
    ready: { level: 1, name: "Choose a new password" },
  },
  {
    name: "/reset-password (with a link)",
    path: "/reset-password?token=axe-scan-placeholder",
    ready: { level: 1, name: "Choose a new password" },
  },
] as const;

test.describe("authentication pages (axe)", () => {
  for (const width of [360, 1440]) {
    for (const entry of PUBLIC_AUTH_PAGES) {
      test(`${entry.name} at ${width}px`, async ({ page }) => {
        await useViewport(page, width);
        await page.goto(entry.path);
        await expect(page.getByRole("heading", entry.ready)).toBeVisible({
          timeout: NAVIGATION_TIMEOUT,
        });
        // Wait for the form (or the invalid-link state) below the skeleton.
        await expect(page.locator("form, [data-testid='reset-invalid']").first()).toBeVisible();

        await expectAccessible(page);
      });
    }
  }

  test("/login with the demo panel, password shown and an error displayed", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/login");
    await expect(page.getByRole("region", { name: "Demo accounts" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page.getByRole("button", { name: "Show password" }).click();
    await page.getByLabel(/^Email address/).fill("nobody@example.test");
    await page.getByLabel(/^Password/).fill("not the right one");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.locator('[role="alert"]', { hasText: "Email or password is incorrect" }),
    ).toBeVisible();

    await expectAccessible(page);
  });

  test("/register with validation errors showing", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/register");
    await expect(page.getByRole("form", { name: "Create your account" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.locator('[role="alert"]', { hasText: "Enter your full name." }),
    ).toBeVisible();

    await expectAccessible(page);
  });
});

test.describe("signed-in screens (axe)", () => {
  test("the admin dashboard and account page", async ({ page }) => {
    await useViewport(page, 1440);
    await loginAs(page, "admin");
    await expectAccessible(page);

    await page.goto("/app/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectAccessible(page);
  });

  test("the customer portal at 360px", async ({ page }) => {
    await useViewport(page, 360);
    await loginAs(page, "customer");

    await expectAccessible(page);
  });

  test("the 'no access' page a customer sees on an admin URL", async ({ page }) => {
    await useViewport(page, 1440);
    await loginAs(page, "customer");
    await page.goto("/app/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    await expectAccessible(page);
  });
});
