import { addDaysToDateOnly, preferredDateRange, type ServiceRequestStatus } from "@fixflow/shared";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import {
  activityOf,
  createRequestsFor,
  type InsertedRequest,
  notesOf,
  readRequestState,
  setRequestStatus,
} from "../fixtures/requests.js";
import { loginAs, signOut } from "../support/auth.js";
import { waitForEmailTo } from "../support/outbox.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The admin request queue and review (T12, workflow 7.2, FR-023 to FR-026). Every flow runs on
 * customers made for that test and finds them again by their unique email address in the search box,
 * because the specs run in parallel on one shared demo admin and one database: nothing here
 * asserts a count of everything. Rows are read back straight from the E2E database.
 */

test.describe.configure({ timeout: 120_000 });

const BUSINESS_TIME_ZONE = "America/New_York";
const REQUEST_PATH = /\/app\/requests\/[0-9a-f-]{36}$/;
const UNKNOWN_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const INTERNAL_REASON = "Outside our service area; address checked on the map.";
const CUSTOMER_MESSAGE = "Sorry, we can't reach your street this month.";

const queueTable = (page: Page): Locator => page.getByRole("table", { name: "Service requests" });
const rowFor = (page: Page, reference: string): Locator =>
  queueTable(page).getByRole("row").filter({ hasText: reference });
const statusChips = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Filter requests by status" });
const searchBox = (page: Page): Locator => page.getByRole("searchbox", { name: "Search" });
/** The status badge in a request's header. */
const headerBadge = (page: Page): Locator => page.getByRole("main").locator("header [data-status]");

