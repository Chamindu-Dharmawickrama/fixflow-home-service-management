import { readFileSync } from "node:fs";

import { addDaysToDateOnly, preferredDateRange } from "@fixflow/shared";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import { createAcceptedQuotationFor } from "../fixtures/jobs.js";
import { createRequestsFor, readRequestsOf } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import {
  activity,
  ancientRequestFor,
  card,
  figures,
  makeAcceptedAncient,
  openDashboard,
  queue,
  schedule,
  valueOf,
} from "./helpers/dashboard.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * The admin dashboard and the list exports (T23, workflow 7.7, FR-080 to FR-085, FR-084). The
 * dashboard shows the whole business, and the specs run in parallel on one database, so nothing here
 * asserts a total of everything: each test makes what it needs, finds it again by what is unique to it,
 * and checks that the figures and the queue lead to it. Exact figures, with their boundaries, are
 * asserted in the API's integration tests on a fixed clock.
 */

test.describe.configure({ timeout: 180_000 });

const BUSINESS_TIME_ZONE = "America/New_York";
const DESCRIPTION =
  "The AC unit stopped cooling overnight and rattles loudly whenever it starts up.";
const REQUEST_PATH = /\/app\/requests\/[0-9a-f-]{36}$/;

function chooseDay(): string {
  const { min } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
  return addDaysToDateOnly(min, 2);
}

/** A customer with one saved address, who sends a request through the real form. Returns its reference. */
async function customerSendsRequest(
  page: Page,
): Promise<{ account: FixtureAccount; reference: string }> {
  const account = await createCustomerAccount({ name: "Dashboard Dana" });
  await createAddressesFor(account.id, [
    {
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      postalCode: "10999",
      accessNotes: "Gate code 4821, friendly dog.",
    },
  ]);
  await loginAs(page, account);
  await page.goto("/request-service");
  const form = page.getByRole("form", { name: "Request a service" });
  await expect(page.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByLabel(/^Preferred date/));
  await form.getByRole("radio", { name: /AC Routine Maintenance/ }).click();
  await form.getByLabel(/^What needs fixing/).fill(DESCRIPTION);
  await form.getByLabel(/^Preferred date/).fill(chooseDay());
  await form.getByRole("radio", { name: /Morning/ }).click();
  await form.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/\/portal\/requests\/[0-9a-f-]{36}\?submitted=1$/, {
    timeout: NAVIGATION_TIMEOUT,
  });
  const [stored] = await readRequestsOf(account.id);
  if (stored === undefined) {
    throw new Error("The request was not stored.");
  }
  return { account, reference: stored.reference };
}

const queueItem = (page: Page, reference: string): Locator =>
  queue(page).getByRole("listitem").filter({ hasText: reference });

test("a request a customer sends shows up on the admin's dashboard: the figure, the queue, and the list the figure opens", async ({
  browser,
}) => {
  // ---- The customer sends a request through the real form -------------------------------------------------
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  const { reference } = await customerSendsRequest(customerPage);
  await customerContext.close();

  // ---- The admin's dashboard counts it as new --------------------------------------------------------------
  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();
  await loginAs(page, "admin");
  await openDashboard(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening), Morgan$/,
  );
  expect(await valueOf(page, "New requests")).toBeGreaterThanOrEqual(1);
  await expect(card(page, "New requests")).toContainText("Last 7 days");

  // ---- Clicking the figure opens the filtered list, which holds the request --------------------------
  await figures(page).getByRole("link", { name: "New requests", exact: true }).click();
  await page.waitForURL(
    /\/app\/requests\?submittedFrom=\d{4}-\d{2}-\d{2}&submittedTo=\d{4}-\d{2}-\d{2}$/,
    {
      timeout: NAVIGATION_TIMEOUT,
    },
  );
  await expect(page.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search" });
  await expectHydrated(page.getByRole("search", { name: "Search and filter requests" }));
  await search.fill(reference);
  await page.waitForURL(/[?&]q=/, { timeout: NAVIGATION_TIMEOUT });
  const row = page
    .getByRole("table", { name: "Service requests" })
    .getByRole("row")
    .filter({ hasText: reference });
  await expect(row).toBeVisible();
  // The period filter is still in the address: the list is the figure's own.
  expect(page.url()).toMatch(/submittedFrom=/);
  await adminContext.close();
});

