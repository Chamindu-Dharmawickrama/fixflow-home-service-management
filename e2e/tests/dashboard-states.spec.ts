import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createBookedJobFor, seededTechnician, uniqueFutureDay } from "../fixtures/jobs.js";
import { createSentQuotationFor } from "../fixtures/quotations.js";
import { createRequestsFor } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import { ancientRequestFor, figures, openDashboard, queue } from "./helpers/dashboard.js";
import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { customerWithInvoices, signInAsCustomer } from "./helpers/portal-invoices.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The T23 screens at the four required widths (spec §17.4): no sideways scrolling, nothing that axe
 * rates serious, the grid of figures going five, three, two and one across, a long unbroken name
 * staying inside its card, and pictures for the visual review recorded in
 * docs/IMPLEMENTATION_PROGRESS.md (written to the git-ignored artifacts folder).
 */

test.describe.configure({ timeout: 240_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t23");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

/** How many of the five cards share the first row: the grid's columns. */
async function columnsOfFigures(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('section[aria-label="Key figures"] li > div')];
    const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
    return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 4).length;
  });
}

const EXPECTED_COLUMNS: Record<(typeof WIDTHS)[number], number> = {
  360: 1,
  768: 2,
  1024: 3,
  1440: 5,
};

test("the admin dashboard works at 360, 768, 1024 and 1440 px, and is accessible", async ({
  page,
}) => {
  const customer = await createCustomerAccount({
    name: `Averyveryverylongunbrokencustomernamewithoutanyspaceatall${"x".repeat(60)}`,
  });
  await ancientRequestFor(customer.id);
  await loginAs(page, "admin");

  for (const width of WIDTHS) {
    await useViewport(page, width);
    await openDashboard(page);
    await expect(queue(page)).toBeVisible();

    await expectNoHorizontalOverflow(page);
    expect(await columnsOfFigures(page), `columns at ${String(width)} px`).toBe(
      EXPECTED_COLUMNS[width],
    );
    expect(await seriousViolations(page), `serious axe violations at ${String(width)} px`).toBe("");

    await shoot(page, width, "admin-dashboard");
  }
});

test("a figure's definition panel fits and is accessible at 360 px", async ({ page }) => {
  await useViewport(page, 360);
  await loginAs(page, "admin");
  await openDashboard(page);
  await page.getByRole("button", { name: "About Unpaid balance" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(
    await seriousViolations(page, '[role="dialog"]'),
    "serious axe violations in the panel",
  ).toBe("");
  await shoot(page, 360, "admin-dashboard-definition-open");
});

test("the dashboard can be used from the keyboard: the period, a figure, its definition and an action", async ({
  page,
}) => {
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await openDashboard(page);

  const today = page
    .getByRole("navigation", { name: "Period for new requests" })
    .getByRole("link", { name: "Today" });
  await today.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/range=today$/, { timeout: NAVIGATION_TIMEOUT });

  const info = page.getByRole("button", { name: "About New requests" });
  await info.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(info).toBeFocused();

  const firstCard = figures(page).getByRole("link").first();
  await firstCard.focus();
  await expect(firstCard).toBeFocused();
});

test("the customer's overview works at the four widths, for a busy customer and a new one", async ({
  page,
}) => {
  const { customer, make } = await customerWithInvoices("Olivia Overview Widths");
  await make();
  await createSentQuotationFor(customer.id);
  const jordan = await seededTechnician("Jordan Lee");
  await createBookedJobFor(customer.id, jordan.id, uniqueFutureDay(), "09:00", "11:00");
  await createRequestsFor(customer.id, 2);
  await signInAsCustomer(page, customer);

  for (const width of WIDTHS) {
    await useViewport(page, width);
    await page.goto("/portal");
    await expect(page.getByRole("region", { name: "Action required" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectNoHorizontalOverflow(page);
    expect(await seriousViolations(page), `serious axe violations at ${String(width)} px`).toBe("");
    await shoot(page, width, "portal-overview");
  }
});

test("a new customer's welcome works at the four widths", async ({ page }) => {
  const customer = await createCustomerAccount({ name: "Nina Newcomer Widths" });
  await signInAsCustomer(page, customer);

  for (const width of WIDTHS) {
    await useViewport(page, width);
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectNoHorizontalOverflow(page);
    expect(await seriousViolations(page), `serious axe violations at ${String(width)} px`).toBe("");
    await shoot(page, width, "portal-overview-new-customer");
  }
});

test("the lists with the dashboard's links and the export button work at the four widths", async ({
  page,
}) => {
  await loginAs(page, "admin");
  for (const width of WIDTHS) {
    await useViewport(page, width);
    for (const [path, heading] of [
      ["/app/requests", "Service requests"],
      ["/app/jobs?view=all&status=SCHEDULED,IN_PROGRESS", "Jobs"],
      ["/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE", "Invoices"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `${path} at ${String(width)} px`).toBe("");
    }
  }
  await useViewport(page, 360);
  await page.goto("/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE");
  await expect(page.getByTestId("status-filter-note")).toBeVisible();
  await shoot(page, 360, "invoices-status-filter-note");
});
