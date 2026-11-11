import { expect, type Page, test } from "@playwright/test";

import {
  createAdminAccount,
  createCustomerAccount,
  createDelistedAdminAccount,
  newPassphrase,
  newVisitorEmail,
} from "../fixtures/accounts.js";
import { demoAccount, loginAs, signOut, submitLoginForm } from "../support/auth.js";
import { E2E_SECOND_ADMIN_EMAIL, WEB_URL } from "../support/env.js";
import { waitForResetLink } from "../support/outbox.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
} from "./helpers/layout.js";

/**
 * The sign-in, sign-up and recovery journeys (T05), driven through the real forms against the real
 * API and the E2E database. Demo accounts are the seeded ones; anything that changes a password
 * uses an account the test creates for itself, because demo mode locks the shared ones (D-09).
 */

const admin = demoAccount("admin");
const customer = demoAccount("customer");

/** Matches an alert with this text. `getByRole("alert")` alone also finds Next.js's empty route announcer. */
const alertWith = (page: Page, text: string | RegExp) =>
  page.locator('[role="alert"]', { hasText: text });

test.describe("route protection", () => {
  test("a visitor who opens /app/dashboard is sent to sign-in and lands back there after signing in", async ({
    page,
  }) => {
    await page.goto("/app/dashboard");

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Fdashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

    await submitLoginForm(page, admin.email, admin.password);

    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });
    await expect(
      page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Morgan$/ }),
    ).toBeVisible();
  });

  test("the query string of the page being protected is kept in returnTo", async ({ page }) => {
    await page.goto("/portal?tab=invoices");

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fportal%3Ftab%3Dinvoices$/);
  });

  test("a customer who opens an admin page sees 'no access' with a way back, and no admin navigation", async ({
    page,
  }) => {
    await loginAs(page, "customer");

    await page.goto("/app/dashboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("link", { name: "Go to my account" })).toHaveAttribute(
      "href",
      "/portal",
    );
    await expect(page.getByText(`Welcome, ${customer.name}`)).toHaveCount(0);
    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
  });

  test("an admin who opens the customer portal is redirected to the dashboard", async ({
    page,
  }) => {
    await loginAs(page, "admin");

    await page.goto("/portal");

    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });
    await expect(
      page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Morgan$/ }),
    ).toBeVisible();
  });

  test("a stale or forged session cookie is sent to sign-in with the page remembered", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "fixflow_session", value: "x".repeat(43), url: "http://localhost:3000" },
    ]);

    await page.goto("/app/dashboard");

    // The proxy lets it through (a cookie exists); the layout asks the API, which says 401.
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Fdashboard$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  });

  test("an administrator whose address left the allowlist gets 'no access' and can only sign out", async ({
    page,
  }) => {
    const former = await createDelistedAdminAccount();

    await page.goto("/login");
    await submitLoginForm(page, former.email, former.password);

    await expect(
      page.getByRole("heading", { level: 1, name: "This account has no access" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);

    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await expectHydrated(signOutButton);
    await signOutButton.click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: NAVIGATION_TIMEOUT });
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fportal$/);
  });

  test("/app opens the dashboard", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/app");

    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("signing in", () => {
  test("shows one generic error for a wrong password and keeps what was typed", async ({
    page,
  }) => {
    await page.goto("/login");

    await submitLoginForm(page, admin.email, "this is not the password");

    await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel(/^Email address/)).toHaveValue(admin.email);
    await expect(page.getByLabel(/^Password/)).toHaveValue("this is not the password");
  });

  test("gives an unknown email the very same error", async ({ page }) => {
    await page.goto("/login");

    await submitLoginForm(page, "nobody.at.all@example.test", "whatever passphrase");

    await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
  });

  test("checks the fields before sending anything", async ({ page }) => {
    await page.goto("/login");
    await expectHydrated(page.getByRole("form", { name: "Sign in" }));

    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows and hides the password", async ({ page }) => {
    await page.goto("/login");
    await expectHydrated(page.getByRole("form", { name: "Sign in" }));
    const field = page.getByLabel(/^Password/);
    await field.fill("a private passphrase");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(field).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  for (const attempt of ["https://evil.test/phish", "//evil.test", "/\\evil.test"]) {
    test(`ignores the open-redirect attempt returnTo=${attempt}`, async ({ page }) => {
      const landed = await loginAs(page, "customer", { returnTo: attempt });

      expect(new URL(page.url()).host).toBe("localhost:3000");
      expect(landed).toBe("/portal");
    });
  }

  test("sends a customer who followed an admin link to their own home", async ({ page }) => {
    const landed = await loginAs(page, "customer", { returnTo: "/app/dashboard" });

    expect(landed).toBe("/portal");
  });

  test("someone already signed in who opens /login is taken to their home", async ({ page }) => {
    await loginAs(page, "customer");

    await page.goto("/login");

    await page.waitForURL("**/portal", { timeout: NAVIGATION_TIMEOUT });
  });

  test("renders Google's button container when a client ID is configured", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByTestId("google-button")).toBeAttached();
    await expect(page.getByText(/Google sign-in isn't set up/)).toHaveCount(0);
  });
});

test.describe("demo accounts (D-09)", () => {
  test("the panel fills the real form, the visitor presses Sign in, and signing out locks the pages again", async ({
    page,
  }) => {
    await page.goto("/login");
    await expectHydrated(page.getByRole("form", { name: "Sign in" }));
    const panel = page.getByRole("region", { name: "Demo accounts" });
    await expect(panel).toContainText(
      "Public demo — use fictional details; other visitors can see what you enter.",
    );
    await expect(panel).toContainText(admin.email);
    await expect(panel).toContainText(customer.email);

    await panel.getByRole("button", { name: /Use this account: Morgan Reyes/ }).click();

    // Filled in, but nobody is signed in yet.
    await expect(page.getByLabel(/^Email address/)).toHaveValue(admin.email);
    await expect(page.getByLabel(/^Password/)).toHaveValue(admin.password);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });

    await signOut(page);
    await expect(page).toHaveURL(/localhost:3000\/$/);
    for (const path of ["/app/dashboard", "/portal"]) {
      await page.goto(path);
      await expect(page).toHaveURL(`${WEB_URL}/login?returnTo=${encodeURIComponent(path)}`);
    }
  });

  test("the customer demo account opens the portal with their own details", async ({ page }) => {
    await page.goto("/login");
    await expectHydrated(page.getByRole("form", { name: "Sign in" }));

    await page.getByRole("button", { name: /Use this account: Alex Morgan/ }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL("**/portal", { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: "Hello, Alex Morgan" })).toBeVisible();
    await expect(page.getByText(customer.email)).toBeVisible();
  });

  test("the second demo customer is a different person", async ({ page }) => {
    await loginAs(page, "customer-b");

    await expect(page.getByRole("heading", { level: 1, name: "Hello, Priya Shah" })).toBeVisible();
  });

  test("a demo admin cannot change the shared password: the account page explains why", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/app/account");
    await expectHydrated(page.getByRole("form", { name: "Change password" }));

    await page.getByLabel(/^Current password/).fill(admin.password);
    await page.getByLabel(/^New password/).fill(newPassphrase());
    const again = await page.getByLabel(/^New password/).inputValue();
    await page.getByLabel(/^Confirm new password/).fill(again);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(alertWith(page, "shared demo account")).toBeVisible();
  });
});

