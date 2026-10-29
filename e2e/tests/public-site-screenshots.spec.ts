import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";

/**
 * The public website (T08) at the four required widths (spec §17.4): the homepage, the service
 * list (also filtered), a service's page and the privacy notice. Each page is checked for sideways
 * scrolling, is scanned for serious accessibility problems, and is photographed into the git-ignored
 * artifacts folder for the visual review recorded in docs/IMPLEMENTATION_PROGRESS.md.
 */

test.describe.configure({ timeout: 120_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t08");

/** The pages of the public website. The slug is a seeded, fixed-price service. */
const PAGES = [
  { name: "home", path: "/", heading: /handled from first request to final invoice/ },
  { name: "services", path: "/services", heading: /^Our services$/ },
  {
    name: "services-filtered",
    path: "/services?category=Air%20conditioning",
    heading: /^Our services$/,
  },
  {
    name: "service-detail",
    path: "/services/ac-routine-maintenance",
    heading: /^AC Routine Maintenance$/,
  },
  {
    name: "service-detail-quote",
    path: "/services/washing-machine-repair",
    heading: /^Washing Machine Repair$/,
  },
  { name: "privacy", path: "/privacy", heading: /^Privacy and demo notice$/ },
] as const;

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

for (const width of WIDTHS) {
  test.describe(`public site at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await useViewport(page, width);
    });

    for (const { name, path, heading } of PAGES) {
      test(`${name}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
          timeout: NAVIGATION_TIMEOUT,
        });
        // The cards stream in behind their own boundary; wait for the content the page is about.
        await expect(page.locator("body [class*='animate-pulse']")).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectAccessible(page);
        await shoot(page, width, name);
      });
    }
  });
}
