import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

import { loginAs } from "../support/auth.js";
import { blocks, openCalendar } from "../tests/helpers/calendar.js";
import { NAVIGATION_TIMEOUT } from "../tests/helpers/layout.js";

/**
 * The six documentation screenshots (T27, spec §22.2), taken from the real running application on the
 * showcase data and written to `docs/screenshots/` in this order:
 *
 *   1. the business dashboard           4. a work order (a job in progress)
 *   2. the public services page         5. a printable invoice
 *   3. a quotation awaiting approval    6. the customer portal on a phone
 *
 * plus a seventh, an extra: the calendar's busiest week (07). The showcase has few visits in any week, so
 * the calendar is a supplement to the work order, not the fourth picture.
 *
 * Reproducible: `npm run screenshots` (see `playwright.screenshots.config.ts` for the local and the hosted
 * mode). Every picture signs in through the real form with a published demo account and finds its page by
 * clicking, so nothing here needs a database. One desktop viewport (1440 × 900) and one phone (390 × 844 at
 * twice the density) are used throughout, and none of the six pages shows a password or a secret: the
 * sign-in page, whose demo panel prints the published passwords, is never photographed.
 */

const OUT_DIR = resolve(import.meta.dirname, "../../docs/screenshots");
const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

test.describe.configure({ mode: "serial", timeout: 300_000 });

async function newContext(
  browser: Browser,
  baseURL: string | undefined,
  kind: "desktop" | "phone",
): Promise<BrowserContext> {
  return browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(kind === "desktop"
      ? { viewport: DESKTOP, deviceScaleFactor: 1 }
      : { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }),
    // A fixed language and clock zone for the browser; the business's own zone comes from its settings.
    locale: "en-US",
  });
}

/** Waits until the page is still: data loaded, fonts ready, no toast, no animation under way. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  // The development server's own badge is not part of the product.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Pictures on the first screen (the service photographs are optimised on first use and fade in).
  await page.waitForFunction(
    () =>
      [...document.images]
        .filter((image) => {
          const box = image.getBoundingClientRect();
          return box.bottom > 0 && box.top < window.innerHeight;
        })
        .every((image) => image.complete && image.naturalWidth > 0),
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

async function shoot(
  page: Page,
  file: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await settle(page);
  mkdirSync(OUT_DIR, { recursive: true });
  if (options.fullPage !== true) {
    await page.screenshot({ path: resolve(OUT_DIR, file) });
    return;
  }
  // The whole page: the window is made as tall as the page, rather than asking for a "full page" capture,
  // so that a sidebar that fills the window's height fills the picture's height too.
  const viewport = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport?.width ?? DESKTOP.width, height });
  await settle(page);
  await page.screenshot({ path: resolve(OUT_DIR, file) });
  await page.setViewportSize(viewport ?? DESKTOP);
}

/**
 * Opens the public services page and waits until it shows the services. The public pages read the API
 * through a cache, and a read that failed while the servers were still starting is kept for a moment, so
 * a "can't show our services" notice is reloaded away rather than photographed.
 */
async function openServices(page: Page): Promise<void> {
  const filter = page.getByRole("navigation", { name: "Filter services by category" });
  const unavailable = page.getByRole("heading", { name: /We can't show our services/ });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1, name: "Our services" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    // The list streams in after the heading: wait for it, or for the notice that replaces it.
    await expect(filter.or(unavailable)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    if (await filter.isVisible()) {
      await expect(page.getByRole("link", { name: /AC Diagnostic Visit/ }).first()).toBeVisible();
      return;
    }
    await page.waitForTimeout(3_000);
  }
  throw new Error("The public services page never showed the services.");
}

/**
 * Opens the calendar's week with the most visits among this week, the three before it and the one
 * after (a tie goes to the latest), so the picture is of a busy week and never of an empty one: the
 * showcase is dated from the day it was loaded, and a weekend's own week can be nearly empty.
 */
async function openBusiestWeek(page: Page): Promise<void> {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  let best = { count: -1, query: "" };
  for (const offset of [1, 0, -1, -2, -3]) {
    const date = new Date(Date.now() + offset * WEEK).toISOString().slice(0, 10);
    const query = `view=week&date=${date}`;
    await openCalendar(page, query);
    const count = await blocks(page).count();
    console.info(`calendar week of ${date}: ${String(count)} visit blocks`);
    if (count > best.count) {
      best = { count, query };
    }
  }
  await openCalendar(page, best.query);
}

test("1 and 2: the public services page, then the business dashboard", async ({
  browser,
  baseURL,
}) => {
  // The public page first, in a context that has never signed in.
  const visitor = await newContext(browser, baseURL, "desktop");
  const publicPage = await visitor.newPage();
  await openServices(publicPage);
  await shoot(publicPage, "02-public-services.png");
  await visitor.close();

  const admin = await newContext(browser, baseURL, "desktop");
  const page = await admin.newPage();
  await loginAs(page, "admin");
  await page.goto("/app/dashboard");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening),/ }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("region", { name: "Key figures" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Needs attention" })).toBeVisible();
  await shoot(page, "01-business-dashboard.png");

  // 4: a finished job waiting for its invoice, the work-order detail: its progress, appointment, scope,
  // what was done and its history (a job started today would carry the hour the data was loaded).
  await page.goto("/app/jobs?view=ready-to-invoice");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await page
    .getByRole("main")
    .getByRole("link", { name: /JOB-\d{4}-\d{5}/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /^JOB-/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(
    page
      .getByRole("link", { name: "Create invoice" })
      .or(page.getByRole("button", { name: "Create invoice" }))
      .first(),
  ).toBeVisible();
  await shoot(page, "04-work-order-detail.png", { fullPage: true });

  // 7 (an extra, beside the six): the calendar's busiest week.
  await openBusiestWeek(page);
  await expect(blocks(page).first()).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  // The whole page when a visit sits below the first screen, so no visit is cut off.
  const visitBelowTheFold = await blocks(page).evaluateAll((elements) =>
    elements.some((element) => element.getBoundingClientRect().bottom > window.innerHeight),
  );
  await shoot(page, "07-job-calendar-week.png", { fullPage: visitBelowTheFold });
  await admin.close();
});

test("3 and 5: a quotation awaiting approval and an invoice, as the customer sees them", async ({
  browser,
  baseURL,
}) => {
  const context = await newContext(browser, baseURL, "desktop");
  const page = await context.newPage();
  await loginAs(page, "customer");

  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await page
    .getByRole("region", { name: "Awaiting your decision" })
    .getByRole("link", { name: /Review quotation/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /^Quotation QT-/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: "Accept quotation", exact: true })).toBeVisible();
  // The whole page: the document, its total and the decision bar below it are the point.
  await shoot(page, "03-quotation-approval.png", { fullPage: true });

  await page.goto("/portal/invoices");
  await expect(page.getByRole("heading", { level: 1, name: "Your invoices" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await page
    .getByTestId("portal-invoice-card")
    .filter({ visible: true })
    .first()
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /^Invoice INV-/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: /Download PDF/ })).toBeVisible();
  // The whole page: the document, the totals and how to pay.
  await shoot(page, "05-printable-invoice.png", { fullPage: true });
  await context.close();
});

test("6: the customer portal on a phone", async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL, "phone");
  const page = await context.newPage();
  await loginAs(page, "customer");
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("region", { name: "Awaiting your decision" })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, "the phone view scrolls sideways").toBe(true);
  await shoot(page, "06-customer-portal-mobile.png");
  await context.close();
});