test.describe("session-aware navigation", () => {
  test("the public header offers Sign in to visitors and the right place to everyone else", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

    await loginAs(page, "customer");
    await page.goto("/");
    await expect(header.getByRole("link", { name: "My account" })).toHaveAttribute(
      "href",
      "/portal",
    );
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    // The public pages have no user menu, so sign out from inside the portal.
    await page.goto("/portal");
    await signOut(page);
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();

    await loginAs(page, "admin");
    await page.goto("/");
    await expect(header.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/app/dashboard",
    );
  });

  test("a customer sees no admin navigation anywhere", async ({ page }) => {
    await loginAs(page, "customer");

    await expect(page.locator('a[href^="/app"]')).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Portal" })).toContainText("Overview");
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    // The profile page exists since T10, so the customer menu leads to it.
    await expect(page.getByRole("menuitem", { name: "Account" })).toHaveAttribute(
      "href",
      "/portal/profile",
    );
  });

  test("the admin menu names the person and links to their account page", async ({ page }) => {
    await loginAs(page, "admin");

    await page.getByRole("button", { name: /Account menu for/ }).click();

    await expect(page.getByText(`${admin.name} · Business admin`)).toBeVisible();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.waitForURL("**/app/account", { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByText("Business admin").first()).toBeVisible();
  });

  test("the session survives a reload", async ({ page }) => {
    await loginAs(page, "customer");

    await page.reload();

    await expect(page.getByRole("heading", { level: 1, name: "Hello, Alex Morgan" })).toBeVisible();
  });
});

