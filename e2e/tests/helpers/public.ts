import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The five seeded services in display order (spec §19.1), as the public website lists them. */
export const SEEDED_SERVICES = [
  "AC Diagnostic Visit",
  "AC Routine Maintenance",
  "Washing Machine Repair",
  "Electrical Safety Inspection",
  "Home Deep Cleaning",
] as const;

/**
 * Where the general "Request a service" button goes (T11): the customers-only request form, which
 * sends a visitor without a session to sign-in and back.
 */
export const REQUEST_SERVICE_HREF = "/request-service";

/** Where "Request this service" goes on a service's page: the form with that service chosen. */
export function requestServiceHrefFor(slug: string): string {
  return `/request-service?service=${encodeURIComponent(slug)}`;
}

/**
 * Asserts the page's headings form an outline: exactly one `h1`, it comes first, and going down
 * never skips a level (an `h2` is followed by an `h2`, `h3` or deeper only one level at a time).
 */
export async function expectOrderedHeadings(page: Page): Promise<void> {
  const levels = await page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
      Number(heading.tagName.slice(1)),
    ),
  );
  expect(
    levels.filter((level) => level === 1),
    `h1 count in ${levels.join(",")}`,
  ).toHaveLength(1);
  expect(levels[0]).toBe(1);
  levels.forEach((level, index) => {
    const previous = levels[index - 1];
    if (previous !== undefined) {
      expect(level, `heading order ${levels.join(",")}`).toBeLessThanOrEqual(previous + 1);
    }
  });
}

/** Serious and critical axe violations on the current page, formatted for a failure message. */
export async function seriousViolations(page: Page): Promise<string> {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary ?? ""}`)
          .join("\n"),
    )
    .join("\n");
}

/** The content of a `<meta>` tag by `name` or `property`, or `null` when the page has none. */
export async function metaContent(page: Page, key: string): Promise<string | null> {
  const tag = page.locator(`meta[name="${key}"], meta[property="${key}"]`).first();
  return (await tag.count()) === 0 ? null : tag.getAttribute("content");
}

export async function canonicalHref(page: Page): Promise<string | null> {
  return page.locator('link[rel="canonical"]').first().getAttribute("href");
}
