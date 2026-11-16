import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import {
  activityAboutCustomer,
  createCustomersTagged,
  createInvoiceFor,
  createJobFor,
  customerNotesOf,
  newPhone,
  newTag,
  profileIdOf,
  setPhone,
} from "../fixtures/customers.js";
import { createRequestsFor } from "../fixtures/requests.js";
import { loginAs, signOut } from "../support/auth.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The admin customer directory and customer pages (T13, FR-031, FR-033, IA-A08, IA-A09). Every flow
 * runs on customers made for that test and finds them again by something unique to them (an email,
 * a tag in the name, a phone number), because the specs run in parallel on one shared demo admin and
 * one database: nothing here asserts a count of everything. The seeded demo customers are only read.
 * Rows are read back straight from the E2E database.
 */

test.describe.configure({ timeout: 120_000 });

const CUSTOMER_PATH = /\/app\/customers\/[0-9a-f-]{36}(\?.*)?$/;
const REQUEST_PATH = /\/app\/requests\/[0-9a-f-]{36}$/;
const UNKNOWN_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const directory = (page: Page): Locator => page.getByRole("table", { name: "Customers" });
const rowFor = (page: Page, text: string): Locator =>
  directory(page).getByRole("row").filter({ hasText: text });
const searchBox = (page: Page): Locator => page.getByRole("searchbox", { name: "Search" });
const historyTabs = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Customer history" });
const summary = (page: Page): Locator => page.getByRole("region", { name: "Summary" });
const noteBox = (page: Page): Locator => page.getByRole("textbox", { name: /^Note/ });
const noteList = (page: Page): Locator =>
  page.getByRole("list", { name: "Internal notes about this customer" });

