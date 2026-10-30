import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { deleteServicesNamed } from "../fixtures/catalogue.js";
import {
  archiveService,
  createPublishedService,
  setBusinessName,
  uniqueServiceName,
} from "../fixtures/public-site.js";
import { loginAs } from "../support/auth.js";
import { WEB_URL } from "../support/env.js";
import { expectNoHorizontalOverflow, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  canonicalHref,
  expectOrderedHeadings,
  metaContent,
  REQUEST_SERVICE_HREF,
  requestServiceHrefFor,
  SEEDED_SERVICES,
  seriousViolations,
} from "./helpers/public.js";

/**
 * The public website (T08, FR-001 to FR-005, FR-006, SC-01): the homepage and its sections, the
 * service list with its category filter, a service's page, the privacy notice, the demo banner,
 * search-engine metadata, the sitemap and robots.txt, the header menu, and what a business change
 * does to the pages. This server runs in demo mode with the API up; the other half (a stopped API,
 * and the site outside demo mode) is `public-site-api-down.spec.ts`.
 *
 * The public pages hold what they read from the API for a few seconds (PUBLIC_REVALIDATE_SECONDS
 * is 2 here, 60 by default), so a change made through the admin API shows after a moment: those
 * checks retry rather than sleep. Specs run in parallel and share the seeded business, so no check
 * relies on the business name (one spec changes it for a moment) or on the exact number of services
 * (the catalogue specs add and remove their own).
 */

test.describe.configure({ timeout: 120_000 });

const BUSINESS_SUFFIX = /· CoolBreeze Home Services/;

const createdPrefixes: string[] = [];

test.afterEach(async () => {
  for (const prefix of createdPrefixes.splice(0)) {
    await deleteServicesNamed(prefix);
  }
});

/** Retries a reload-and-check until the page shows what the admin changed (the pages refresh within seconds). */
async function expectAfterRevalidation(
  page: Page,
  check: () => Promise<void>,
  timeout = 30_000,
): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [500, 1000, 1000, 2000] });
}

