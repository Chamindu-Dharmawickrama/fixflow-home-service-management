import { expect, type Page, test } from "@playwright/test";

import { WEB_URL } from "../support/env.js";

/**
 * The photographs of the public website (T08, D-90): the homepage hero and one picture per service.
 * They are shipped with the web app (`public/images`, credited in CREDITS.md), served through the
 * Next.js image optimiser, and decorative (the service name sits beside each one). These checks make
 * sure none is broken, none is hot-linked from another site, and the honesty notes are in place.
 */

test.describe.configure({ timeout: 120_000 });

/**
 * Scrolls down the page and back, so lazily loaded pictures are requested (the browser only asks for
 * an image once it is near the screen), and waits for the page to be quiet.
 */
async function scrollThroughPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
}

/** The pictures on the page that have not loaded (a broken image has no width). */
async function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.images]
      .filter((image) => !(image.complete && image.naturalWidth > 0))
      .map((image) => image.currentSrc || image.src),
  );
}

const PAGES = [
  { path: "/", name: "the homepage", atLeast: 4 },
  { path: "/services", name: "the service list", atLeast: 5 },
  { path: "/services/ac-routine-maintenance", name: "a service page", atLeast: 4 },
] as const;

for (const { path, name, atLeast } of PAGES) {
  test(`${name} shows photographs that all load, and only from this site`, async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "image") requested.push(request.url());
    });

    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scrollThroughPage(page);

    const count = await page.evaluate(() => document.images.length);
    expect(count, `pictures on ${path}`).toBeGreaterThanOrEqual(atLeast);
    expect(await brokenImages(page)).toEqual([]);

    // Nothing is hot-linked: every picture is requested from the web app itself.
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(new URL(url).origin, url).toBe(WEB_URL);
    }

    // The pictures are decorative: the name beside each one says what it is.
    const withAlt = await page.evaluate(
      () => [...document.images].filter((image) => image.alt.trim() !== "").length,
    );
    expect(withAlt).toBe(0);
  });
}

test("the homepage hero is a photograph with the example card over it", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByRole("region", { name: /handled from first request/ });
  await expect(hero.locator("img")).toHaveCount(1);
  await expect(hero.getByText("Example of what you see in your account")).toBeVisible();
  await expect(
    hero.getByText("Sample data. Your own requests appear here once you sign in."),
  ).toBeVisible();
});

test("two services about air conditioning do not show the same photograph", async ({ page }) => {
  await page.goto("/services");
  await scrollThroughPage(page);
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll("li")]
      .filter((item) => /AC Diagnostic Visit|AC Routine Maintenance/.test(item.textContent ?? ""))
      .map((item) => decodeURIComponent(item.querySelector("img")?.getAttribute("src") ?? "")),
  );
  expect(sources).toHaveLength(2);
  expect(new Set(sources).size).toBe(2);
});

test("the privacy notice says the photographs are stock images", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText(/royalty-free stock images/)).toBeVisible();
});

test("a picture file is served as an image, the credits are public, and a made-up file is a 404", async ({
  request,
}) => {
  const real = await request.get("/images/services/cleaning.jpg");
  expect(real.status()).toBe(200);
  expect(real.headers()["content-type"]).toBe("image/jpeg");

  const credits = await request.get("/images/CREDITS.md");
  expect(credits.status()).toBe(200);
  expect(await credits.text()).toContain("Pexels License");

  expect((await request.get("/images/services/nope.jpg")).status()).toBe(404);
});