async function openDirectory(page: Page, query = ""): Promise<void> {
  await page.goto(`/app/customers${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("search", { name: "Search customers" }));
}

async function openCustomer(page: Page, userId: string, query = ""): Promise<string> {
  const profileId = await profileIdOf(userId);
  await page.goto(`/app/customers/${profileId}${query}`);
  await expect(page.getByRole("form", { name: "Add an internal note" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("form", { name: "Add an internal note" }));
  return profileId;
}

/**
 * Types in the search box like a person and waits until the address carries exactly that search
 * (the list reloads after a short pause in typing, so the address is what says it has happened).
 */
async function searchFor(page: Page, text: string): Promise<void> {
  // Text typed before the box's handler is attached is never searched for (seen under load in T25).
  await expectHydrated(searchBox(page));
  await searchBox(page).fill(text);
  const wanted = text.trim().replace(/\s+/g, " ");
  await page.waitForURL((url) => url.searchParams.get("q") === wanted, {
    timeout: NAVIGATION_TIMEOUT,
  });
}

type Tab = "requests" | "quotations" | "jobs" | "invoices";

const TAB_LABELS: Record<Tab, string> = {
  requests: "Requests",
  quotations: "Quotations",
  jobs: "Jobs",
  invoices: "Invoices",
};

/** Presses a history tab and waits until it is the one the address and the page say is open. */
async function openTab(page: Page, tab: Tab): Promise<void> {
  const link = historyTabs(page).getByRole("link", { name: new RegExp(`^${TAB_LABELS[tab]}`) });
  await link.click();
  await page.waitForURL((url) => url.searchParams.get("tab") === tab, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(link).toHaveAttribute("aria-current", "page", { timeout: NAVIGATION_TIMEOUT });
}

async function addNote(page: Page, text: string): Promise<void> {
  await noteBox(page).fill(text);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(noteList(page).getByText(text)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}

/**
 * Scans the page for serious accessibility problems. A toast that is still sliding in is measured
 * mid-animation (a smaller target than it will be), so it waits for the toasts to go first.
 */
async function expectAccessible(page: Page, scope?: string): Promise<void> {
  // A toast under the pointer stays until the pointer leaves it.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  expect(await seriousViolations(page, scope), "serious axe violations").toBe("");
}

async function customerWithName(name: string): Promise<FixtureAccount> {
  return createCustomerAccount({ name });
}

test.describe("finding a customer and seeing their history (FR-031)", () => {
  test("searches for Alex, opens the customer, sees their request, adds an internal note and opens the request from the history", async ({
    page,
  }) => {
    const tag = newTag();
    const account = await customerWithName(`Alex Brightwell ${tag}`);
    const [request] = await createRequestsFor(account.id, 1);
    const reference = request?.reference ?? "";
    const phone = newPhone();
    await setPhone(account.id, phone.text);
    const note = "Prefers a call after 5pm; the side gate sticks.";

    await loginAs(page, "admin");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Customers" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("search", { name: "Search customers" }));

    // "Alex" finds the seeded Alex Morgan (read, never changed) ...
    await searchFor(page, "Alex");
    await expect(rowFor(page, "Alex Morgan")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    // ... and the customer made for this test is found by their full name.
    await searchFor(page, account.name);
    const row = rowFor(page, account.name);
    await expect(row).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(row).toContainText(account.email);
    await expect(row).toContainText(phone.text);
    await expect(row).toContainText("No address saved");
    await row.getByRole("link", { name: account.name }).click();
    await page.waitForURL(CUSTOMER_PATH, { timeout: NAVIGATION_TIMEOUT });

    // The customer's page: who they are, how to reach them, since when.
    await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
    await expect(page.getByRole("link", { name: `Email ${account.email}` })).toHaveAttribute(
      "href",
      `mailto:${account.email}`,
    );
    await expect(page.getByRole("link", { name: `Call ${phone.text}` })).toHaveAttribute(
      "href",
      `tel:${phone.text}`,
    );
    await expect(page.getByRole("main")).toContainText("Customer since");
    await expectHydrated(page.getByRole("form", { name: "Add an internal note" }));

    // Their request is in the Requests tab, which is the tab that opens first.
    await expect(historyTabs(page).getByRole("link", { name: /^Requests/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const requestRow = page.getByRole("table", { name: "Requests" }).getByRole("row").filter({
      hasText: reference,
    });
    await expect(requestRow).toBeVisible();
    await expect(requestRow.locator("[data-status]")).toHaveAttribute("data-status", "SUBMITTED");

    // An internal note: marked in words as never shown to the customer, then listed with its author.
    await expect(page.getByText("Internal — never shown to the customer")).toBeVisible();
    await addNote(page, note);
    await expect(noteList(page).getByRole("listitem")).toHaveCount(1);
    await expect(noteList(page)).toContainText("Morgan Reyes");
    const stored = await customerNotesOf(account.id);
    expect(stored.map((item) => [item.body, item.author.name])).toEqual([[note, "Morgan Reyes"]]);
    const events = await activityAboutCustomer(account.id);
    expect(events).toEqual([
      {
        action: "customer.note_added",
        summary: `Morgan Reyes added an internal note about ${account.name}.`,
        publicSummary: null,
      },
    ]);

    // From the history to the request, and from the request back to the customer.
    await requestRow.getByRole("link", { name: reference }).click();
    await page.waitForURL(REQUEST_PATH, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
    await page.getByRole("link", { name: "View full customer history" }).click();
    await page.waitForURL(CUSTOMER_PATH, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
    await expect(noteList(page)).toContainText(note);
  });

  test("finds a customer by email in any case, and by phone however the digits are written", async ({
    page,
  }) => {
    const account = await customerWithName("Priscilla Fixture");
    const phone = newPhone();
    await setPhone(account.id, phone.text);
    const area = phone.digits.slice(0, 3);
    const exchange = phone.digits.slice(3, 6);
    const last = phone.digits.slice(6);

    await loginAs(page, "admin");
    await openDirectory(page);

    for (const query of [
      account.email.toUpperCase(),
      account.email.slice(0, account.email.indexOf("@")),
      phone.text,
      phone.digits,
      `${area}-${exchange}-${last}`,
      `${area}.${exchange}.${last}`,
      `${exchange} ${last}`,
    ]) {
      await searchBox(page).fill(query);
      await expect(rowFor(page, account.email)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(directory(page).getByRole("row")).toHaveCount(2);
    }
  });

  test("keeps the search in the address, tells a search with no result what to do, and clears it", async ({
    page,
  }) => {
    const account = await customerWithName("Rosalind Fixture");

    await loginAs(page, "admin");
    await openDirectory(page);
    await searchFor(page, account.email);
    await expect(rowFor(page, account.email)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    expect(new URL(page.url()).searchParams.get("q")).toBe(account.email);

    // A reload keeps the search and what it found.
    await page.reload();
    await expectHydrated(page.getByRole("search", { name: "Search customers" }));
    await expect(searchBox(page)).toHaveValue(account.email);
    await expect(rowFor(page, account.email)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    // Nothing matches: the page says so and offers the way back.
    await searchFor(page, `nobody-${newTag()}`);
    await expect(page.getByRole("heading", { name: "No customers match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(directory(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Show all customers" }).click();
    await page.waitForURL((url) => !url.searchParams.has("q"), { timeout: NAVIGATION_TIMEOUT });
    await expect(directory(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(searchBox(page)).toHaveValue("");

    // "Clear search" does the same from a search that found something.
    await searchFor(page, account.email);
    await expect(rowFor(page, account.email)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await page.getByRole("link", { name: "Clear search" }).click();
    await page.waitForURL((url) => !url.searchParams.has("q"), { timeout: NAVIGATION_TIMEOUT });
    await expect(searchBox(page)).toHaveValue("");
  });

  test("treats what is typed as text: a pattern character or SQL finds nobody and breaks nothing", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await openDirectory(page);

    for (const query of ["%", "_", "' OR '1'='1", "x'); DROP TABLE users; --"]) {
      await searchFor(page, query);
      await expect(page.getByRole("heading", { name: "No customers match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
    }
    // The directory still works afterwards, and the seeded customers are still there.
    await searchFor(page, "Alex Morgan");
    await expect(rowFor(page, "Alex Morgan")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("sorting and pages (FR-031)", () => {
  test("sorts by name from a column header and from the Sort by control, and keeps the search", async ({
    page,
  }) => {
    const tag = newTag();
    // Made in this order, so "Customer since" is the reverse of the alphabet.
    const zed = await customerWithName(`Zed ${tag}`);
    const mid = await customerWithName(`Mid ${tag}`);
    const abe = await customerWithName(`Abe ${tag}`);
    const names = [abe, mid, zed].map((account) => account.name);

    await loginAs(page, "admin");
    await openDirectory(page);
    await searchFor(page, tag);
    const rows = directory(page).getByRole("row");
    await expect(rows).toHaveCount(4, { timeout: NAVIGATION_TIMEOUT });
    const order = async () =>
      (await rows.allTextContents())
        .slice(1)
        .map((text) => names.find((name) => text.includes(name)));

    // A to Z to begin with.
    await expect(
      directory(page).getByRole("columnheader", { name: "Customer", exact: true }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(await order()).toEqual(names);

    // The header turns it round, and the search stays.
    await directory(page).getByRole("link", { name: "Customer", exact: true }).click();
    await page.waitForURL(/order=desc/, { timeout: NAVIGATION_TIMEOUT });
    await expect(
      directory(page).getByRole("columnheader", { name: "Customer", exact: true }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(await order()).toEqual([...names].reverse());
    expect(new URL(page.url()).searchParams.get("q")).toBe(tag);

    // The same from the control, which is what a phone has: newest customers first.
    await page.getByLabel("Sort by").selectOption("createdAt");
    await page.waitForURL(/sort=createdAt/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByLabel("Order")).toHaveValue("desc");
    await expect(page.getByLabel("Sort by")).toHaveValue("createdAt");
    // Made last is Abe, then Mid, then Zed.
    expect(await order()).toEqual(names);
    await page.getByLabel("Order").selectOption("asc");
    await page.waitForURL(/order=asc/, { timeout: NAVIGATION_TIMEOUT });
    expect(await order()).toEqual([...names].reverse());
    expect(new URL(page.url()).searchParams.get("q")).toBe(tag);

    // Last activity is a sort too.
    await page.getByLabel("Sort by").selectOption("lastActivityAt");
    await page.waitForURL(/sort=lastActivityAt/, { timeout: NAVIGATION_TIMEOUT });
    await expect(
      directory(page).getByRole("columnheader", { name: "Last activity" }),
    ).toHaveAttribute("aria-sort", /ascending|descending/);
  });

  test("pages the directory twenty at a time and keeps the search on every page", async ({
    page,
  }) => {
    const tag = newTag();
    await createCustomersTagged(tag, 23);

    await loginAs(page, "admin");
    await openDirectory(page);
    await searchFor(page, tag);

    await expect(page.getByText(/Showing 1–20 of 23 customers/)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(directory(page).getByRole("row")).toHaveCount(21);
    await expect(rowFor(page, `Tagged ${tag} 01`)).toBeVisible();
    await expect(rowFor(page, `Tagged ${tag} 21`)).toHaveCount(0);

    await page.getByRole("link", { name: "Next page" }).click();
    await page.waitForURL(/page=2/, { timeout: NAVIGATION_TIMEOUT });
    const params = new URL(page.url()).searchParams;
    expect(params.get("q")).toBe(tag);
    await expect(page.getByText(/Showing 21–23 of 23 customers/)).toBeVisible();
    await expect(directory(page).getByRole("row")).toHaveCount(4);
    await expect(rowFor(page, `Tagged ${tag} 23`)).toBeVisible();

    // Searching again starts over from the first page.
    await searchFor(page, `Tagged ${tag} 0`);
    await expect(page.getByText(/Showing 1–9 of 9 customers/)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  });
});

test.describe("a customer's page (FR-030, FR-031)", () => {
  test("counts their requests and open jobs and what they still owe, in the list and on their page, with each tab holding its own records", async ({
    page,
  }) => {
    const account = await customerWithName("Hollis Fixture");
    await createAddressesFor(account.id, [
      {
        label: "Home",
        line1: "214 Larkspur Lane",
        city: "Harbor City",
        accessNotes: "Gate code 4821",
      },
      { label: "Rental", line1: "9 Quay Street", city: "Port Elm" },
    ]);
    // Three jobs (two open, one finished), then five invoices, each on a finished job of its own.
    await createJobFor(account.id, { status: "PENDING_SCHEDULING" });
    await createJobFor(account.id, {
      status: "SCHEDULED",
      scheduledStart: new Date(Date.now() + 5 * 86_400_000),
    });
    await createJobFor(account.id, { status: "COMPLETED" });
    const partly = await createInvoiceFor(account.id, {
      status: "PARTIALLY_PAID",
      total: "216.00",
      paid: "100.50",
    });
    await createInvoiceFor(account.id, { status: "ISSUED", total: "108.00" });
    await createInvoiceFor(account.id, { status: "PAID", total: "50.00", paid: "50.00" });
    await createInvoiceFor(account.id, { status: "DRAFT", total: "77.00" });
    await createInvoiceFor(account.id, { status: "VOID", total: "999.00" });

    await loginAs(page, "admin");

    // In the list: 8 requests, 2 open jobs, and 108.00 + (216.00 − 100.50) = 223.50 owed.
    await openDirectory(page);
    await searchFor(page, account.email);
    const row = rowFor(page, account.email);
    await expect(row).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(row.getByRole("cell").nth(2)).toHaveText("Harbor City");
    await expect(row.getByRole("cell").nth(3)).toHaveText("8");
    await expect(row.getByRole("cell").nth(4)).toHaveText("2");
    await expect(row.getByRole("cell").nth(5)).toHaveText("$223.50");

    // On the page: the same figures, from the same data.
    await row.getByRole("link", { name: account.name }).click();
    await page.waitForURL(CUSTOMER_PATH, { timeout: NAVIGATION_TIMEOUT });
    await expectHydrated(page.getByRole("form", { name: "Add an internal note" }));
    await expect(summary(page).locator("p.font-display")).toHaveText(["8", "2", "$223.50"]);
    await expect(summary(page)).toContainText("8 quotations");
    await expect(summary(page)).toContainText("8 in total");
    await expect(summary(page)).toContainText("Still to be paid, across 5 invoices");

    // Both addresses, the default first, with the access notes the team needs on site.
    await expect(page.getByRole("heading", { level: 2, name: "Service addresses" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Home" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("214 Larkspur Lane");
    await expect(page.getByRole("main")).toContainText("Access notes: Gate code 4821");
    await expect(page.getByRole("heading", { level: 3, name: "Rental" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Default");

    // The tabs and what each one holds.
    await expect(historyTabs(page).getByRole("link")).toHaveText([
      /^Requests\s*8$/,
      /^Quotations\s*8$/,
      /^Jobs\s*8$/,
      /^Invoices\s*5$/,
    ]);
    await expect(page.getByRole("table", { name: "Requests" }).getByRole("row")).toHaveCount(9);

    await openTab(page, "quotations");
    const quotations = page.getByRole("table", { name: "Quotations" });
    await expect(quotations.getByRole("row")).toHaveCount(9, { timeout: NAVIGATION_TIMEOUT });
    // The reference opens the quotation (T14, F-58); the request it belongs to is linked as well.
    const firstQuotation = quotations.getByRole("row").nth(1);
    await expect(firstQuotation.getByRole("link")).toHaveCount(2);
    await expect(firstQuotation.locator("[data-status]")).toHaveAttribute(
      "data-status",
      "ACCEPTED",
    );
    await firstQuotation.getByRole("link", { name: /^QT-/ }).click();
    await page.waitForURL(/\/app\/quotations\/[0-9a-f-]{36}$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: /^Quotation QT-/ })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page.goBack();
    await expect(quotations.getByRole("row")).toHaveCount(9, { timeout: NAVIGATION_TIMEOUT });
    await quotations.getByRole("row").nth(1).getByRole("link", { name: /FF-/ }).click();
    await page.waitForURL(REQUEST_PATH, { timeout: NAVIGATION_TIMEOUT });
    await page.goBack();

    await openTab(page, "jobs");
    const jobs = page.getByRole("table", { name: "Jobs" });
    await expect(jobs.getByRole("row")).toHaveCount(9, { timeout: NAVIGATION_TIMEOUT });
    await expect(jobs.locator('[data-status="PENDING_SCHEDULING"]')).toHaveCount(1);
    await expect(jobs.locator('[data-status="SCHEDULED"]')).toHaveCount(1);
    await expect(jobs.locator('[data-status="COMPLETED"]')).toHaveCount(6);
    await expect(jobs).toContainText("Not scheduled yet");

    await openTab(page, "invoices");
    const invoices = page.getByRole("table", { name: "Invoices" });
    await expect(invoices.getByRole("row")).toHaveCount(6, { timeout: NAVIGATION_TIMEOUT });
    const partlyRow = invoices.getByRole("row").filter({ hasText: partly.invoiceNumber ?? "" });
    await expect(partlyRow.locator("[data-status]")).toHaveAttribute(
      "data-status",
      "PARTIALLY_PAID",
    );
    await expect(partlyRow).toContainText("$216.00");
    await expect(partlyRow).toContainText("$100.50");
    await expect(partlyRow).toContainText("$115.50");
    await expect(invoices.locator('[data-status="DRAFT"]')).toHaveCount(1);
    await expect(
      invoices.getByRole("row").filter({ has: page.locator('[data-status="DRAFT"]') }),
    ).toContainText("Draft");
    await expect(invoices.locator('[data-status="VOID"]')).toHaveCount(1);
    await expect(invoices.locator('[data-status="PAID"]')).toHaveCount(1);
  });

  test("says what an empty tab is waiting for, and offers nothing that does not exist yet", async ({
    page,
  }) => {
    const account = await customerWithName("Ingrid Fixture");

    await loginAs(page, "admin");
    await openCustomer(page, account.id);

    const expected: [Tab, string, RegExp][] = [
      ["requests", "No requests yet", /hasn't sent a service request/],
      ["quotations", "No quotations yet", /quotations you prepare for Ingrid Fixture/],
      ["jobs", "No jobs yet", /A job starts when Ingrid Fixture accepts a quotation/],
      ["invoices", "No invoices yet", /invoices for Ingrid Fixture's completed jobs/],
    ];
    for (const [tab, title, description] of expected) {
      await openTab(page, tab);
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(page.getByText(description)).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
    }
    // The figures say the same: nothing yet, nothing owed.
    await expect(summary(page).locator("p.font-display")).toHaveText(["0", "0", "$0.00"]);
    await expect(page.getByText("No address saved yet")).toBeVisible();
    await expect(page.getByText("No internal notes yet")).toBeVisible();
  });

  test("pages a long history inside a tab, keeps the tab in the address, and starts the next tab on its first page", async ({
    page,
  }) => {
    const account = await customerWithName("Jules Fixture");
    await createRequestsFor(account.id, 12);
    await createJobFor(account.id);

    await loginAs(page, "admin");
    await openCustomer(page, account.id);

    await expect(page.getByText(/Showing 1–10 of 13 requests/)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("table", { name: "Requests" }).getByRole("row")).toHaveCount(11);

    await page.getByRole("link", { name: "Next page" }).click();
    await page.waitForURL(/page=2/, { timeout: NAVIGATION_TIMEOUT });
    // The first tab is the one that opens when the address names none.
    expect(new URL(page.url()).searchParams.get("tab") ?? "requests").toBe("requests");
    await expect(page.getByText(/Showing 11–13 of 13 requests/)).toBeVisible();
    await expect(page.getByRole("table", { name: "Requests" }).getByRole("row")).toHaveCount(4);

    await openTab(page, "jobs");
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await expect(page.getByRole("table", { name: "Jobs" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    // The page a link was shared with still opens the right tab.
    await page.goto(`${new URL(page.url()).pathname}?tab=requests&page=2`);
    await expect(page.getByText(/Showing 11–13 of 13 requests/)).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("shows only that customer's records, never another's", async ({ page }) => {
    const first = await customerWithName("Kara Fixture");
    const second = await customerWithName("Lena Fixture");
    const [firstRequest] = await createRequestsFor(first.id, 1);
    const firstJob = await createJobFor(first.id, { status: "SCHEDULED" });
    const firstInvoice = await createInvoiceFor(first.id, { status: "ISSUED", total: "111.00" });
    const [secondRequest] = await createRequestsFor(second.id, 1);
    const secondJob = await createJobFor(second.id, { status: "IN_PROGRESS" });
    const secondInvoice = await createInvoiceFor(second.id, { status: "ISSUED", total: "222.00" });
    await createAddressesFor(second.id, [{ label: "Lena's flat", line1: "77 Elsewhere Road" }]);

    await loginAs(page, "admin");
    await openCustomer(page, first.id);

    const others = [
      second.name,
      second.email,
      secondRequest?.reference,
      secondJob.requestReference,
      secondJob.quotationReference,
      secondJob.jobReference,
      secondInvoice.invoiceNumber,
      "77 Elsewhere Road",
      "$222.00",
    ];

    for (const tab of ["requests", "quotations", "jobs", "invoices"] as const) {
      await openTab(page, tab);
      await expect(page.getByRole("table")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      const text = (await page.getByRole("main").textContent()) ?? "";
      for (const reference of others) {
        expect(text, `${reference} on the ${tab} tab`).not.toContain(reference ?? "");
      }
    }
    // The records that are theirs are all there.
    await openTab(page, "invoices");
    await expect(page.getByRole("table", { name: "Invoices" })).toContainText(
      firstInvoice.invoiceNumber ?? "",
    );
    await openTab(page, "jobs");
    await expect(page.getByRole("table", { name: "Jobs" })).toContainText(firstJob.jobReference);
    await openTab(page, "quotations");
    await expect(page.getByRole("table", { name: "Quotations" })).toContainText(
      firstJob.quotationReference,
    );
    await openTab(page, "requests");
    await expect(page.getByRole("table", { name: "Requests" })).toContainText(
      firstRequest?.reference ?? "",
    );
  });

  test("answers a customer that does not exist, or an address that is not an id, with a way back", async ({
    page,
  }) => {
    await loginAs(page, "admin");

    for (const id of [UNKNOWN_ID, "not-an-id"]) {
      await page.goto(`/app/customers/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that customer" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await page.getByRole("link", { name: "Back to the customers" }).click();
      await page.waitForURL(/\/app\/customers$/, { timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    }
  });
});