test.describe("homepage", () => {
  test("has a hero, live service cards, how it works, trust points, FAQ, contact and footer", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Home repairs and maintenance, handled from first request to final invoice",
    );
    await expect(page.getByRole("link", { name: "Browse services" }).first()).toHaveAttribute(
      "href",
      "/services",
    );

    // Service highlights come from the API: three cards, each a link to its page.
    const services = page.getByRole("region", { name: "What we can help with" });
    for (const name of SEEDED_SERVICES.slice(0, 3)) {
      await expect(services.getByRole("link", { name })).toBeVisible();
    }
    await expect(services.getByText("From $129.00")).toBeVisible();
    await expect(services.getByText("Request a quote").first()).toBeVisible();
    await expect(services.getByRole("link", { name: "All services" })).toHaveAttribute(
      "href",
      "/services",
    );

    // How it works: the four real stages, in order.
    const steps = page.getByRole("region", { name: "How it works" }).getByRole("listitem");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toContainText("Request");
    await expect(steps.nth(1)).toContainText("Quotation");
    await expect(steps.nth(2)).toContainText("Scheduled visit");
    await expect(steps.nth(3)).toContainText("Invoice and payment");

    // Trust points the product really delivers.
    const trust = page.getByRole("region", { name: "What you can expect" });
    await expect(trust.getByRole("heading", { level: 3 })).toHaveText([
      "Written quotations before work starts",
      "Track every request online",
      "Clear invoices and payment records",
    ]);

    // Service area and contact come from the settings.
    const contact = page.getByRole("region", { name: "Where we work and how to reach us" });
    await expect(contact).toContainText("Harbor City");
    await expect(contact.getByRole("link", { name: /555-01\d\d/ })).toHaveAttribute(
      "href",
      /^tel:\d{10}$/,
    );
    await expect(contact.getByRole("link", { name: "hello@coolbreeze.test" })).toHaveAttribute(
      "href",
      "mailto:hello@coolbreeze.test",
    );

    // The footer credits FixFlow and carries the demo notice.
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText("Powered by FixFlow");
    await expect(footer).toContainText("FixFlow portfolio demo — fictional business and data.");
    await expect(footer.getByRole("link", { name: "Privacy and demo notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );

    await expectOrderedHeadings(page);
  });

  test("has no testimonials, ratings, client logos or invented figures", async ({ page }) => {
    await page.goto("/");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of [
      "testimonial",
      "★",
      "5-star",
      "five-star",
      "trusted by",
      "happy customers",
      "lorem",
      "years of experience",
    ]) {
      expect(text, `the page should not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test("the FAQ opens and closes with the keyboard", async ({ page }) => {
    await page.goto("/");
    const faq = page.getByRole("region", { name: "Questions people ask" });
    const questions = faq.locator("summary");
    // Seven in the portfolio demo (one is the "is this real?" answer); six otherwise.
    await expect(questions).toHaveCount(7);

    const first = questions.first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(faq.locator("details").first()).toHaveJSProperty("open", true);
    await expect(faq.getByText("You sign in or create a free account")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(faq.locator("details").first()).toHaveJSProperty("open", false);
  });

  test("Request a service leads to the request form, which sends a visitor to sign-in first", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.getByRole("region", { name: /handled from first request/ });
    const cta = hero.getByRole("link", { name: "Request a service" });
    await expect(cta).toHaveAttribute("href", REQUEST_SERVICE_HREF);
    await expect(hero).toContainText("You will sign in or create a free account first");

    await cta.click();
    await expect(page).toHaveURL(/\/login\?returnTo=%2Frequest-service$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  });

  test("a business name change in settings shows after revalidation", async ({ page }) => {
    await loginAs(page, "admin");
    const tag = randomUUID().slice(0, 6);
    const newName = `CoolBreeze Home Services E2E ${tag}`;
    let originalName: string | undefined;

    try {
      originalName = await setBusinessName(page, newName);
      await page.goto("/");
      await expectAfterRevalidation(page, async () => {
        await expect(page.getByRole("banner")).toContainText(newName, { timeout: 1500 });
      });
      // Everywhere the name is used: the footer, the demo banner and the page title.
      await expect(page.getByRole("contentinfo")).toContainText(newName);
      await expect(page.getByRole("region", { name: "Demo notice" })).toContainText(newName);
      await expect(page).toHaveTitle(new RegExp(`· ${newName}$`));
    } finally {
      if (originalName !== undefined) {
        await setBusinessName(page, originalName);
        await page.goto("/");
        await expectAfterRevalidation(page, async () => {
          await expect(page.getByRole("banner")).toContainText(originalName as string, {
            timeout: 1500,
          });
        });
      }
    }
  });
});

test.describe("service list", () => {
  test("lists the active services, with a category filter in the URL that works by keyboard", async ({
    page,
  }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1, name: "Our services" })).toBeVisible();

    for (const name of SEEDED_SERVICES) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }

    const filter = page.getByRole("navigation", { name: "Filter services by category" });
    await expect(filter.getByRole("link", { name: /^All/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Reach the chip with the keyboard and choose it with Enter.
    const airConditioning = filter.getByRole("link", { name: /^Air conditioning/ });
    await airConditioning.focus();
    await expect(airConditioning).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/services\?category=Air%20conditioning$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(airConditioning).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("link", { name: "AC Diagnostic Visit" })).toBeVisible();
    await expect(page.getByRole("link", { name: "AC Routine Maintenance" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Washing Machine Repair" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Home Deep Cleaning" })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(
      /Showing 2 of \d+ services in Air conditioning/,
    );

    await expectOrderedHeadings(page);
  });

  test("a category with nothing in it shows an empty state that leads back to the list", async ({
    page,
  }) => {
    await page.goto("/services?category=Roof%20repair");
    await expect(page.getByRole("heading", { name: "No services in that category" })).toBeVisible();
    await page.getByRole("link", { name: "Show all services" }).click();
    await expect(page).toHaveURL(/\/services$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("link", { name: "Home Deep Cleaning" })).toBeVisible();
  });

  test("a service card opens its page", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("link", { name: "Home Deep Cleaning" }).click();
    await expect(page).toHaveURL(/\/services\/home-deep-cleaning$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("heading", { level: 1, name: "Home Deep Cleaning" })).toBeVisible();
  });
});

test.describe("service page", () => {
  test("shows the full detail, a pricing note, inclusions, related services and the request link", async ({
    page,
  }) => {
    await page.goto("/services/ac-routine-maintenance");

    await expect(
      page.getByRole("heading", { level: 1, name: "AC Routine Maintenance" }),
    ).toBeVisible();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      "/services",
    );
    await expect(crumbs.getByText("AC Routine Maintenance")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await expect(page.getByRole("heading", { name: "About this service" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What's included" })).toBeVisible();
    await expect(page.getByText("Filter, coil and drain line cleaning")).toBeVisible();
    await expect(page.getByText("Usually takes 1 hr 30 min").first()).toBeVisible();
    await expect(
      page.getByText("Starting from $129.00 — final price confirmed in your written quotation"),
    ).toBeVisible();

    const request = page.getByRole("link", { name: "Request this service" });
    await expect(request).toHaveAttribute("href", requestServiceHrefFor("ac-routine-maintenance"));

    const related = page.getByRole("region", { name: "Other services you may need" });
    await expect(related.getByRole("heading", { level: 3 })).toHaveCount(3);
    await expect(related.getByRole("link", { name: "AC Diagnostic Visit" })).toBeVisible();
    await expect(related.getByRole("link", { name: "AC Routine Maintenance" })).toHaveCount(0);

    await expectOrderedHeadings(page);
  });

  test("a service priced by quotation says so", async ({ page }) => {
    await page.goto("/services/washing-machine-repair");
    await expect(page.getByText("Priced after we review your request")).toBeVisible();
    await expect(page.getByText(/Starting from/)).toHaveCount(0);
  });

  test("an unknown address is a 404 page", async ({ page }) => {
    const response = await page.goto("/services/no-such-service");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    // Search engines are told to leave it alone.
    expect(await metaContent(page, "robots")).toMatch(/noindex/);
  });

  test("an archived service disappears: its page is a 404 and it is gone from the list and the sitemap", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    const name = uniqueServiceName("Pub archive");
    createdPrefixes.push(name);
    const service = await createPublishedService(page, {
      name,
      pricingMode: "FIXED",
      startingPrice: "75.00",
    });

    // Published: its page, the list and the sitemap show it (after the pages refresh).
    await expectAfterRevalidation(page, async () => {
      const response = await page.goto(`/services/${service.slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 1500 });
    });
    await expect(page.getByText("Starting from $75.00")).toBeVisible();
    const listed = await page.request.get("/sitemap.xml");
    expect(await listed.text()).toContain(`/services/${service.slug}</loc>`);

    // Archived: the page becomes a 404 and the service leaves the list and the sitemap.
    await archiveService(page, service);
    await expect(async () => {
      const response = await page.goto(`/services/${service.slug}`);
      expect(response?.status()).toBe(404);
    }).toPass({ timeout: 30_000, intervals: [500, 1000, 1000, 2000] });
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();

    await expectAfterRevalidation(page, async () => {
      await page.goto("/services");
      await expect(page.getByRole("link", { name: "Home Deep Cleaning" })).toBeVisible({
        timeout: 1500,
      });
      await expect(page.getByRole("link", { name })).toHaveCount(0);
    });
    await expect(async () => {
      const gone = await page.request.get("/sitemap.xml");
      expect(await gone.text()).not.toContain(`/services/${service.slug}`);
    }).toPass({ timeout: 30_000, intervals: [500, 1000, 2000] });
  });
});

