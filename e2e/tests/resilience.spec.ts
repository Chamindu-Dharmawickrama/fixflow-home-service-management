import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount, withDatabase } from "../fixtures/accounts.js";
import { createInvoiceFor } from "../fixtures/customers.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  invoiceById,
  paymentsOfInvoice,
} from "../fixtures/invoices.js";
import { readRequestState } from "../fixtures/requests.js";
import { loginAs, submitLoginForm } from "../support/auth.js";
import { clearFaults, injectFault } from "../support/faults.js";
import { jobBadge } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";
import { customerWithRequest, toast } from "./helpers/quotations.js";

/**
 * Error handling and resilience (T25, NFR-05, TS-E2E-02, spec §10.4 "never show fake success"):
 *
 * - a list page and a detail page whose data cannot be read show the error state with a retry, and
 *   the retry works once the API answers again;
 * - a change that fails (the connection drops, or the API answers 500) says so, keeps the dialog or
 *   form, stores nothing, and shows **no** success;
 * - an API that does not answer at all (a cold start) is explained on the signed-in pages too (the
 *   public pages: `public-site-api-down.spec.ts`);
 * - a session that ends mid-way sends the person to sign in and back to where they were;
 * - an unknown address and an unexpected error use the design system's pages.
 *
 * The web server's own reads cannot be intercepted by Playwright, so those faults are injected by the
 * fault proxy between the web server and the API, for this test's session only (`support/faults.ts`).
 */

test.describe.configure({ timeout: 120_000 });

const mainAlert = (page: Page) => page.getByRole("main").getByRole("alert");