test.describe("internal notes about a customer (FR-033, SEC-DATA-03)", () => {
  test("lists notes newest first with who wrote them, keeps them after a reload and keeps their line breaks", async ({
    page,
  }) => {
    const account = await customerWithName("Mara Fixture");

    await loginAs(page, "admin");
    await openCustomer(page, account.id);
    await expect(page.getByText("No internal notes yet")).toBeVisible();

    await addNote(page, "First: asked for a morning slot.");
    await addNote(page, "Second line one.\nSecond line two.");
    const items = noteList(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Second line one.");
    await expect(items.nth(0)).toContainText("Morgan Reyes");
    await expect(items.nth(1)).toContainText("First: asked for a morning slot.");
    // A note opens with the form emptied for the next one.
    await expect(noteBox(page)).toHaveValue("");

    await page.reload();
    await expect(noteList(page).getByRole("listitem")).toHaveCount(2, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(noteList(page).getByRole("listitem").first()).toContainText("Second line one.");
    // The line break is kept.
    const lines = await noteList(page)
      .getByRole("listitem")
      .first()
      .locator("p")
      .evaluate((element) => getComputedStyle(element).whiteSpace);
    expect(lines).toBe("pre-line");

    expect((await customerNotesOf(account.id)).map((note) => note.body)).toEqual([
      "First: asked for a morning slot.",
      "Second line one.\nSecond line two.",
    ]);
  });

  test("will not send an empty note, says so beside the field, and saves nothing", async ({
    page,
  }) => {
    const account = await customerWithName("Nell Fixture");

    await loginAs(page, "admin");
    await openCustomer(page, account.id);

    await noteBox(page).fill("   ");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Write the note before adding it.")).toBeVisible();
    await expect(noteBox(page)).toHaveAttribute("aria-invalid", "true");
    expect(await customerNotesOf(account.id)).toEqual([]);
    await expectAccessible(page);
  });

  test("keeps what was typed when saving fails, says why, and works when tried again", async ({
    page,
  }) => {
    const account = await customerWithName("Opal Fixture");
    const text = "Do not leave the dog out.";

    await loginAs(page, "admin");
    await openCustomer(page, account.id);

    await page.route("**/api/v1/admin/customers/*/notes", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId: "req-1" },
        }),
      }),
    );
    await noteBox(page).fill(text);
    await page.getByRole("button", { name: "Add note" }).click();
    // (Next.js keeps a route announcer with the same role on every page, so look inside the form.)
    await expect(
      page.getByRole("form", { name: "Add an internal note" }).getByRole("alert"),
    ).toContainText("Something went wrong.");
    await expect(noteBox(page)).toHaveValue(text);
    await expect(page.getByText("No internal notes yet")).toBeVisible();
    expect(await customerNotesOf(account.id)).toEqual([]);

    await page.unroute("**/api/v1/admin/customers/*/notes");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(noteList(page).getByText(text)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    expect((await customerNotesOf(account.id)).map((note) => note.body)).toEqual([text]);
  });

  test("adds a note with the keyboard alone", async ({ page }) => {
    const account = await customerWithName("Piper Fixture");

    await loginAs(page, "admin");
    await openCustomer(page, account.id);

    await noteBox(page).focus();
    await page.keyboard.type("Keyboard note: prefers email.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Add note" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(noteList(page).getByText("Keyboard note: prefers email.")).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("never reaches the customer: not their pages, not their API answers, not their notifications", async ({
    page,
  }) => {
    const account = await customerWithName("Quinn Fixture");
    const [request] = await createRequestsFor(account.id, 1);
    const secret = `Private-${newTag()}: do not serve after the March dispute.`;

    await loginAs(page, "admin");
    await openCustomer(page, account.id);
    await addNote(page, secret);
    expect((await customerNotesOf(account.id)).map((note) => note.body)).toEqual([secret]);

    // The customer, signed in, looks everywhere they can.
    await signOut(page);
    await loginAs(page, account);
    for (const path of [
      "/portal",
      "/portal/profile",
      "/portal/requests",
      `/portal/requests/${request?.id ?? ""}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      expect(await page.content(), `the page ${path}`).not.toContain("Private-");
      expect(await page.content(), `the page ${path}`).not.toContain("March dispute");
    }
    for (const path of [
      "/api/v1/auth/me",
      "/api/v1/customers/me",
      "/api/v1/customers/me/addresses",
      "/api/v1/requests/me",
      `/api/v1/requests/${request?.id ?? ""}`,
      "/api/v1/notifications/me",
    ]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).not.toContain("March dispute");
    }
    // And the admin endpoints are closed to them.
    const profileId = await profileIdOf(account.id);
    for (const path of ["/api/v1/admin/customers", `/api/v1/admin/customers/${profileId}`]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  });
});

test.describe("who may open the customer pages", () => {
  test("sends a visitor to sign in and back, and turns a customer away without showing any customer", async ({
    page,
  }) => {
    const account = await customerWithName("Reese Fixture");

    await page.goto("/app/customers");
    await page.waitForURL(/\/login\?returnTo=%2Fapp%2Fcustomers/, { timeout: NAVIGATION_TIMEOUT });

    await loginAs(page, account);
    for (const path of ["/app/customers", `/app/customers/${await profileIdOf(account.id)}`]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("table", { name: "Customers" })).toHaveCount(0);
      expect(await page.content()).not.toContain("Alex Morgan");
    }
  });

  test("has a Customers entry in the business navigation, and none in the customer's", async ({
    page,
  }) => {
    const account = await customerWithName("Sasha Fixture");

    await loginAs(page, "admin");
    const businessNav = page.getByRole("navigation", { name: "Main" });
    await expect(businessNav.getByRole("link", { name: "Customers" })).toHaveAttribute(
      "href",
      "/app/customers",
    );
    await businessNav.getByRole("link", { name: "Customers" }).click();
    await page.waitForURL(/\/app\/customers$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(businessNav.getByRole("link", { name: "Customers" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await signOut(page);
    await loginAs(page, account);
    await expect(page.getByRole("link", { name: "Customers" })).toHaveCount(0);
  });
});

test.describe("layout and accessibility", () => {
  async function longCustomer(): Promise<FixtureAccount> {
    const account = await customerWithName("Wolfeschlegelsteinhausenbergerdorff-Fixture Longname");
    await createAddressesFor(account.id, [
      {
        label: "Holiday cottage by the lake",
        line1: "12345 Extraordinarily-Long-Street-Name-That-Keeps-Going Boulevard",
        city: "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch",
        accessNotes: `Gate code ${"9".repeat(60)} and then ${"unbreakable".repeat(8)}`,
      },
    ]);
    await createJobFor(account.id);
    await createInvoiceFor(account.id, { status: "ISSUED", total: "1234567.89" });
    return account;
  }

  for (const width of WIDTHS) {
    test(`does not scroll sideways at ${width} px: directory, customer page, every tab and the notes`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const account = await longCustomer();

      await loginAs(page, "admin");
      await openDirectory(page, `?q=${encodeURIComponent(account.email)}`);
      await expect(page.getByRole("link", { name: account.name }).first()).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);

      await openCustomer(page, account.id);
      await expectNoHorizontalOverflow(page);
      await addNote(page, `A long note ${"unbreakableword".repeat(12)} and a short ending.`);
      await expectNoHorizontalOverflow(page);
      for (const tab of ["quotations", "jobs", "invoices", "requests"] as const) {
        await openTab(page, tab);
        await expect(page.getByRole("heading", { level: 2, name: "History" })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  }

  for (const width of [360, 1440]) {
    test(`has no serious accessibility violations at ${width} px`, async ({ page }) => {
      await useViewport(page, width);
      const account = await longCustomer();
      await createRequestsFor(account.id, 2);

      await loginAs(page, "admin");
      await openDirectory(page, `?q=${encodeURIComponent(account.email)}`);
      await expect(page.getByRole("link", { name: account.name }).first()).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await searchFor(page, `nobody-${newTag()}`);
      await expect(page.getByRole("heading", { name: "No customers match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await openCustomer(page, account.id);
      await addNote(page, "An accessible note.");
      await expectAccessible(page);
      for (const tab of ["quotations", "jobs", "invoices"] as const) {
        await openTab(page, tab);
        // The records are a table from 1024 px and cards below it.
        await expect(
          page.getByRole(width >= 1024 ? "table" : "list", { name: TAB_LABELS[tab] }),
        ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
        await expectAccessible(page);
      }

      const empty = await customerWithName("Tamsin Fixture");
      await openCustomer(page, empty.id);
      await openTab(page, "jobs");
      await expect(page.getByRole("heading", { level: 3, name: "No jobs yet" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);
    });
  }
});
