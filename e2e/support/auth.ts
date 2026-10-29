import { expect, type Page } from "@playwright/test";

import { expectHydrated, NAVIGATION_TIMEOUT } from "../tests/helpers/layout.js";
import { credentials, DEMO_ADMIN_EMAIL } from "./env.js";

/** The seeded demo accounts (D-09). `customer-b` is the second customer, for cross-customer checks. */
export type DemoAccountKey = "admin" | "customer" | "customer-b";

export function demoAccount(key: DemoAccountKey): {
  email: string;
  password: string;
  name: string;
} {
  switch (key) {
    case "admin":
      return {
        email: DEMO_ADMIN_EMAIL,
        password: credentials.demoAdminPassword,
        name: "Morgan Reyes",
      };
    case "customer":
      return {
        email: "alex.morgan@example.test",
        password: credentials.demoCustomerPassword,
        name: "Alex Morgan",
      };
    case "customer-b":
      return {
        email: "priya.shah@example.test",
        password: credentials.demoCustomerPassword,
        name: "Priya Shah",
      };
  }
}

/** Fills the real sign-in form and presses "Sign in". Waits for the form to be interactive first. */
export async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  const form = page.getByRole("form", { name: "Sign in" });
  await expectHydrated(form);
  await page.getByLabel(/^Email address/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Signs in through the real `/login` form, exactly as a person would (there is no test-only
 * endpoint and no cookie injection), and waits until the landing page has loaded. Returns the
 * path the browser ended up on.
 *
 * @param returnTo - optional `?returnTo=` for the login URL, to test where sign-in lands.
 */
export async function loginAs(
  page: Page,
  who: DemoAccountKey | { email: string; password: string },
  options: { returnTo?: string } = {},
): Promise<string> {
  const { email, password } = typeof who === "string" ? demoAccount(who) : who;
  const url =
    options.returnTo === undefined
      ? "/login"
      : `/login?returnTo=${encodeURIComponent(options.returnTo)}`;

  await page.goto(url);
  await submitLoginForm(page, email, password);
  await page.waitForURL((current) => !current.pathname.startsWith("/login"), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  return new URL(page.url()).pathname;
}

/** Signs out through the user menu, as a person would. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((current) => current.pathname === "/", { timeout: NAVIGATION_TIMEOUT });
}