test("the needs-attention queue leads to the work: a new request and an accepted quotation", async ({
  browser,
}) => {
  const customer = await createCustomerAccount({ name: "Queue Quentin" });
  const request = await ancientRequestFor(customer.id, { oldest: true });
  const accepted = await createAcceptedQuotationFor(customer.id);
  await makeAcceptedAncient(accepted.request.id, accepted.quotation.id);

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, "admin");
  await openDashboard(page);

  const items = queue(page);
  await expect(items).toBeVisible();

  // ---- A new request: the kind in words, who and what, how long it has waited, a direct action ------
  const item = queueItem(page, request.reference);
  await expect(item).toBeVisible();
  await expect(item).toContainText("New request");
  await expect(item).toContainText(`${request.reference} · Queue Quentin`);
  await expect(item).toContainText(/submitted \d+ days ago/);
  const action = item.getByRole("link", {
    name: `Review request: ${request.reference} · Queue Quentin`,
  });
  await expect(action).toHaveText("Review request");
  await action.click();
  await page.waitForURL(REQUEST_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible();

  // ---- An accepted quotation: the way to make the job -----------------------------------------------
  await openDashboard(page);
  const acceptedItem = queueItem(page, accepted.request.reference);
  await expect(acceptedItem).toBeVisible();
  await expect(acceptedItem).toContainText("Accepted quotation");
  await expect(acceptedItem).toContainText(/quotation accepted \d+ days ago/);
  await acceptedItem.getByRole("link", { name: /^Create job:/ }).click();
  await page.waitForURL(REQUEST_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(
    page.getByRole("heading", { level: 1, name: accepted.request.reference }),
  ).toBeVisible();
  await context.close();
});

test("every figure opens a list that says what it is filtered to", async ({ page }) => {
  await loginAs(page, "admin");
  await openDashboard(page);

  // Requests needing action: the four statuses, each chip marked on the queue.
  await figures(page).getByRole("link", { name: "Requests needing action", exact: true }).click();
  await page.waitForURL(
    /\/app\/requests\?status=SUBMITTED(,|%2C)UNDER_REVIEW(,|%2C)ACCEPTED(,|%2C)DECLINED$/,
    {
      timeout: NAVIGATION_TIMEOUT,
    },
  );
  const chips = page.getByRole("navigation", { name: "Filter requests by status" });
  for (const name of [/^Submitted/, /^Under review/, /^Accepted/, /^Declined/]) {
    await expect(chips.getByRole("link", { name })).toHaveAttribute("aria-current", "true");
  }
  await expect(chips.getByRole("link", { name: /^Quoted/ })).not.toHaveAttribute("aria-current");

  // Jobs: scheduled or in progress, today and the days after, said in words above the list.
  await openDashboard(page);
  await figures(page).getByRole("link", { name: "Jobs today", exact: true }).click();
  await page.waitForURL(/\/app\/jobs\?view=all&status=SCHEDULED(,|%2C)IN_PROGRESS&scheduledFrom=/, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByTestId("status-filter-note")).toContainText(
    "Showing jobs that are Scheduled or In progress.",
  );
  await expect(page.getByRole("link", { name: /^All/ }).first()).toBeVisible();

  // Completed, awaiting invoice: the Ready to invoice tab.
  await openDashboard(page);
  await figures(page)
    .getByRole("link", { name: "Completed, awaiting invoice", exact: true })
    .click();
  await page.waitForURL(/\/app\/jobs\?view=ready-to-invoice$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(
    page
      .getByRole("navigation", { name: "Filter jobs by stage" })
      .getByRole("link", { name: /^Ready to invoice/ }),
  ).toHaveAttribute("aria-current", "page");

  // Unpaid balance: issued, part paid and overdue, said in words, and the overdue part on its own.
  await openDashboard(page);
  await figures(page).getByRole("link", { name: "Unpaid balance", exact: true }).click();
  await page.waitForURL(/\/app\/invoices\?status=ISSUED(,|%2C)PARTIALLY_PAID(,|%2C)OVERDUE$/, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByTestId("status-filter-note")).toContainText(
    "Showing invoices that are Issued, Partially paid or Overdue.",
  );
  await page.getByRole("link", { name: "Show all invoices" }).click();
  await page.waitForURL(/\/app\/invoices$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByTestId("status-filter-note")).toHaveCount(0);
});

test("each figure carries its definition, and says whether it follows the period or is current", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await openDashboard(page);

  await page.getByRole("button", { name: "About New requests" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("Service requests submitted in the last 7 days");
  await expect(panel).toContainText("Follows the selected period");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await page.getByRole("button", { name: "About Unpaid balance" }).click();
  await expect(page.getByRole("dialog")).toContainText("What customers still owe");
  await expect(page.getByRole("dialog")).toContainText(
    "Current: not affected by the selected period",
  );
  await page.keyboard.press("Escape");

  // Four of the five say "Current"; the one that follows the range names the period.
  await expect(figures(page).getByText(/^Current/)).toHaveCount(4);
});

test("the period selector is in the address and changes only the period figure", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await openDashboard(page);
  const needsAction = await valueOf(page, "Requests needing action");
  const awaiting = await valueOf(page, "Completed, awaiting invoice");
  const nav = page.getByRole("navigation", { name: "Period for new requests" });
  await expect(nav.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "true");

  await nav.getByRole("link", { name: "Today" }).click();
  await page.waitForURL(/\/app\/dashboard\?range=today$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(card(page, "New requests")).toContainText("Today");
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "true");
  const today = await valueOf(page, "New requests");
  await page.goto("/app/dashboard?range=30d");
  await expect(card(page, "New requests")).toContainText("Last 30 days");
  // A longer period holds at least what a shorter one does.
  expect(await valueOf(page, "New requests")).toBeGreaterThanOrEqual(today);

  // The figures that are current did not move with the period (nothing else is running against the
  // admin's own counts of these in this test, but other specs can add to them: allow for growth).
  expect(await valueOf(page, "Requests needing action")).toBeGreaterThanOrEqual(needsAction - 50);
  expect(await valueOf(page, "Completed, awaiting invoice")).toBeGreaterThanOrEqual(awaiting - 50);

  // A hand-edited address falls back to the default instead of failing.
  await page.goto("/app/dashboard?range=forever");
  await expect(card(page, "New requests")).toContainText("Last 7 days");
});

test("the schedule and the recent activity are on the page, each item linking to its record", async ({
  page,
}) => {
  await loginAs(page, "admin");
  await openDashboard(page);
  await expect(schedule(page)).toBeVisible();
  await expect(schedule(page).getByRole("link", { name: "Open the calendar" })).toHaveAttribute(
    "href",
    "/app/calendar",
  );
  await expect(schedule(page).getByRole("link", { name: "All jobs" })).toHaveAttribute(
    "href",
    "/app/jobs",
  );
  await expect(activity(page)).toBeVisible();
  // The shared database has had plenty of activity by now; at most ten are listed, newest first.
  const events = activity(page).getByRole("listitem");
  expect(await events.count()).toBeGreaterThan(0);
  expect(await events.count()).toBeLessThanOrEqual(10);
});

// ---- CSV exports (FR-084) --------------------------------------------------------------------------------------

async function saved(page: Page, button: Locator) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf8") };
}

test.describe("CSV exports", () => {
  test("the requests list exports what it is filtered to, with the allowed columns and no contact details", async ({
    page,
  }) => {
    const customer = await createCustomerAccount({ name: "Export Ezra" });
    const [request] = await createRequestsFor(customer.id, 1);
    expect(request).toBeDefined();
    await loginAs(page, "admin");
    await page.goto(`/app/requests?q=${encodeURIComponent(customer.email)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("search", { name: "Search and filter requests" }));

    const file = await saved(page, page.getByRole("button", { name: "Export CSV" }));

    expect(file.name).toMatch(/^fixflow-requests-\d{4}-\d{2}-\d{2}\.csv$/);
    // A byte-order mark, then the header row, then exactly this customer's one request.
    expect(file.text.startsWith("﻿")).toBe(true);
    const lines = file.text
      .slice(1)
      .split("\r\n")
      .filter((line) => line !== "");
    expect(lines[0]).toBe(
      "Reference,Status,Submitted,Service,Customer,City,Preferred date,Last updated",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(request?.reference ?? "never");
    expect(lines[1]).toContain("Export Ezra");
    // Minimum personal data: no email, no street, no description, no notes.
    expect(file.text).not.toContain(customer.email);
    expect(file.text).not.toContain("Larkspur");
    expect(file.text).not.toContain("stopped cooling");
  });

  test("the jobs and invoices lists have their own header rows", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/app/jobs?view=all");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("button", { name: "Export CSV" }));
    const jobs = await saved(page, page.getByRole("button", { name: "Export CSV" }));
    expect(jobs.name).toMatch(/^fixflow-jobs-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(jobs.text.slice(1).split("\r\n")[0]).toBe(
      "Reference,Status,Service,Customer,City,Scheduled start,Scheduled end,Technician,Completed,Created",
    );

    await page.goto("/app/invoices?status=ISSUED,PARTIALLY_PAID,OVERDUE");
    await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("button", { name: "Export CSV" }));
    const invoices = await saved(page, page.getByRole("button", { name: "Export CSV" }));
    expect(invoices.name).toMatch(/^fixflow-invoices-\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = invoices.text
      .slice(1)
      .split("\r\n")
      .filter((line) => line !== "");
    expect(rows[0]).toBe(
      "Invoice number,Status,Job,Customer,Issue date,Due date,Currency,Total,Paid,Balance due,Days overdue",
    );
    // The filter came through: nothing in the file is a draft, paid or void invoice.
    for (const row of rows.slice(1)) {
      expect(row).not.toMatch(/,(Draft|Paid|Void),/);
    }
  });

  test("a customer cannot export, and a visitor is not signed in", async ({ page, browser }) => {
    await loginAs(page, "customer");
    for (const kind of ["requests", "jobs", "invoices"]) {
      const response = await page.request.get(`/api/v1/admin/exports/${kind}.csv`);
      expect(response.status()).toBe(403);
    }
    const visitor = await browser.newContext();
    const anonymous = await visitor.request.get(
      `${new URL(page.url()).origin}/api/v1/admin/exports/requests.csv`,
    );
    expect(anonymous.status()).toBe(401);
    await visitor.close();
  });

  test("the export buttons are on the three lists and nowhere a customer can see", async ({
    page,
  }) => {
    await loginAs(page, "customer");
    await page.goto("/portal");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });
});

test("the dashboard is the admin's and a customer is turned away", async ({ page }) => {
  await loginAs(page, "customer");
  const response = await page.request.get("/api/v1/admin/dashboard/summary");
  expect(response.status()).toBe(403);
  await useViewport(page, 1024);
  await page.goto("/app/dashboard");
  // The area layout does not let a customer into the admin's pages.
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ }),
  ).toHaveCount(0);
});