test.describe("creating an account", () => {
  test("a new visitor registers locally and lands in the portal", async ({ page }) => {
    const email = newVisitorEmail();
    const password = newPassphrase();
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));

    await page.getByLabel(/^Full name/).fill("Robin Visitor");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByLabel(/^Confirm password/).fill(password);
    await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL("**/portal", { timeout: NAVIGATION_TIMEOUT });
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Robin Visitor" }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    // Their own account, not a demo one: they can sign out and back in with what they chose.
    await signOut(page);
    await loginAs(page, { email, password });
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Robin Visitor" }),
    ).toBeVisible();
  });

  test("explains what is wrong and creates nothing", async ({ page }) => {
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));

    await page.getByLabel(/^Full name/).fill("R");
    await page.getByLabel(/^Email address/).fill("not-an-email");
    await page.getByLabel(/^Password/).fill("short");
    await page.getByLabel(/^Confirm password/).fill("different");
    await page.getByRole("button", { name: "Create account" }).click();

    const summary = page.locator('[role="alert"]', { hasText: "Enter your full name." });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("You need to accept the terms and privacy notice.");
    await expect(page).toHaveURL(/\/register$/);
  });

  test("shows the live strength hint and the public-demo privacy notice", async ({ page }) => {
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));

    await expect(page.getByText("Public demo — use fictional details")).toBeVisible();
    await page.getByLabel(/^Password/).fill("tiny");
    await expect(page.getByText(/Too short so far/)).toBeVisible();
    await page.getByLabel(/^Password/).fill("a much longer passphrase here");
    await expect(page.getByText(/^Strong\./)).toBeVisible();
  });

  test("tells a visitor whose email already has an account, in words", async ({ page }) => {
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));
    const password = newPassphrase();

    await page.getByLabel(/^Full name/).fill("Alex Again");
    await page.getByLabel(/^Email address/).fill(customer.email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByLabel(/^Confirm password/).fill(password);
    await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(alertWith(page, "An account already exists for this email")).toBeVisible();
  });

  test("an administrator's address cannot be registered, and the message does not say why", async ({
    page,
  }) => {
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));
    const password = newPassphrase();

    await page.getByLabel(/^Full name/).fill("Someone Else");
    await page.getByLabel(/^Email address/).fill(admin.email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByLabel(/^Confirm password/).fill(password);
    await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page
        .getByText(
          "This email can't be registered here. Try signing in or resetting your password.",
        )
        .first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });
});

test.describe("recovering a password", () => {
  test("forgot → email link → reset → sign in with the new password, and the link works once", async ({
    page,
  }) => {
    const account = await createCustomerAccount();
    const newPassword = newPassphrase();

    await page.goto("/forgot-password");
    await expectHydrated(page.getByRole("form", { name: "Reset your password" }));
    await page.getByLabel(/^Email address/).fill(account.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByTestId("forgot-confirmation")).toContainText(
      "If an account exists for that email, we've sent a reset link.",
    );

    const link = await waitForResetLink(account.email);
    expect(link).toMatch(/^http:\/\/localhost:3000\/reset-password\?token=[A-Za-z0-9_-]{43}$/);

    await page.goto(link);
    await expectHydrated(page.getByRole("form", { name: "Choose a new password" }));
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel(/^Confirm new password/).fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-success")).toBeVisible();

    await page.getByRole("link", { name: "Sign in" }).first().click();
    await page.waitForURL("**/login");
    await submitLoginForm(page, account.email, account.password);
    await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
    await submitLoginForm(page, account.email, newPassword);
    await page.waitForURL("**/portal", { timeout: NAVIGATION_TIMEOUT });
    await expect(
      page.getByRole("heading", { level: 1, name: `Hello, ${account.name}` }),
    ).toBeVisible();

    // The link has been used.
    await signOut(page);
    await page.goto(link);
    await expectHydrated(page.getByRole("form", { name: "Choose a new password" }));
    await page.getByLabel(/^New password/).fill(newPassphrase());
    const pending = await page.getByLabel(/^New password/).inputValue();
    await page.getByLabel(/^Confirm new password/).fill(pending);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-invalid")).toBeVisible();
  });

  test("gives the same confirmation for an address with no account", async ({ page }) => {
    await page.goto("/forgot-password");
    await expectHydrated(page.getByRole("form", { name: "Reset your password" }));

    await page.getByLabel(/^Email address/).fill("nobody.here@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByTestId("forgot-confirmation")).toContainText(
      "If an account exists for that email, we've sent a reset link.",
    );
  });

  test("explains that the shared demo accounts cannot be reset", async ({ page }) => {
    await page.goto("/forgot-password");
    await expectHydrated(page.getByRole("form", { name: "Reset your password" }));

    await page.getByLabel(/^Email address/).fill(customer.email);
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(alertWith(page, "shared demo account")).toBeVisible();
    await expect(page.getByTestId("forgot-confirmation")).toHaveCount(0);
  });

  test("a missing or wrong link offers a way to request a new one", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-invalid")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );

    await page.goto("/reset-password?token=not-a-real-token");
    await expectHydrated(page.getByRole("form", { name: "Choose a new password" }));
    const password = newPassphrase();
    await page.getByLabel(/^New password/).fill(password);
    await page.getByLabel(/^Confirm new password/).fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-invalid")).toBeVisible();
  });

  test("the development note says where reset links are written", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByText(/no email is sent/i)).toContainText(".data/outbox");
  });
});