test.describe("privacy notice", () => {
  test("explains the demo, what is collected and who can see it, and the register page links to it", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy and demo notice" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This is a portfolio demonstration" }),
    ).toBeVisible();
    await expect(page.getByText("Do not submit real personal information.")).toBeVisible();
    for (const title of ["What is collected", "Why it is collected", "Cookies", "Who can see it"]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await expectOrderedHeadings(page);

    await page.goto("/register");
    const terms = page.getByRole("link", { name: "privacy notice" }).first();
    await expect(terms).toHaveAttribute("href", "/privacy");
    await page.getByRole("link", { name: "Read the demo notice" }).click();
    await expect(page).toHaveURL(/\/privacy$/, { timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("demo banner", () => {
  test("shows the notice with a link to the privacy page, and can be dismissed for the session", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Demo notice" });
    await expect(banner).toContainText(
      /FixFlow portfolio demo — .+ is a fictional business\. Data resets regularly\./,
    );
    await expect(banner.getByRole("link", { name: "Privacy and demo notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );

    await banner.getByRole("button", { name: "Dismiss demo notice" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Demo notice" })).toHaveCount(0);

    // A new tab is a new session: the notice is back.
    const other = await context.newPage();
    await other.goto("/services");
    await expect(other.getByRole("region", { name: "Demo notice" })).toBeVisible();
  });
});

test.describe("header", () => {
  test("lists the public pages and marks the current one", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/services");
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Services" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "/#how-it-works",
    );
    await expect(nav.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/#contact");

    // The anchors work from any page: they go to the section on the homepage.
    await nav.getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/\/#how-it-works$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("region", { name: "How it works" })).toBeInViewport();
  });

  test("the account link follows the session", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );

    await loginAs(page, "customer");
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "My account" }),
    ).toHaveAttribute("href", "/portal");
  });

  test("a signed-in customer still sees the account link and the business name in full on a phone", async ({
    page,
  }) => {
    await useViewport(page, 360);
    await loginAs(page, "customer");
    await page.goto("/");

    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "My account" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(header.getByText("CoolBreeze Home Services")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // The name wraps onto a second line rather than being cut off.
    const box = await header.getByText("CoolBreeze Home Services").boundingBox();
    const scroll = await header.getByText("CoolBreeze Home Services").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(box?.height ?? 0).toBeGreaterThan(0);
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
  });

  test("the account link for the business admin goes to the dashboard", async ({ page }) => {
    await useViewport(page, 1440);
    await loginAs(page, "admin");
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/app/dashboard",
    );
  });

  test("the phone menu opens and closes with the keyboard and its links work", async ({ page }) => {
    await useViewport(page, 360);
    await page.goto("/");
    const menuButton = page.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
    // The business name is shown in full beside it, not cut to a few letters.
    await expect(page.getByRole("banner").getByText("CoolBreeze Home Services")).toBeVisible();
    // The inline links are for wide screens; on a phone only the menu holds them.
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Services", exact: true }),
    ).toBeHidden();

    await menuButton.focus();
    await page.keyboard.press("Enter");
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${(await menuButton.getAttribute("aria-controls")) ?? ""}`);
    for (const name of ["Home", "Services", "How it works", "Contact", "Request a service"]) {
      await expect(panel.getByRole("link", { name })).toBeVisible();
    }
    // The account link stays in the header itself, so it is never a tap deeper.
    await expect(panel.getByRole("link", { name: "Sign in" })).toHaveCount(0);

    // Tab moves into the menu; Escape closes it and returns focus to the button.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Home" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(menuButton).toBeFocused();

    // Choose a page from the menu with the keyboard.
    await page.keyboard.press("Enter");
    await panel.getByRole("link", { name: "Services" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/services$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: "Our services" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

test.describe("search engines", () => {
  const pages = [
    { path: "/", title: /^Home repairs and maintenance · / },
    { path: "/services", title: /^Our services · / },
    { path: "/services/ac-routine-maintenance", title: /^AC Routine Maintenance · / },
    { path: "/privacy", title: /^Privacy and demo notice · / },
  ] as const;

  test("each page has its own title in the 'Page · Business' format, a description, a canonical URL and social tags", async ({
    page,
  }) => {
    const descriptions = new Set<string>();
    for (const { path, title } of pages) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page).toHaveTitle(BUSINESS_SUFFIX);

      const description = await metaContent(page, "description");
      expect(description, `${path} description`).toBeTruthy();
      expect((description ?? "").length).toBeLessThanOrEqual(160);
      descriptions.add(description ?? "");

      const url = path === "/" ? WEB_URL : `${WEB_URL}${path}`;
      expect(await canonicalHref(page)).toBe(url);
      expect(await metaContent(page, "og:title")).toBe(await page.title());
      expect(await metaContent(page, "og:url")).toBe(url);
      expect(await metaContent(page, "og:type")).toBe("website");
      expect(await metaContent(page, "og:site_name")).toMatch(/CoolBreeze Home Services/);
      expect(await metaContent(page, "twitter:card")).toBe("summary");
      // The portfolio demo shows a fictional business, so it asks not to be indexed.
      expect(await metaContent(page, "robots")).toMatch(/noindex/);
    }
    expect(descriptions.size, "every page has its own description").toBe(pages.length);
  });

  test("sitemap.xml lists the home page, the list, every active service and the privacy notice", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/xml/);
    const xml = await response.text();

    expect(xml).toContain(`<loc>${WEB_URL}/</loc>`);
    expect(xml).toContain(`<loc>${WEB_URL}/services</loc>`);
    expect(xml).toContain(`<loc>${WEB_URL}/privacy</loc>`);
    for (const slug of [
      "ac-diagnostic-visit",
      "ac-routine-maintenance",
      "washing-machine-repair",
      "electrical-safety-inspection",
      "home-deep-cleaning",
    ]) {
      expect(xml).toContain(`<loc>${WEB_URL}/services/${slug}</loc>`);
    }
    // Signed-in areas never appear.
    expect(xml).not.toContain("/app");
    expect(xml).not.toContain("/portal");
    expect(xml).not.toContain("/login");
  });

  test("robots.txt keeps crawlers out of the signed-in areas", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("User-Agent: *");
    for (const path of ["/app", "/portal", "/api/", "/login"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    // The demo asks not to be indexed (a noindex tag on each page), so it does not advertise a sitemap.
    expect(text).not.toContain("Sitemap:");
  });
});

test.describe("accessibility", () => {
  for (const { name, path } of [
    { name: "the homepage", path: "/" },
    { name: "the service list", path: "/services" },
    { name: "a service page", path: "/services/ac-routine-maintenance" },
    { name: "the privacy notice", path: "/privacy" },
  ]) {
    test(`${name} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body [class*='animate-pulse']")).toHaveCount(0);
      expect(await seriousViolations(page)).toBe("");
    });
  }

  test("the homepage with every FAQ answer open and the phone menu open has none either", async ({
    page,
  }) => {
    await useViewport(page, 360);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const summary of await page.locator("details > summary").all()) {
      await summary.click();
    }
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await seriousViolations(page)).toBe("");
  });
});
