import { expect, test } from "@playwright/test";

import { API_DOWN_WEB_URL } from "../support/env.js";
import { expectNoHorizontalOverflow, useViewport } from "./helpers/layout.js";
import {
  canonicalHref,
  expectOrderedHeadings,
  metaContent,
  seriousViolations,
} from "./helpers/public.js";

/**
 * The public website when the API cannot be reached (T08, acceptance 6, D-87). Playwright starts a
 * second copy of the web app on port 3001 whose API address points at nothing, and outside the
 * portfolio-demo mode, so these specs also show what the site looks like as a real business's
 * (no demo banner, pages open to search engines). Every page must still render: sections that need
 * the API say so and offer a retry, and nothing becomes an error page or a 404.
 */

test.use({ baseURL: API_DOWN_WEB_URL });
test.describe.configure({ timeout: 120_000 });

test("the homepage renders and says which part is unavailable, with a retry", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Home repairs and maintenance, handled from first request to final invoice",
  );

  // The static parts are all there.
  await expect(page.getByRole("region", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What you can expect" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Questions people ask" })).toBeVisible();
  // Not the demo, so the demo-only answer and the banner are absent.
  await expect(
    page.getByRole("region", { name: "Questions people ask" }).locator("summary"),
  ).toHaveCount(6);
  await expect(page.getByRole("region", { name: "Demo notice" })).toHaveCount(0);

  // The parts that need the API show a message, not an error page.
  const services = page.getByRole("region", { name: "What we can help with" });
  const alert = services.getByRole("alert");
  await expect(alert).toContainText("We can't show our services right now");
  const retry = alert.getByRole("link", { name: "Try again" });
  await expect(retry).toHaveAttribute("href", "/");
  await expect(page.getByRole("contentinfo")).toContainText("can't be loaded right now");
  await expect(page.getByRole("contentinfo")).toContainText("Powered by FixFlow");

  // The header still shows an identity (the product's own, as the business's cannot be read) and the menu.
  await expect(page.getByRole("banner")).toContainText("FixFlow");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Request a service" }),
  ).toBeVisible();

  // The retry is a working link.
  await retry.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert").first()).toContainText(
    "We can't show our services right now",
  );

  await expectOrderedHeadings(page);
});

test("the homepage unavailable state has no overflow and no serious accessibility problems", async ({
  page,
}) => {
  for (const width of [360, 1440]) {
    await useViewport(page, width);
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("alert").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await seriousViolations(page)).toBe("");
  }
});

test("the service list says it cannot show the services, and the title still follows the format", async ({
  page,
}) => {
  const response = await page.goto("/services");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Our services" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "We can't show our services right now",
  );
  await expect(page).toHaveTitle("Our services · FixFlow");
  expect(await seriousViolations(page)).toBe("");
});

test("a service page is not a 404 when the API is down, because the service may well exist", async ({
  page,
}) => {
  const response = await page.goto("/services/ac-routine-maintenance");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "We can't show this service right now",
  );
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/services/ac-routine-maintenance",
  );
  // Nothing worth indexing is on it.
  expect(await metaContent(page, "robots")).toMatch(/noindex/);
  expect(await seriousViolations(page)).toBe("");
});

test("the privacy notice needs nothing from the API", async ({ page }) => {
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is collected" })).toBeVisible();
  // Outside the demo there is no demo section.
  await expect(
    page.getByRole("heading", { name: "This is a portfolio demonstration" }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle("Privacy notice · FixFlow");
});

test("outside the demo the pages may be indexed, and robots.txt advertises the sitemap", async ({
  page,
  request,
}) => {
  await page.goto("/privacy");
  expect(await metaContent(page, "robots")).toBeNull();
  expect(await canonicalHref(page)).toBe(`${API_DOWN_WEB_URL}/privacy`);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
  expect(robots).toContain(`Sitemap: ${API_DOWN_WEB_URL}/sitemap.xml`);
});

test("sitemap.xml is still served, with the pages that do not need the API", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain(`<loc>${API_DOWN_WEB_URL}/</loc>`);
  expect(xml).toContain(`<loc>${API_DOWN_WEB_URL}/services</loc>`);
  expect(xml).toContain(`<loc>${API_DOWN_WEB_URL}/privacy</loc>`);
  expect(xml).not.toContain("/services/");
});
