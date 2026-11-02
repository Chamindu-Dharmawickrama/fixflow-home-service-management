import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";

/**
 * The design system's visual and accessibility gate (T04). Every page here is a dev-only example
 * route; each is checked for sideways scrolling at the four required widths and screenshotted for
 * the visual review recorded in docs/IMPLEMENTATION_PROGRESS.md.
 */

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t04");

interface Example {
  name: string;
  path: string;
  /** Text that proves the page rendered (a heading), so a 500 page cannot pass. */
  heading: RegExp | string;
}

const EXAMPLES: Example[] = [
  { name: "styleguide", path: "/styleguide", heading: "FixFlow styleguide" },
  {
    name: "shell-public-home",
    path: "/styleguide/shells/public",
    heading: /Home repairs and servicing/,
  },
  {
    name: "shell-public-services",
    path: "/styleguide/shells/public/services",
    heading: "Our services",
  },
  {
    name: "shell-public-service-detail",
    path: "/styleguide/shells/public/services/ac-routine-maintenance",
    heading: "AC Routine Maintenance",
  },
  {
    name: "shell-public-how-it-works",
    path: "/styleguide/shells/public/how-it-works",
    heading: "How it works",
  },
  { name: "shell-auth-login", path: "/styleguide/shells/auth", heading: "Sign in" },
  {
    name: "shell-auth-register",
    path: "/styleguide/shells/auth/register",
    heading: "Create your account",
  },
  { name: "shell-admin-dashboard", path: "/styleguide/shells/admin", heading: "Dashboard" },
  {
    name: "shell-admin-requests",
    path: "/styleguide/shells/admin/requests",
    heading: "Service requests",
  },
  {
    name: "shell-admin-request-detail",
    path: "/styleguide/shells/admin/requests/detail",
    heading: "AC Diagnostic Visit",
  },
  { name: "shell-admin-section", path: "/styleguide/shells/admin/invoices", heading: "Invoices" },
  { name: "shell-portal-overview", path: "/styleguide/shells/portal", heading: "Hello, Morgan" },
  {
    name: "shell-portal-quotation",
    path: "/styleguide/shells/portal/quotation",
    heading: "Quotation for AC Diagnostic Visit",
  },
  {
    name: "shell-portal-invoice",
    path: "/styleguide/shells/portal/invoice",
    heading: "Invoice for AC Diagnostic Visit",
  },
];

/** Next.js shows a round dev-tools badge in development; it is not part of the product. */
const HIDE_DEV_TOOLS = "nextjs-portal { display: none !important; }";

const SECTION_IDS = [
  "colour",
  "typography",
  "spacing",
  "brand",
  "buttons",
  "form-controls",
  "form-validation",
  "status",
  "data-display",
  "patterns",
  "overlays",
  "states",
  "shells",
];

async function open(page: Page, example: Example): Promise<void> {
  await page.goto(example.path);
  await expect(page.getByRole("heading", { level: 1, name: example.heading })).toBeVisible();
}

test.describe("responsive layout (no horizontal overflow, with screenshots)", () => {
  test.describe.configure({ timeout: 90_000 });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  for (const width of WIDTHS) {
    for (const example of EXAMPLES) {
      test(`${example.name} at ${width}px`, async ({ page }) => {
        await useViewport(page, width);
        await open(page, example);
        await expectNoHorizontalOverflow(page);

        // Hydration and fonts are settled before the picture is taken.
        await expectHydrated(page.locator("main a, main button, header button, header a"));
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: resolve(SCREENSHOT_DIR, `${width}`, `${example.name}.png`),
          fullPage: true,
          animations: "disabled",
          style: HIDE_DEV_TOOLS,
        });

        // The styleguide is too tall to judge in one picture, so each section is saved as well.
        if (example.name === "styleguide") {
          for (const id of SECTION_IDS) {
            await page.locator(`section#${id}`).screenshot({
              path: resolve(SCREENSHOT_DIR, `${width}`, "sections", `${id}.png`),
              animations: "disabled",
              style: HIDE_DEV_TOOLS,
            });
          }
        }
      });
    }
  }
});