async function openQueue(page: Page, query = ""): Promise<void> {
  await page.goto(`/app/requests${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("search", { name: "Search and filter requests" }));
}

async function openRequest(page: Page, request: InsertedRequest): Promise<void> {
  await page.goto(`/app/requests/${request.id}`);
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("form", { name: "Add a note" }));
}

/** Narrows the queue to one customer's requests through the search box, like a person would. */
async function searchFor(page: Page, text: string): Promise<void> {
  await searchBox(page).fill(text);
  await page.waitForURL(/[?&]q=/, { timeout: NAVIGATION_TIMEOUT });
}

async function customerWith(
  count: number,
  options: { name?: string; status?: ServiceRequestStatus } = {},
): Promise<{ account: FixtureAccount; requests: InsertedRequest[] }> {
  const account = await createCustomerAccount({ name: options.name ?? "Taylor Fixture" });
  const requests = await createRequestsFor(account.id, count, {
    ...(options.status !== undefined && { status: options.status }),
  });
  return { account, requests };
}

async function cancelThroughDialog(
  page: Page,
  { reason, message }: { reason: string; message?: string },
): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Cancel request" }).click();
  const dialog = page.getByRole("alertdialog", { name: /^Cancel FF-/ });
  await dialog.getByLabel(/Reason \(internal\)/).fill(reason);
  if (message !== undefined) {
    await dialog.getByLabel("Message to the customer").fill(message);
  }
  await dialog.getByRole("button", { name: "Cancel request" }).click();
  await expect(dialog).toBeHidden({ timeout: NAVIGATION_TIMEOUT });
}

async function addNote(
  page: Page,
  text: string,
  visibility: "internal" | "shared" = "internal",
): Promise<void> {
  await page.getByRole("textbox", { name: /^Note/ }).fill(text);
  if (visibility === "shared") {
    await page.getByRole("radio", { name: /^Shared with the customer/ }).click();
  }
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(
    page.getByRole("list", { name: "Notes on this request" }).getByText(text),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
}

/**
 * Scans the page for serious accessibility problems. A toast that is still sliding in is measured
 * mid-animation (a smaller target than it will be), so it waits for the toasts to go first. `scope` limits the
 * scan to an open menu or dialog (see `seriousViolations`).
 */
async function expectAccessible(page: Page, scope?: string): Promise<void> {
  // A toast under the pointer stays until the pointer leaves it.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  expect(await seriousViolations(page, scope), "serious axe violations").toBe("");
}

/** The portal page of a request, as its customer sees it (signs the admin out first). */
async function openAsCustomer(
  page: Page,
  account: FixtureAccount,
  request: InsertedRequest,
): Promise<void> {
  await signOut(page);
  await loginAs(page, account);
  await page.goto(`/portal/requests/${request.id}`);
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

test.describe("finding a request and reviewing it (workflow 7.2)", () => {
  test("finds the new request by search, starts the review and adds both kinds of note; the customer sees the shared note and 'Under review', never the internal one", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    const internalNote = "Shared meter with the neighbour; confirm before quoting.";
    const sharedNote = "We will bring a replacement capacitor with us.";

    await loginAs(page, "admin");
    await openQueue(page);
    await searchFor(page, account.email);

    // The new request is in the queue, marked New, with the customer and the status.
    const row = rowFor(page, request.reference);
    await expect(row).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(row).toContainText("New");
    await expect(row).toContainText("Taylor Fixture");
    await expect(row).toContainText("Submitted");
    await row.getByRole("link", { name: request.reference }).click();
    await page.waitForURL(REQUEST_PATH, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible();
    await expect(headerBadge(page)).toHaveAttribute("data-status", "SUBMITTED");
    await expectHydrated(page.getByRole("form", { name: "Add a note" }));

    // Start the review: the status changes, and the button that did it is gone.
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(headerBadge(page)).toHaveAttribute("data-status", "UNDER_REVIEW", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");

    // Both kinds of note, each marked in words for the team.
    await addNote(page, internalNote, "internal");
    await addNote(page, sharedNote, "shared");
    const notes = page.getByRole("list", { name: "Notes on this request" }).getByRole("listitem");
    await expect(notes).toHaveCount(2);
    await expect(notes.filter({ hasText: internalNote })).toContainText("Internal");
    await expect(notes.filter({ hasText: sharedNote })).toContainText("Shared with the customer");
    expect((await notesOf(request.id)).map((note) => [note.body, note.visibility])).toEqual([
      [internalNote, "INTERNAL"],
      [sharedNote, "CUSTOMER_VISIBLE"],
    ]);

    // Every change is in the activity: the staff history says who did it, and the internal note
    // leaves nothing for the customer.
    const events = await activityOf(request.id);
    expect(events.map((event) => event.action).sort()).toEqual([
      "request.note_added",
      "request.note_added",
      "request.review_started",
    ]);
    const internalEvent = events.find((event) => event.summary.includes("internal note"));
    const sharedEvent = events.find((event) => event.summary.includes("customer can see"));
    expect(internalEvent?.publicSummary).toBeNull();
    expect(sharedEvent?.publicSummary).not.toBeNull();
    const history = page.getByRole("list", { name: "Request history" });
    await expect(history).toContainText("Morgan Reyes");

    // The customer's side of the same request.
    await openAsCustomer(page, account, request);
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveAttribute(
      "data-status",
      "UNDER_REVIEW",
    );
    await expect(page.getByRole("main").locator("header")).toContainText("Under review");
    const messages = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: "Messages from us" }) });
    await expect(messages).toContainText(sharedNote);
    const customerHistory = page.getByRole("list", { name: "Request history" });
    await expect(customerHistory).toContainText("started reviewing your request");
    await expect(customerHistory).toContainText("added a note to your request");
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).not.toContain(internalNote);
    expect(text).not.toContain("Morgan Reyes");
    expect(text).not.toContain("internal note");
  });

  test("the sidebar has Requests, current on the queue and on a request, and the dashboard leads there", async ({
    page,
  }) => {
    const { requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");

    await page.goto("/app/dashboard");
    await page.getByRole("link", { name: "Requests needing action", exact: true }).click();
    await page.waitForURL(/\/app\/requests\?status=/, { timeout: NAVIGATION_TIMEOUT });
    const sidebarLink = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Requests" });
    await expect(sidebarLink).toHaveAttribute("aria-current", "page");

    await openRequest(page, request);
    await expect(sidebarLink).toHaveAttribute("aria-current", "page");
  });

  test("a request's page gives the team what it needs: the customer, their other requests, the address and the history", async ({
    page,
  }) => {
    const account = await createCustomerAccount({ name: "Taylor Fixture" });
    const [first, second, third] = await createRequestsFor(account.id, 3, {
      status: "UNDER_REVIEW",
    });
    await loginAs(page, "admin");

    await openRequest(page, third as InsertedRequest);

    const customer = page.locator("div.rounded-xl").filter({
      has: page.getByRole("heading", { level: 2, name: "Customer" }),
    });
    await expect(customer).toContainText("Taylor Fixture");
    await expect(customer.getByRole("link", { name: account.email })).toHaveAttribute(
      "href",
      `mailto:${account.email}`,
    );
    await expect(customer.locator('a[href^="tel:"]')).toHaveCount(1);
    await expect(customer).toContainText("2 other requests from this customer.");
    const earlier = customer.getByRole("list").getByRole("link");
    await expect(earlier).toHaveCount(2);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 2, name: "Request details" }),
    ).toBeVisible();
    await expect(page.getByRole("main").locator("address")).toContainText("Larkspur");
    await expect(page.getByRole("list", { name: "Request history" })).toHaveCount(0);
    await expect(page.getByText("Nothing has happened yet.")).toBeVisible();

    // An earlier request opens in the same view.
    await customer
      .getByRole("link", { name: new RegExp((first as InsertedRequest).reference) })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: (first as InsertedRequest).reference }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    expect((second as InsertedRequest).reference).not.toBe((first as InsertedRequest).reference);
  });
});

test.describe("the queue", () => {
  test("shows how many requests each status holds, and filters by one or several statuses at once", async ({
    page,
  }) => {
    const account = await createCustomerAccount({ name: "Taylor Fixture" });
    await createRequestsFor(account.id, 2, { status: "SUBMITTED" });
    await createRequestsFor(account.id, 1, { status: "UNDER_REVIEW" });
    await createRequestsFor(account.id, 1, { status: "CANCELLED" });
    await loginAs(page, "admin");
    await openQueue(page);
    await searchFor(page, account.email);

    const chip = (name: string) => statusChips(page).getByRole("link", { name });
    await expect(chip("All 4")).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(chip("Submitted 2")).toBeVisible();
    await expect(chip("Under review 1")).toBeVisible();
    await expect(chip("Quoted 0")).toBeVisible();
    await expect(chip("Cancelled 1")).toBeVisible();
    await expect(chip("All 4")).toHaveAttribute("aria-current", "true");
    await expect(queueTable(page).getByRole("row")).toHaveCount(5);

    // One status.
    await chip("Submitted 2").click();
    await page.waitForURL(/status=SUBMITTED/, { timeout: NAVIGATION_TIMEOUT });
    await expect(queueTable(page).getByRole("row")).toHaveCount(3);
    await expect(chip("Submitted 2")).toHaveAttribute("aria-current", "true");
    await expect(chip("All 4")).not.toHaveAttribute("aria-current", "true");
    // The counts still show what the other statuses would give, for the same search.
    await expect(chip("Cancelled 1")).toBeVisible();

    // Two statuses together, kept in the address, with the search still there.
    await chip("Under review 1").click();
    await page.waitForURL(/status=SUBMITTED%2CUNDER_REVIEW/, { timeout: NAVIGATION_TIMEOUT });
    await expect(queueTable(page).getByRole("row")).toHaveCount(4);
    expect(new URL(page.url()).searchParams.get("q")).toBe(account.email);

    // Taking one out, then All.
    await chip("Submitted 2").click();
    await page.waitForURL((url) => url.searchParams.get("status") === "UNDER_REVIEW", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(queueTable(page).getByRole("row")).toHaveCount(2);
    await chip("All 4").click();
    await page.waitForURL((url) => !url.searchParams.has("status"), {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(queueTable(page).getByRole("row")).toHaveCount(5);
  });

  test("search follows typing after a pause, lives in the address, survives a reload and is cleared with Clear filters", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(2);
    await loginAs(page, "admin");
    await openQueue(page);

    await searchBox(page).pressSequentially(account.email, { delay: 20 });
    await page.waitForURL((url) => url.searchParams.get("q") === account.email, {
      timeout: NAVIGATION_TIMEOUT,
    });
    for (const request of requests) {
      await expect(rowFor(page, request.reference)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    }

    // A reload shows the same search and the same result.
    await page.reload();
    await expect(searchBox(page)).toHaveValue(account.email);
    await expect(queueTable(page).getByRole("row")).toHaveCount(3);

    // A search that finds nothing says so and offers the way back.
    await searchBox(page).fill("nobody-has-this-name");
    await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL((url) => !url.searchParams.has("q"), { timeout: NAVIGATION_TIMEOUT });
    await expect(searchBox(page)).toHaveValue("");
    await expect(page.getByRole("heading", { name: "No requests match" })).toHaveCount(0);
  });

  test("finds a request by its reference, and by the customer's name", async ({ page }) => {
    const { account, requests } = await customerWith(1, { name: "Zephyrine Quillfeather" });
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openQueue(page);

    await searchFor(page, request.reference);
    await expect(rowFor(page, request.reference)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(queueTable(page).getByRole("row")).toHaveCount(2);

    await searchBox(page).fill("zephyrine quill");
    await page.waitForURL((url) => url.searchParams.get("q") === "zephyrine quill", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(rowFor(page, request.reference)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    expect(account.name).toBe("Zephyrine Quillfeather");
  });

  test("narrows by service and by the day the request was sent, and says when a range is the wrong way round", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(2);
    const { min: tomorrow } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
    const today = addDaysToDateOnly(tomorrow, -1);
    const yesterday = addDaysToDateOnly(tomorrow, -2);
    await loginAs(page, "admin");
    await openQueue(page);
    await searchFor(page, account.email);
    await expect(queueTable(page).getByRole("row")).toHaveCount(3, { timeout: NAVIGATION_TIMEOUT });

    // Another service: nothing.
    await page
      .getByLabel("Service", { exact: true })
      .selectOption({ label: "Washing Machine Repair" });
    await page.waitForURL(/serviceId=/, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await page
      .getByLabel("Service", { exact: true })
      .selectOption({ label: "AC Routine Maintenance" });
    await expect(queueTable(page).getByRole("row")).toHaveCount(3, { timeout: NAVIGATION_TIMEOUT });
    await page.getByLabel("Service", { exact: true }).selectOption({ label: "All services" });
    await page.waitForURL((url) => !url.searchParams.has("serviceId"), {
      timeout: NAVIGATION_TIMEOUT,
    });

    // Sent from tomorrow on: nothing yet.
    await page.getByLabel("Submitted from").fill(tomorrow);
    await page.waitForURL((url) => url.searchParams.get("submittedFrom") === tomorrow, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    // Yesterday to today: both, because the last day counts in full.
    await page.getByLabel("Submitted from").fill(yesterday);
    await page.getByLabel("Submitted to").fill(today);
    await page.waitForURL(
      (url) =>
        url.searchParams.get("submittedFrom") === yesterday &&
        url.searchParams.get("submittedTo") === today,
      { timeout: NAVIGATION_TIMEOUT },
    );
    for (const request of requests) {
      await expect(rowFor(page, request.reference)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    }

    // The wrong way round is explained beside the field, and the list is left alone.
    const urlBefore = page.url();
    await page.getByLabel("Submitted from").fill(addDaysToDateOnly(today, 3));
    await expect(page.getByText("Choose a date on or after the start date.")).toBeVisible();
    await expect(page.getByLabel("Submitted to")).toHaveAttribute("aria-invalid", "true");
    // The start date alone is a valid filter; only the pair is refused, so the address changed
    // only if the range was valid. It was not, so it did not.
    expect(page.url()).toBe(urlBefore);
  });

  test("sorts by a column, pages in twenties and keeps the sort across pages", async ({ page }) => {
    const { account, requests } = await customerWith(25);
    const oldest = requests[0] as InsertedRequest;
    const newest = requests.at(-1) as InsertedRequest;
    await loginAs(page, "admin");
    await openQueue(page);
    await searchFor(page, account.email);

    // Newest first by default, twenty to a page, with the count.
    await expect(queueTable(page).getByRole("row")).toHaveCount(21, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(queueTable(page).getByRole("row").nth(1)).toContainText(newest.reference);
    await expect(page.getByText(/Showing 1–20 of 25 requests/)).toBeVisible();
    await expect(rowFor(page, oldest.reference)).toHaveCount(0);

    // By reference, ascending: the oldest first.
    await queueTable(page).getByRole("link", { name: "Reference" }).click();
    await page.waitForURL(/sort=reference&order=asc/, { timeout: NAVIGATION_TIMEOUT });
    await expect(queueTable(page).getByRole("columnheader", { name: "Reference" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(queueTable(page).getByRole("row").nth(1)).toContainText(oldest.reference);

    // And the other way.
    await queueTable(page).getByRole("link", { name: "Reference" }).click();
    await page.waitForURL(/order=desc/, { timeout: NAVIGATION_TIMEOUT });
    await expect(queueTable(page).getByRole("row").nth(1)).toContainText(newest.reference);

    // The second page keeps the sort and the search.
    await page.getByRole("link", { name: "Next page" }).click();
    await page.waitForURL(/page=2/, { timeout: NAVIGATION_TIMEOUT });
    const params = new URL(page.url()).searchParams;
    expect(params.get("sort")).toBe("reference");
    expect(params.get("order")).toBe("desc");
    expect(params.get("q")).toBe(account.email);
    await expect(queueTable(page).getByRole("row")).toHaveCount(6);
    await expect(rowFor(page, oldest.reference)).toBeVisible();
  });

  test("marks only a request nobody has looked at yet as New", async ({ page }) => {
    const account = await createCustomerAccount();
    const [fresh] = await createRequestsFor(account.id, 1, { status: "SUBMITTED" });
    const [reviewed] = await createRequestsFor(account.id, 1, { status: "UNDER_REVIEW" });
    await loginAs(page, "admin");
    await openQueue(page);
    await searchFor(page, account.email);

    await expect(rowFor(page, (fresh as InsertedRequest).reference)).toContainText("New", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(rowFor(page, (reviewed as InsertedRequest).reference)).not.toContainText("New");
  });

  test("copes with an address that was edited by hand", async ({ page }) => {
    await loginAs(page, "admin");

    await openQueue(
      page,
      "?status=NOPE&sort=customerName&order=sideways&page=-4&serviceId=zzz&submittedFrom=2026-04-10&submittedTo=2026-04-01&q=",
    );

    await expect(page.getByRole("heading", { name: "We couldn't load the requests" })).toHaveCount(
      0,
    );
    await expect(statusChips(page)).toBeVisible();
    // A range given backwards is put the right way round rather than refused.
    await expect(page.getByLabel("Submitted from")).toHaveValue("2026-04-01");
    await expect(page.getByLabel("Submitted to")).toHaveValue("2026-04-10");
  });
});

test.describe("moving a request on (FR-025, FR-026, D-21)", () => {
  test("offers exactly the actions the server allows for each status", async ({ page }) => {
    const account = await createCustomerAccount();
    const cases: Array<{
      status: ServiceRequestStatus;
      main: string | null;
      menu: boolean;
    }> = [
      { status: "SUBMITTED", main: "Start review", menu: true },
      { status: "UNDER_REVIEW", main: null, menu: true },
      { status: "QUOTED", main: null, menu: true },
      { status: "ACCEPTED", main: null, menu: true },
      { status: "DECLINED", main: "Reopen request", menu: true },
      { status: "CONVERTED_TO_JOB", main: null, menu: false },
      { status: "CANCELLED", main: null, menu: false },
    ];
    const requests = new Map<ServiceRequestStatus, InsertedRequest>();
    for (const { status } of cases) {
      const [request] = await createRequestsFor(account.id, 1, { status });
      requests.set(status, request as InsertedRequest);
    }
    await loginAs(page, "admin");

    for (const { status, main, menu } of cases) {
      await openRequest(page, requests.get(status) as InsertedRequest);
      await expect(headerBadge(page)).toHaveAttribute("data-status", status);
      for (const name of ["Start review", "Reopen request"]) {
        await expect(page.getByRole("button", { name }), `${status}: ${name}`).toHaveCount(
          name === main ? 1 : 0,
        );
      }
      await expect(page.getByRole("button", { name: "More actions" }), status).toHaveCount(
        menu ? 1 : 0,
      );
    }
  });

  test("cancels with a reason and a message: the customer is told the message and never the reason", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(1, { status: "UNDER_REVIEW" });
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    // The dialog says what will happen, and the button cannot be used without a reason.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Cancel request" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Cancel ${request.reference}?` });
    await expect(dialog).toContainText("cannot be reopened");
    await expect(dialog).toContainText("Your reason stays inside the business");
    await expect(dialog.getByLabel(/Reason \(internal\)/)).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Cancel request" })).toBeDisabled();
    await dialog.getByLabel(/Reason \(internal\)/).fill(INTERNAL_REASON);
    await dialog.getByLabel("Message to the customer").fill(CUSTOMER_MESSAGE);
    await dialog.getByRole("button", { name: "Cancel request" }).click();

    // The page shows the cancellation, with the reason marked internal and no way forward.
    await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
      timeout: NAVIGATION_TIMEOUT,
    });
    const cancellation = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { level: 2, name: "Cancellation" }) });
    await expect(cancellation).toContainText(INTERNAL_REASON);
    await expect(cancellation).toContainText("Reason (internal)");
    await expect(cancellation).toContainText(CUSTOMER_MESSAGE);
    await expect(cancellation).toContainText("Morgan Reyes");
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    // Focus was not lost when the control that had it went away.
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(false);

    const stored = await readRequestState(request.id);
    expect(stored).toMatchObject({
      status: "CANCELLED",
      cancelReason: INTERNAL_REASON,
      cancelCustomerMessage: CUSTOMER_MESSAGE,
    });
    expect(stored.cancelledAt).not.toBeNull();
    expect(stored.cancelledByUserId).not.toBeNull();
    const events = await activityOf(request.id);
    const cancelled = events.find((event) => event.action === "request.cancelled");
    expect(cancelled).toMatchObject({ toStatus: "CANCELLED" });
    expect(`${cancelled?.publicSummary}`).not.toContain(INTERNAL_REASON);

    // The email carries the message and not the reason.
    const email = await waitForEmailTo(account.email);
    expect(email.subject).toBe(`Request ${request.reference} was cancelled`);
    expect(email.text).toContain(CUSTOMER_MESSAGE);
    expect(email.text).not.toContain(INTERNAL_REASON);

    // The customer's own page: cancelled, the message, and nothing internal anywhere.
    await openAsCustomer(page, account, request);
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveAttribute(
      "data-status",
      "CANCELLED",
    );
    await expect(page.getByText("Message from us")).toBeVisible();
    await expect(page.getByRole("main")).toContainText(CUSTOMER_MESSAGE);
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).not.toContain(INTERNAL_REASON);
    expect(text).not.toContain("Morgan Reyes");
    expect(text).not.toContain("Reason (internal)");
  });

  test("cancels without a message: the customer gets the standard wording only", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    await cancelThroughDialog(page, { reason: INTERNAL_REASON });

    await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(
      page.getByText(/None written\. The customer saw the standard wording\./),
    ).toBeVisible();
    expect((await readRequestState(request.id)).cancelCustomerMessage).toBeNull();
    const email = await waitForEmailTo(account.email);
    expect(email.text).toContain("has been cancelled");
    expect(email.text).not.toContain("A message from");
    expect(email.text).not.toContain(INTERNAL_REASON);

    await openAsCustomer(page, account, request);
    await expect(page.getByText("Message from us")).toHaveCount(0);
    expect((await page.locator("body").textContent()) ?? "").not.toContain(INTERNAL_REASON);
  });

  test("reopens a declined request with a reason that stays internal", async ({ page }) => {
    const { account, requests } = await customerWith(1, { status: "DECLINED" });
    const [request] = requests as [InsertedRequest];
    const reason = "Customer called to say the price was fine after all.";
    await loginAs(page, "admin");
    await openRequest(page, request);

    await page.getByRole("button", { name: "Reopen request" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Reopen ${request.reference}?` });
    await expect(dialog.getByLabel("Message to the customer")).toHaveCount(0);
    await dialog.getByLabel(/Reason \(internal\)/).fill(reason);
    await dialog.getByRole("button", { name: "Reopen request" }).click();

    await expect(headerBadge(page)).toHaveAttribute("data-status", "UNDER_REVIEW", {
      timeout: NAVIGATION_TIMEOUT,
    });
    // The reason is kept as an internal note.
    const notes = page.getByRole("list", { name: "Notes on this request" }).getByRole("listitem");
    await expect(notes.filter({ hasText: reason })).toContainText("Internal");
    expect((await notesOf(request.id)).map((note) => note.visibility)).toEqual(["INTERNAL"]);

    await openAsCustomer(page, account, request);
    await expect(page.getByRole("main").locator("header")).toContainText("Under review");
    expect((await page.locator("body").textContent()) ?? "").not.toContain(reason);
  });

  test("a request changed by someone else meanwhile is refused, the page catches up and nothing is written", async ({
    page,
  }) => {
    const { requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();

    // Another admin cancels it while this page is open.
    await setRequestStatus(request.id, "CANCELLED");
    await page.getByRole("button", { name: "Start review" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Someone else changed this request" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
    expect((await readRequestState(request.id)).status).toBe("CANCELLED");
    expect(await activityOf(request.id)).toEqual([]);
  });

  test("a double click on Start review changes the request once", async ({ page }) => {
    const { requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    await page.getByRole("button", { name: "Start review" }).dblclick();

    await expect(headerBadge(page)).toHaveAttribute("data-status", "UNDER_REVIEW", {
      timeout: NAVIGATION_TIMEOUT,
    });
    expect(await activityOf(request.id)).toHaveLength(1);
  });

  test("the whole cancellation can be done with the keyboard, and focus comes back to where it started", async ({
    page,
  }) => {
    const { requests } = await customerWith(1, { status: "UNDER_REVIEW" });
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    const more = page.getByRole("button", { name: "More actions" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Cancel request" })).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: `Cancel ${request.reference}?` });
    await expect(dialog.getByLabel(/Reason \(internal\)/)).toBeFocused();
    await page.keyboard.type(INTERNAL_REASON);
    await page.keyboard.press("Tab"); // the message to the customer
    await expect(dialog.getByLabel("Message to the customer")).toBeFocused();

    // Escape keeps the request and gives focus back to the menu button.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");

    // Again, and this time to the end: Tab to the confirm button and press Enter.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel(/Reason \(internal\)/)).toBeFocused();
    await expect(dialog.getByLabel(/Reason \(internal\)/)).toHaveValue("");
    await page.keyboard.type(INTERNAL_REASON);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Keep request" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel request" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
      timeout: NAVIGATION_TIMEOUT,
    });
  });
});

test.describe("notes", () => {
  test("a note cannot be empty, is not lost when saving fails, and tells the team who sees it", async ({
    page,
  }) => {
    const { requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    // Internal is chosen until the team chooses otherwise.
    await expect(page.getByRole("radio", { name: /^Internal/ })).toBeChecked();
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Write the note before adding it.")).toBeVisible();
    expect(await notesOf(request.id)).toEqual([]);

    // A failure keeps what was typed and says so; nothing is announced as saved.
    const text = "Customer prefers a call after 5pm.";
    await page.route("**/api/v1/admin/requests/*/notes", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        json: {
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong on our side.",
            requestId: "e2e",
          },
        },
      }),
    );
    await page.getByRole("textbox", { name: /^Note/ }).fill(text);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Something went wrong on our side." }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Note/ })).toHaveValue(text);
    expect(await notesOf(request.id)).toEqual([]);

    // Then it works, and the form is ready for the next note (internal again).
    await page.unroute("**/api/v1/admin/requests/*/notes");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(
      page.getByRole("list", { name: "Notes on this request" }).getByText(text),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("textbox", { name: /^Note/ })).toHaveValue("");
    expect((await notesOf(request.id)).map((note) => note.body)).toEqual([text]);
  });

  test("a note shared with the customer reaches them in the portal; an internal one does not", async ({
    page,
  }) => {
    const { account, requests } = await customerWith(1);
    const [request] = requests as [InsertedRequest];
    await loginAs(page, "admin");
    await openRequest(page, request);

    await addNote(page, "Please keep the gate unlocked.", "shared");
    await addNote(page, "Gate is usually locked; bring bolt cutters.", "internal");

    await openAsCustomer(page, account, request);
    const messages = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: "Messages from us" }) });
    await expect(messages).toContainText("Please keep the gate unlocked.");
    await expect(messages).not.toContainText("bolt cutters");
    expect((await page.locator("body").textContent()) ?? "").not.toContain("bolt cutters");
  });
});

test.describe("who can open it", () => {
  test("a customer is told the area is for the business team, and is shown no request", async ({
    page,
  }) => {
    const other = await createCustomerAccount();
    const [theirs] = await createRequestsFor(other.id, 1);
    const customer = await createCustomerAccount();
    await loginAs(page, customer);

    for (const path of ["/app/requests", `/app/requests/${(theirs as InsertedRequest).id}`]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      expect((await page.locator("body").textContent()) ?? "").not.toContain(
        (theirs as InsertedRequest).reference,
      );
    }

    // And the API refuses the customer too: hiding the page is not the control.
    const list = await page.request.get("/api/v1/admin/requests");
    expect(list.status()).toBe(403);
    const one = await page.request.get(`/api/v1/admin/requests/${(theirs as InsertedRequest).id}`);
    expect(one.status()).toBe(403);
  });

  test("a visitor who is not signed in is sent to sign-in and returned to the queue", async ({
    page,
  }) => {
    await page.goto("/app/requests");

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Frequests$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("an id that does not exist, or is not an id, shows the same 'not found' page", async ({
    page,
  }) => {
    await loginAs(page, "admin");

    for (const id of [UNKNOWN_ID, "not-an-id"]) {
      await page.goto(`/app/requests/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that request" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("link", { name: "Back to the queue" })).toHaveAttribute(
        "href",
        "/app/requests",
      );
    }
  });
});