/** A picture of an error state, for the visual QA of spec §18.4 (one visual language for every state). */
const STATES = resolve(import.meta.dirname, "../../artifacts/screenshots/t25/states");
async function shootState(page: Page, name: string): Promise<void> {
  mkdirSync(STATES, { recursive: true });
  await page.screenshot({ path: resolve(STATES, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, account: FixtureAccount): Promise<void> {
  await loginAs(page, { email: account.email, password: account.password });
}

test.describe("data that cannot be loaded", () => {
  test("a list page shows the error with a retry, and the retry loads the list", async ({
    page,
    context,
  }) => {
    await useViewport(page, 1440);
    await loginAs(page, "admin");
    await injectFault(context, { path: /^\/api\/v1\/admin\/requests(\?|$)/, method: "GET" });

    await page.goto("/app/requests");
    await expect(mainAlert(page)).toContainText("We couldn't load the requests", {
      timeout: NAVIGATION_TIMEOUT,
    });
    // The API's sentence already says to try again; the page does not repeat it (T25 copy fix).
    await expect(mainAlert(page)).toContainText(
      "Something went wrong on our side. Please try again.",
    );
    await expect(mainAlert(page)).not.toContainText("Try again in a moment.");
    // The shell stays, so the person can still go elsewhere; the list itself is not drawn.
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Service requests" })).toHaveCount(0);
    expect(await seriousViolations(page)).toBe("");
    await shootState(page, "list-error-requests");

    await clearFaults(context);
    await mainAlert(page).getByRole("link", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  // F-88 and F-96: neither page's error state could be reached end to end before the fault proxy.
  for (const [path, api, title] of [
    ["/app/dashboard", /^\/api\/v1\/admin\/dashboard\/summary/, "We couldn't load the dashboard"],
    ["/app/calendar", /^\/api\/v1\/admin\/calendar/, "We couldn't load the calendar"],
  ] as const) {
    test(`${path} shows its error with a retry when its data cannot be read`, async ({
      page,
      context,
    }) => {
      await useViewport(page, 1440);
      await loginAs(page, "admin");
      await injectFault(context, { path: api, method: "GET" });

      await page.goto(path);
      await expect(mainAlert(page)).toContainText(title, { timeout: NAVIGATION_TIMEOUT });
      await expect(mainAlert(page).getByRole("link", { name: "Try again" })).toBeVisible();
      expect(await seriousViolations(page)).toBe("");
      await shootState(page, `page-error${path.replaceAll("/", "-")}`);

      await clearFaults(context);
      await mainAlert(page).getByRole("link", { name: "Try again" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0, {
        timeout: NAVIGATION_TIMEOUT,
      });
    });
  }

  test("a detail page shows the error with a retry, and the retry loads the record", async ({
    page,
    context,
  }) => {
    const customer = await createCustomerAccount({ name: "Reese Retry" });
    const invoice = await createInvoiceFor(customer.id, { status: "ISSUED", total: "160.00" });
    await signIn(page, customer);
    await injectFault(context, {
      path: new RegExp(`^/api/v1/invoices/${invoice.invoiceId}(\\?|$)`),
      method: "GET",
    });

    await page.goto(`/portal/invoices/${invoice.invoiceId}`);
    await expect(mainAlert(page)).toContainText("We couldn't load this invoice", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

    await clearFaults(context);
    await mainAlert(page).getByRole("link", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Invoice ${invoice.invoiceNumber ?? ""}` }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("a change that fails", () => {
  test("a dropped connection on Start review says so, changes nothing and shows no success; the second try works", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest("Nina Network", { status: "SUBMITTED" });
    await loginAs(page, "admin");
    await page.goto(`/app/requests/${request.id}`);
    await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    const start = page.getByRole("button", { name: "Start review" });
    await expectHydrated(start);

    await page.route("**/api/v1/admin/requests/*/status", (route) => route.abort("failed"));
    await start.click();
    await expect(page.getByText("We couldn't reach the server.")).toBeVisible();
    await expect(toast(page, "is under review")).toHaveCount(0);
    await expect(page.locator("main header [data-status]").first()).toHaveAttribute(
      "data-status",
      "SUBMITTED",
    );
    expect((await readRequestState(request.id)).status).toBe("SUBMITTED");

    await page.unroute("**/api/v1/admin/requests/*/status");
    await start.click();
    await expect(toast(page, `${request.reference} is under review`)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    // The confirmation is announced: the toast lives in a polite live region (spec §18.4, UX-08).
    await expect(
      page
        .locator("[aria-live=polite]")
        .filter({ has: toast(page, `${request.reference} is under review`) }),
    ).toHaveCount(1);
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");
  });

  test("a server error while recording a payment keeps the dialog, stores nothing and shows no success", async ({
    page,
    context,
  }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: "Sami Server" });
    const job = await createCompletedJobWithQuote(customer.id);
    const invoice = await insertInvoiceFor(job, customer.id, {
      status: "ISSUED",
      issueDate: "2026-11-02",
      dueDate: "2999-01-01",
    });
    await loginAs(page, "admin");
    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: invoice.invoiceNumber ?? "" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    const record = page
      .getByTestId("invoice-payments")
      .filter({ visible: true })
      .getByRole("button", { name: "Record payment" });
    await expectHydrated(record);
    await injectFault(context, {
      path: new RegExp(`^/api/v1/admin/invoices/${invoice.id}/payments$`),
      method: "POST",
      times: 1,
    });

    await record.click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await dialog.getByLabel(/Amount received/).fill("40.00");
    await dialog.getByLabel(/How it was received/).selectOption({ label: "Cash" });
    await dialog.getByRole("button", { name: "Record payment" }).click();

    await expect(dialog.getByRole("alert")).toContainText("Something went wrong on our side");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/Amount received/)).toHaveValue("40.00");
    await expect(toast(page, "Payment recorded")).toHaveCount(0);
    expect(await paymentsOfInvoice(invoice.id)).toHaveLength(0);
    expect((await invoiceById(invoice.id)).status).toBe("ISSUED");

    // The fault fired once; the same dialog, sent again, records the payment once.
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog).toBeHidden({ timeout: NAVIGATION_TIMEOUT });
    await expect(jobBadge(page)).toHaveAttribute("data-status", "PARTIALLY_PAID", {
      timeout: NAVIGATION_TIMEOUT,
    });
    expect(await paymentsOfInvoice(invoice.id)).toHaveLength(1);
  });
});

test.describe("an API that does not answer", () => {
  test("the business and customer areas explain it and offer a retry that works once it is back", async ({
    browser,
  }) => {
    const customer = await createCustomerAccount({ name: "Cole Coldstart" });
    for (const [who, path, heading] of [
      // The dashboard greets by the time of day on the business's clocks.
      ["admin", "/app/dashboard", /^Good (morning|afternoon|evening)/],
      [customer, "/portal", /^Hello, /],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginAs(page, who === "admin" ? "admin" : who);
      await injectFault(context, { path: /^\/api\/v1\//, mode: "drop" });

      await page.goto(path);
      const unavailable = page.getByRole("alert").filter({
        hasText: "We can't reach FixFlow right now",
      });
      await expect(unavailable).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(unavailable).toContainText("starting up");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("FixFlow is not available");
      expect(await seriousViolations(page)).toBe("");
      await shootState(page, `unavailable${path.replaceAll("/", "-")}`);

      await clearFaults(context);
      await unavailable.getByRole("link", { name: "Try again" }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await context.close();
    }
  });
});

test.describe("a session that ends", () => {
  async function endSessionsOf(userId: string): Promise<void> {
    await withDatabase((prisma) =>
      prisma.session.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );
  }

  test("the next page sends the person to sign in and back to that page, with its query", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Sid Session" });
    await signIn(page, customer);
    // Leave the portal first: its notification bell would meet the ended session on its next poll and
    // send the page to sign-in by itself (correctly), racing this test's own navigation.
    await page.goto("/privacy");
    await endSessionsOf(customer.id);

    await page.goto("/portal/requests?status=SUBMITTED");
    await page.waitForURL(/\/login\?returnTo=/, { timeout: NAVIGATION_TIMEOUT });
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
      "/portal/requests?status=SUBMITTED",
    );
    await submitLoginForm(page, customer.email, customer.password);
    await page.waitForURL(/\/portal\/requests\?status=SUBMITTED$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("a change made after the session ended sends the person to sign in, saves nothing, and comes back", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Mia Midway" });
    await signIn(page, customer);
    // The bell's poll would also meet the ended session (and correctly send the page to sign-in);
    // keep it quiet so the save is the request that finds out.
    await page.route("**/api/v1/notifications/**", (route) => route.abort());
    await page.goto("/portal/profile");
    const form = page.getByRole("form", { name: "Contact details" });
    await expectHydrated(form);
    await endSessionsOf(customer.id);

    await form.getByLabel(/^Phone number/).fill("(212) 555-0199");
    await form.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/login\?returnTo=/, { timeout: NAVIGATION_TIMEOUT });
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/portal/profile");
    const stored = await withDatabase((prisma) =>
      prisma.customerProfile.findUniqueOrThrow({
        where: { userId: customer.id },
        select: { phone: true },
      }),
    );
    expect(stored.phone).not.toBe("(212) 555-0199");

    await submitLoginForm(page, customer.email, customer.password);
    await page.waitForURL(/\/portal\/profile$/, { timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("the error and not-found pages", () => {
  test("an unknown address answers 404 with the branded page and a way home", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't find that page" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page).toHaveTitle(/Page not found/);
    expect(await seriousViolations(page)).toBe("");
    await shootState(page, "not-found");
  });

  test("an unexpected error shows the branded error page with a retry and no internals", async ({
    page,
    context,
  }) => {
    await loginAs(page, "admin");
    // A 400 from the session check is nothing a page handles, so it reaches the error boundary.
    await injectFault(context, { path: /^\/api\/v1\/auth\/me$/, status: 400 });

    await page.goto("/app/technicians");
    const error = page.getByRole("alert").filter({ hasText: "Something went wrong" });
    await expect(error).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(error.getByRole("button", { name: "Try again" })).toBeVisible();
    await shootState(page, "error-boundary");
    await expect(page.getByRole("main")).not.toContainText("BAD_REQUEST");
    await expect(page.getByRole("main")).not.toContainText("e2e-fault");
    await clearFaults(context);
  });
});

test.describe("the empty states", () => {
  test("a new customer's lists say there is nothing yet and what to do, in the shared empty state", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Nell Newcomer" });
    await signIn(page, customer);
    for (const [path, name] of [
      ["/portal", "empty-portal-overview"],
      ["/portal/requests", "empty-portal-requests"],
      ["/portal/jobs", "empty-portal-jobs"],
      ["/portal/invoices", "empty-portal-invoices"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      // Every empty list offers a way forward (a link or a button), never a dead end.
      await expect(page.getByRole("main").getByRole("link").first()).toBeVisible();
      expect(await seriousViolations(page), path).toBe("");
      await shootState(page, name);
    }
  });
});

test.describe("a session that goes on", () => {
  test("a session last renewed over an hour ago gets a fresh cookie in the browser (F-25)", async ({
    page,
    context,
  }) => {
    const customer = await createCustomerAccount({ name: "Remy Renewal" });
    await signIn(page, customer);
    // As if the person had been away: last renewed two hours ago, a day of life left.
    await withDatabase((prisma) =>
      prisma.session.updateMany({
        where: { userId: customer.id },
        data: {
          lastUsedAt: new Date(Date.now() - 2 * 3_600_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    );
    // The keep-alive asks at most every 30 minutes per browser; forget that it just did.
    await page.evaluate(() => window.localStorage.removeItem("fixflow:session-checked-at"));

    const renewal = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/auth/me?refresh=1") && response.status() === 200,
    );
    await page.goto("/portal/requests");
    const answer = await renewal;
    expect((await answer.allHeaders())["set-cookie"] ?? "").toMatch(/fixflow_session=/);

    const stored = await withDatabase((prisma) =>
      prisma.session.findFirstOrThrow({
        where: { userId: customer.id },
        orderBy: { lastUsedAt: "desc" },
        select: { expiresAt: true },
      }),
    );
    const sixDays = Date.now() + 6 * 86_400_000;
    expect(stored.expiresAt.getTime()).toBeGreaterThan(sixDays);
    const cookie = (await context.cookies()).find((item) => item.name === "fixflow_session");
    expect((cookie?.expires ?? 0) * 1000).toBeGreaterThan(sixDays);
  });
});