test.describe("styleguide content", () => {
  test.describe.configure({ timeout: 90_000 });

  test("renders every section", async ({ page }) => {
    await open(page, EXAMPLES[0] as Example);
    for (const id of SECTION_IDS) {
      await expect(page.locator(`section#${id}`)).toHaveCount(1);
    }
  });

  test("lists every status in the status matrix", async ({ page }) => {
    await open(page, EXAMPLES[0] as Example);
    const matrix = page.locator("section#status");
    // 7 request + 6 quotation + 6 work order + 6 invoice + 2 payment + 2 notification + 5 email
    // + 3 service (T07) + 2 technician (T16)
    await expect(matrix.locator("tbody tr")).toHaveCount(39);
    await expect(matrix.getByText("Needs rescheduling")).toBeVisible();
    await expect(matrix.getByText("Logged only")).toBeVisible();
  });

  test("shows the contrast table with every pair passing", async ({ page }) => {
    await open(page, EXAMPLES[0] as Example);
    const colour = page.locator("section#colour");
    await expect(colour.getByText("FAIL")).toHaveCount(0);
    expect(await colour.getByText("Pass", { exact: true }).count()).toBeGreaterThan(40);
  });

  test("uses the web fonts we ship, not a fallback", async ({ page }) => {
    await open(page, EXAMPLES[0] as Example);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family),
    );
    expect(loaded.join(" ")).toMatch(/Inter|__Inter/i);
    expect(loaded.join(" ")).toMatch(/Bricolage/i);
  });

  test("uses a real page title and favicon", async ({ page }) => {
    await open(page, EXAMPLES[0] as Example);
    await expect(page).toHaveTitle("Styleguide · FixFlow");
    const icon = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(icon).toContain("icon");
    const response = await page.request.get(icon ?? "/icon.svg");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("svg");
  });
});

test.describe("data table at both breakpoints", () => {
  test.describe.configure({ timeout: 90_000 });

  test("is a table from 768px up and stacked cards below", async ({ page }) => {
    const requests = EXAMPLES.find((example) => example.name === "shell-admin-requests") as Example;

    await useViewport(page, 360);
    await open(page, requests);
    await expect(page.getByRole("table", { name: "Service requests" })).toBeHidden();
    const cards = page.getByRole("list", { name: "Service requests" });
    await expect(cards).toBeVisible();
    await expect(cards.getByRole("listitem")).toHaveCount(8);

    for (const width of [768, 1024, 1440]) {
      await useViewport(page, width);
      await expect(page.getByRole("table", { name: "Service requests" })).toBeVisible();
      await expect(cards).toBeHidden();
    }
  });

  test("sorts and pages through links in the URL", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/styleguide/shells/admin/requests");
    const table = page.getByRole("table", { name: "Service requests" });
    await expect(table).toBeVisible();

    await table.getByRole("link", { name: "Customer" }).click();
    await expect(page).toHaveURL(/sort=customer&order=asc/);
    await expect(table.getByRole("columnheader", { name: "Customer" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await page.getByRole("link", { name: "Go to next page" }).click();
    await expect(page).toHaveURL(/sort=customer&order=asc&page=2/);
    await expect(page.getByText(/Showing 9–16 of 48 requests/)).toBeVisible();

    await page.getByLabel("Status").selectOption("QUOTED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/status=QUOTED/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
  });

  test("a row opens its record from anywhere on the row", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/styleguide/shells/admin/requests");
    const firstRow = page
      .getByRole("table", { name: "Service requests" })
      .locator("tbody tr")
      .first();
    // The primary cell's link stretches over the whole row, so any point on the row opens it.
    await firstRow.click({ position: { x: 400, y: 12 } });
    await expect(page).toHaveURL(/\/requests\/detail$/, { timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("accessibility (axe, no serious or critical violations)", () => {
  test.describe.configure({ timeout: 90_000 });

  async function scan(page: Page) {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    return results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
  }

  function describeViolations(violations: Awaited<ReturnType<typeof scan>>): string {
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

  for (const width of [360, 1440]) {
    test(`/styleguide at ${width}px`, async ({ page }) => {
      await useViewport(page, width);
      await open(page, EXAMPLES[0] as Example);
      await page.evaluate(() => document.fonts.ready);
      const violations = await scan(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }

  for (const example of EXAMPLES.slice(1)) {
    test(`${example.name}`, async ({ page }) => {
      await useViewport(page, 1440);
      await open(page, example);
      const violations = await scan(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }

  test("/styleguide with its dialog and menu open", async ({ page }) => {
    await useViewport(page, 1280);
    await open(page, EXAMPLES[0] as Example);
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("dialog", { name: "Add an internal note" })).toBeVisible();
    const violations = await scan(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
