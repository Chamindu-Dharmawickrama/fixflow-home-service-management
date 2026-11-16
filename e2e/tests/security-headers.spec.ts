import { expect, type Page, test } from "@playwright/test";

import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "./helpers/layout.js";

/**
 * The web app's security headers (T25, D-113, NFR-07): present on the public, sign-in, customer and
 * business pages and on static files, not doubled on the API's answers through the proxy, and — the
 * part a header test alone cannot show — the pages still work under the policy: Google Identity
 * Services loads and draws its button, and no page reports a Content Security Policy violation.
 */

test.describe.configure({ timeout: 120_000 });

/** Collects every CSP violation the page reports, from before its first script runs. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

function expectSecurityHeaders(headers: Record<string, string>, label: string): void {
  const csp = headers["content-security-policy"] ?? "";
  expect(csp, `${label}: CSP`).toContain("default-src 'self'");
  expect(csp, `${label}: no framing`).toContain("frame-ancestors 'none'");
  expect(csp, `${label}: GIS script`).toContain("https://accounts.google.com/gsi/client");
  expect(csp, `${label}: GIS frame`).toContain("frame-src https://accounts.google.com/gsi/");
  expect(csp, `${label}: GIS style`).toContain("https://accounts.google.com/gsi/style");
  expect(csp, `${label}: object-src`).toContain("object-src 'none'");
  expect(headers["referrer-policy"], label).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"], label).toBe("nosniff");
  expect(headers["x-frame-options"], label).toBe("DENY");
  expect(headers["permissions-policy"], label).toContain("camera=()");
  expect(headers["cross-origin-opener-policy"], label).toBe("same-origin-allow-popups");
}

test("every area of the site sends the security headers", async ({ page }) => {
  for (const path of ["/", "/services", "/privacy", "/login", "/register", "/no-such-page"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expectSecurityHeaders(response.headers(), path);
  }
  // A static file and an image the optimizer serves.
  const icon = await page.request.get("/favicon.ico");
  expectSecurityHeaders(icon.headers(), "/favicon.ico");

  await loginAs(page, "admin");
  for (const path of ["/app/dashboard", "/app/requests"]) {
    const response = await page.request.get(path);
    expectSecurityHeaders(response.headers(), path);
  }
});

test("the API's own answers through the proxy keep the API's headers, not the web app's", async ({
  page,
}) => {
  const response = await page.request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  // helmet's policy, sent once (a second, merged value would read "nosniff, nosniff").
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).not.toContain("accounts.google.com");
  expect(headers["cache-control"]).toBe("no-store");
});

test("Google Identity Services still loads and draws its button under the policy", async ({
  page,
}) => {
  const violations = await watchViolations(page);
  const gsiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://accounts.google.com/gsi/"))
      gsiRequests.push(request.url());
  });

  await page.goto("/login");
  await expectHydrated(page.getByRole("form", { name: "Sign in" }));
  const button = page.getByTestId("google-button");
  // The script ran (it defines `google.accounts.id`) and drew Google's button frame into the container.
  await expect
    .poll(() => page.evaluate(() => typeof (window as { google?: unknown }).google), {
      timeout: NAVIGATION_TIMEOUT,
    })
    .toBe("object");
  await expect(button.locator("iframe[src^='https://accounts.google.com/gsi/']")).toHaveCount(1, {
    timeout: NAVIGATION_TIMEOUT,
  });
  expect(gsiRequests.some((url) => url.startsWith("https://accounts.google.com/gsi/client"))).toBe(
    true,
  );
  await expect(page.getByText("Google sign-in couldn't load")).toHaveCount(0);
  expect(await violations()).toEqual([]);
});

test("no page reports a Content Security Policy violation", async ({ page }) => {
  const violations = await watchViolations(page);
  const found: string[] = [];
  const visit = async (path: string) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    for (const violation of await violations()) found.push(`${path}: ${violation}`);
  };

  // Public pages with photographs (next/image), the inline JSON-LD and the fonts.
  for (const path of ["/", "/services", "/services/ac-routine-maintenance", "/privacy"]) {
    await visit(path);
  }
  await loginAs(page, "admin");
  for (const path of ["/app/dashboard", "/app/calendar", "/app/settings/business"]) {
    await visit(path);
  }
  // A Radix popover positions itself with an inline style: open the notifications.
  const bell = page.getByRole("button", { name: /notification/i }).first();
  await expectHydrated(bell);
  await bell.click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  for (const violation of await violations()) found.push(`popover: ${violation}`);

  expect(found).toEqual([]);
});