test.describe("changing your own password", () => {
  test("an administrator changes it, stays signed in, and the old password stops working", async ({
    page,
  }) => {
    // Not a shared demo account (those are locked in demo mode): the one extra allowlisted admin.
    const account = await createAdminAccount(E2E_SECOND_ADMIN_EMAIL, { name: "Jamie Fixture" });
    const newPassword = newPassphrase();
    await loginAs(page, account);

    await page.goto("/app/account");
    await expectHydrated(page.getByRole("form", { name: "Change password" }));
    await page.getByLabel(/^Current password/).fill(account.password);
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel(/^Confirm new password/).fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByTestId("password-changed")).toContainText(
      "other devices were signed out",
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();

    await signOut(page);
    await page.goto("/login");
    await submitLoginForm(page, account.email, account.password);
    await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
    await submitLoginForm(page, account.email, newPassword);
    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });
  });

  test("a customer has no password form yet: the profile page that will host it comes later", async ({
    page,
  }) => {
    const account = await createCustomerAccount();
    await loginAs(page, account);

    await expect(page.getByRole("form", { name: "Change password" })).toHaveCount(0);
  });
});

test.describe("console hygiene", () => {
  test("the auth screens log no React, hydration or network errors of their own", async ({
    page,
  }) => {
    // Google rejects the suite's deliberately fake client ID and says so in the console. That is the
    // only noise expected; anything else (a hydration mismatch, an invalid DOM nesting warning, a
    // failed request of ours) is a defect.
    const isGoogleNoise = (text: string) =>
      text.includes("[GSI_LOGGER]") || text.includes("status of 403");
    const problems: string[] = [];
    page.on("console", (message) => {
      if (
        (message.type() === "error" || message.type() === "warning") &&
        !isGoogleNoise(message.text())
      ) {
        problems.push(`[${message.type()}] ${message.text().slice(0, 300)}`);
      }
    });
    page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message.slice(0, 300)}`));

    await page.goto("/login");
    await expectHydrated(page.getByRole("form", { name: "Sign in" }));
    await page.goto("/register");
    await expectHydrated(page.getByRole("form", { name: "Create your account" }));
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(alertWith(page, "Enter your full name.")).toBeVisible();
    await page.goto("/forgot-password");
    await expectHydrated(page.getByRole("form", { name: "Reset your password" }));
    await page.goto("/reset-password?token=anything");
    await expectHydrated(page.getByRole("form", { name: "Choose a new password" }));
    await loginAs(page, "customer");
    await page.goto("/app/dashboard");
    await expect(
      page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    expect(problems).toEqual([]);
  });
});

test.describe("narrow screens", () => {
  for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/"]) {
    test(`${path} has no sideways scroll at 360px`, async ({ page }) => {
      await useViewport(page, 360);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await expectNoHorizontalOverflow(page);
    });
  }

  test("the public header keeps its Sign in link on a phone", async ({ page }) => {
    await useViewport(page, 360);
    await page.goto("/");

    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("the portal has no sideways scroll at 360px", async ({ page }) => {
    await useViewport(page, 360);
    await loginAs(page, "customer");

    await expectNoHorizontalOverflow(page);
  });
});