test.describe("on every screen size", () => {
  for (const width of WIDTHS) {
    test(`the queue and a request fit at ${width} px, including a long name, a long note and the cancel dialog`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const { account, requests } = await customerWith(3, {
        name: "Bartholomew Montgomery-Featherstonehaugh",
      });
      const [request] = requests as [InsertedRequest];
      await loginAs(page, "admin");

      await openQueue(page);
      await expectNoHorizontalOverflow(page);
      await searchFor(page, account.email);
      await expect(page.getByText(/Showing 1–3 of 3 requests/)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);

      await openRequest(page, request);
      await expectNoHorizontalOverflow(page);
      await addNote(page, `See https://example.test/${"a".repeat(120)} for the photos.`, "shared");
      await expectNoHorizontalOverflow(page);

      // The dialog fits inside the screen, and the page behind it does not scroll sideways.
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      const dialog = page.getByRole("alertdialog", { name: `Cancel ${request.reference}?` });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(width);
      await expectNoHorizontalOverflow(page);
      await dialog.getByLabel(/Reason \(internal\)/).fill(`${"b".repeat(100)} ${"c".repeat(100)}`);
      await dialog.getByRole("button", { name: "Cancel request" }).click();
      await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("accessibility (axe)", () => {
  for (const width of [360, 1440]) {
    test(`the queue, its empty result, a request and the dialog are clean at ${width} px`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const { account, requests } = await customerWith(3);
      const [request] = requests as [InsertedRequest];
      await loginAs(page, "admin");

      await openQueue(page);
      await searchFor(page, account.email);
      await expect(page.getByText(/Showing 1–3 of 3 requests/)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await searchBox(page).fill("nobody-has-this-name");
      await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await openRequest(page, request);
      await expectAccessible(page);
      await addNote(page, "Left a voicemail.", "internal");
      await addNote(page, "We will call you tomorrow.", "shared");
      await expectAccessible(page);

      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Cancel request" })).toBeVisible();
      await expectAccessible(page, "[role=menu]");
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await expectAccessible(page, "[role=alertdialog]");
      await page
        .getByRole("alertdialog")
        .getByLabel(/Reason \(internal\)/)
        .fill(INTERNAL_REASON);
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel request" }).click();
      await expect(headerBadge(page)).toHaveAttribute("data-status", "CANCELLED", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await page.goto(`/app/requests/${UNKNOWN_ID}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that request" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectAccessible(page);
    });
  }
});
