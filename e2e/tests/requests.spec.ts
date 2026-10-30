import { addDaysToDateOnly, preferredDateRange } from "@fixflow/shared";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import { userIdFor } from "../fixtures/notifications.js";
import {
  activityOf,
  countRequestsOf,
  createEventOn,
  createInactiveService,
  createNoteOn,
  createRequestsFor,
  readRequestsOf,
  receivedNotificationsFor,
  savedAddressesOf,
} from "../fixtures/requests.js";
import { demoAccount, loginAs, submitLoginForm } from "../support/auth.js";
import { readOutbox, waitForEmailTo } from "../support/outbox.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * Service request submission and tracking (T11, workflow 7.1, FR-020 to FR-022). Every flow that
 * creates data runs on a customer made for that test, never on the shared demo customers, because
 * the specs run in parallel and read the demo accounts' data. The seeded demo customer only signs
 * in. Rows are read back straight from the E2E database.
 */

test.describe.configure({ timeout: 90_000 });

const BUSINESS_TIME_ZONE = "America/New_York";
const FORM = "/request-service";
const DESCRIPTION =
  "The AC unit stopped cooling overnight and rattles loudly whenever it starts up.";
const CONFIRMATION_URL = /\/portal\/requests\/[0-9a-f-]{36}\?submitted=1$/;

/** A day in the allowed range: `daysAfterTomorrow` days after tomorrow, on the business's calendar. */
function chooseDay(daysAfterTomorrow = 2): string {
  const { min } = preferredDateRange(new Date(), BUSINESS_TIME_ZONE);
  return addDaysToDateOnly(min, daysAfterTomorrow);
}

const requestForm = (page: Page): Locator => page.getByRole("form", { name: "Request a service" });

/** Opens the form and waits until it is interactive (a click before hydration is lost). */
async function openForm(page: Page, query = ""): Promise<Locator> {
  await page.goto(`${FORM}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const form = requestForm(page);
  await expectHydrated(form);
  // The last control: when it is interactive, the whole form has hydrated.
  await expectHydrated(page.getByLabel(/^Preferred date/));
  return form;
}

interface Choices {
  service?: RegExp;
  /** The service was chosen by the link (`?service=`); do not click one. */
  keepPreselectedService?: boolean;
  description?: string;
  date?: string;
  window?: RegExp;
}

/** Fills the form like a person: choose, describe, date, window. The saved address is left as offered. */
async function fillForm(form: Locator, choices: Choices = {}): Promise<void> {
  if (choices.keepPreselectedService !== true) {
    await form.getByRole("radio", { name: choices.service ?? /AC Routine Maintenance/ }).click();
  }
  await form.getByLabel(/^What needs fixing/).fill(choices.description ?? DESCRIPTION);
  await form.getByLabel(/^Preferred date/).fill(choices.date ?? chooseDay());
  await form.getByRole("radio", { name: choices.window ?? /Morning/ }).click();
}

const sendButton = (form: Locator) => form.getByRole("button", { name: "Send request" });

async function expectAccessible(page: Page): Promise<void> {
  expect(await seriousViolations(page), "serious axe violations").toBe("");
}

/** A customer with one saved address, signed in through the real form. */
async function signedInCustomer(
  page: Page,
  options: { addresses?: Parameters<typeof createAddressesFor>[1] } = {},
): Promise<FixtureAccount> {
  const account = await createCustomerAccount({ name: "Jordan Fixture" });
  const addresses = options.addresses ?? [
    {
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: "Unit 4",
      city: "Harbor City",
      postalCode: "10999",
      accessNotes: "Gate code 4821, friendly dog.",
    },
  ];
  if (addresses.length > 0) await createAddressesFor(account.id, addresses);
  await loginAs(page, account);
  return account;
}

test.describe("getting to the form (spec §7.1 step 3)", () => {
  test("a visitor is sent to sign-in from the service page and comes back to the form with that service chosen", async ({
    page,
  }) => {
    await page.goto("/services/ac-routine-maintenance");
    await page.getByRole("link", { name: "Request this service" }).click();

    await expect(page).toHaveURL(
      /\/login\?returnTo=%2Frequest-service%3Fservice%3Dac-routine-maintenance$/,
      { timeout: NAVIGATION_TIMEOUT },
    );
    const demo = demoAccount("customer");
    await submitLoginForm(page, demo.email, demo.password);

    await page.waitForURL(/\/request-service\?service=ac-routine-maintenance$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    const form = requestForm(page);
    await expect(form).toBeVisible();
    await expect(form.getByRole("radio", { name: /AC Routine Maintenance/ })).toBeChecked();
    await expect(form.getByRole("radio", { name: /Washing Machine Repair/ })).not.toBeChecked();
  });

  test("the general button leads to the same form with nothing chosen", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("region", { name: /handled from first request/ })
      .getByRole("link", { name: "Request a service" })
      .click();

    await expect(page).toHaveURL(/\/login\?returnTo=%2Frequest-service$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    const account = await createCustomerAccount();
    await submitLoginForm(page, account.email, account.password);
    await page.waitForURL(/\/request-service$/, { timeout: NAVIGATION_TIMEOUT });

    const services = requestForm(page).getByRole("group", { name: "Service", exact: true });
    await expect(services.getByRole("radio")).toHaveCount(5);
    await expect(services.getByRole("radio", { checked: true })).toHaveCount(0);
  });
});

test.describe("sending a request", () => {
  test("creates the request, confirms it, lists it, tells the business and emails both sides", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    const day = chooseDay(3);

    await fillForm(form, { keepPreselectedService: true, date: day, window: /Afternoon/ });
    // The review reflects the choices before anything is sent.
    const review = form.locator("dl[aria-label='Your request so far']");
    await expect(review).toContainText("AC Routine Maintenance");
    await expect(review).toContainText("Home: 214 Larkspur Lane, Unit 4, Harbor City, NY 10999");
    await expect(review).toContainText("afternoon (12:00 PM – 4:00 PM");
    await sendButton(form).click();

    // The confirmation: the reference, status Submitted, what happens next.
    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
    const confirmation = page.getByRole("region", { name: "Your request has been sent" });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("heading", { name: "Your request has been sent" }),
    ).toBeFocused();
    const reference = (await confirmation.getByText(/^FF-\d{4}-\d{5}$/).textContent()) ?? "";
    expect(reference).toMatch(/^FF-\d{4}-\d{5}$/);
    await expect(confirmation.getByText("Submitted")).toBeVisible();
    await expect(confirmation.getByText("What happens next")).toBeVisible();

    // The record is what the customer asked for, with the server's snapshots and times.
    const [stored] = await readRequestsOf(account.id);
    expect(stored).toMatchObject({
      reference,
      status: "SUBMITTED",
      serviceNameSnapshot: "AC Routine Maintenance",
      addressLine1: "214 Larkspur Lane",
      addressLine2: "Unit 4",
      addressCity: "Harbor City",
      addressPostalCode: "10999",
      accessNotesSnapshot: "Gate code 4821, friendly dog.",
      description: DESCRIPTION,
      preferredDate: day,
      preferredWindow: "AFTERNOON",
    });
    expect((stored?.preferredEnd.getTime() ?? 0) - (stored?.preferredStart.getTime() ?? 0)).toBe(
      4 * 3_600_000,
    );

    // The detail page: status, the details as sent, the time on the business's clock, and the history.
    await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
    await expect(page.getByText(/Afternoon · .*12:00 – 4:00 PM E[SD]T/)).toBeVisible();
    await expect(page.getByRole("main").locator("address")).toContainText("214 Larkspur Lane");
    await expect(page.getByText(/Gate code 4821/)).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Request history" }).getByText("You submitted your request."),
    ).toBeVisible();

    // It is on the list, and on the overview.
    await page.getByRole("link", { name: "Requests", exact: true }).first().click();
    await page.waitForURL(/\/portal\/requests$/, { timeout: NAVIGATION_TIMEOUT });
    const row = page.getByRole("row").filter({ hasText: reference });
    await expect(row).toContainText("AC Routine Maintenance");
    await expect(row).toContainText("Submitted");
    await expect(row).toContainText("We're reviewing your request and will send a quotation.");
    await page.goto("/portal");
    await expect(
      page
        .getByRole("region", { name: "Your requests" })
        .getByRole("link", { name: new RegExp(reference) }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    // The business: every admin is notified, with a link to the request.
    const notifications = await receivedNotificationsFor(stored?.id ?? "");
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]).toMatchObject({
      title: `New request ${reference}`,
      linkPath: `/app/requests/${stored?.id}`,
    });
    expect(await activityOf(stored?.id ?? "")).toEqual([
      expect.objectContaining({
        action: "request.submitted",
        publicSummary: "You submitted your request.",
        toStatus: "SUBMITTED",
      }),
    ]);

    // The emails were logged (log transport): to the customer, and to the business.
    const customerEmail = await waitForEmailTo(account.email);
    expect(customerEmail.subject).toBe(`We received your request ${reference}`);
    expect(customerEmail.text).toContain("Preferred time");
    expect(customerEmail.text).toContain("What happens next");
    expect(customerEmail.text).not.toContain(DESCRIPTION);
    expect(customerEmail.text).not.toContain("214 Larkspur Lane");
    await expect
      .poll(() =>
        readOutbox().some(
          (email) =>
            email.to === "hello@coolbreeze.test" &&
            email.subject === `New request ${reference}: AC Routine Maintenance`,
        ),
      )
      .toBe(true);
  });

  test("sends nothing and creates nothing while the form is incomplete, and says what is missing", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page);

    await sendButton(form).click();

    const summary = page.getByRole("alert").filter({ hasText: "problems to fix" });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Service: Choose a service.");
    await expect(summary).toContainText("Problem description");
    await expect(summary).toContainText("Preferred date: Choose a date.");
    await expect(summary).toContainText("Preferred time window: Choose a time window.");
    await expect(form.getByLabel(/^What needs fixing/)).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/request-service$/);
    expect(await countRequestsOf(account.id)).toBe(0);

    // Fixing the fields and sending again works, with what was already typed still there.
    await form.getByLabel(/^What needs fixing/).fill("Too short.");
    await sendButton(form).click();
    await expect(form.getByLabel(/^What needs fixing/)).toHaveAccessibleDescription(
      /the description needs at least 20 characters/,
    );
    await expect(form.getByLabel(/^What needs fixing/)).toHaveValue("Too short.");
    expect(await countRequestsOf(account.id)).toBe(0);
    await expectAccessible(page);
  });

  test("a double click creates one request", async ({ page }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    await fillForm(form, { keepPreselectedService: true });

    await sendButton(form).dblclick();

    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
    expect(await countRequestsOf(account.id)).toBe(1);
  });

  test("a new address can be saved to the profile with the request", async ({ page }) => {
    const account = await signedInCustomer(page, { addresses: [] });
    const form = await openForm(page, "?service=ac-routine-maintenance");

    // With no saved address the form starts on the fields to type one.
    await form.getByLabel(/^Street address/).fill("73 Millrace Court");
    await form.getByLabel(/^City/).fill("Harbor City");
    await form.getByLabel(/^Postal code/).fill("10998");
    await form.getByRole("switch", { name: "Save this address to my profile" }).click();
    await form.getByLabel(/^Label/).fill("Rental unit");
    await fillForm(form, { keepPreselectedService: true });
    await sendButton(form).click();

    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
    expect(await savedAddressesOf(account.id)).toEqual([
      { label: "Rental unit", line1: "73 Millrace Court", isDefault: true },
    ]);
    const [stored] = await readRequestsOf(account.id);
    expect(stored?.serviceAddressId).not.toBeNull();
    expect(stored?.addressLine1).toBe("73 Millrace Court");
  });
});

test("the admin sees that requests are made by customers, not a form", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto(FORM);

  await expect(page.getByText("Requests are made by customers")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute(
    "href",
    "/app/dashboard",
  );
  await expect(requestForm(page)).toHaveCount(0);
});

test.describe("tracking requests", () => {
  const rowFor = (page: Page, reference: string) =>
    page.getByRole("row").filter({ hasText: reference });
  const table = (page: Page) => page.getByRole("table", { name: "Your service requests" });

  async function openList(page: Page, query = ""): Promise<void> {
    await page.goto(`/portal/requests${query}`);
    await expect(page.getByRole("heading", { level: 1, name: "Your requests" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  }

  test("lists newest first in pages of twenty, with a count and paging links", async ({ page }) => {
    const account = await signedInCustomer(page);
    const created = await createRequestsFor(account.id, 25);
    const newest = created.at(-1)?.reference ?? "";
    const oldest = created[0]?.reference ?? "";

    await openList(page);

    await expect(table(page).getByRole("row")).toHaveCount(21); // the header and twenty requests
    await expect(table(page).getByRole("row").nth(1)).toContainText(newest);
    await expect(page.getByText(/Showing 1–20 of 25 requests/)).toBeVisible();
    await expect(rowFor(page, oldest)).toHaveCount(0);

    await page.getByRole("link", { name: "Next page" }).click();
    await page.waitForURL(/page=2/, { timeout: NAVIGATION_TIMEOUT });
    await expect(table(page).getByRole("row")).toHaveCount(6);
    await expect(rowFor(page, oldest)).toBeVisible();
  });

  test("filters by status and clears the filter, keeping the choice in the address", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    await createRequestsFor(account.id, 2, { status: "SUBMITTED" });
    const cancelled = await createRequestsFor(account.id, 3, { status: "CANCELLED" });
    await openList(page);
    await expectHydrated(page.getByRole("search", { name: "Filter requests" }));

    await page.getByLabel("Status").selectOption("CANCELLED");
    await page.getByRole("button", { name: "Apply filter" }).click();

    await page.waitForURL(/status=CANCELLED/, { timeout: NAVIGATION_TIMEOUT });
    await expect(table(page).getByRole("row")).toHaveCount(4);
    for (const request of cancelled) {
      await expect(rowFor(page, request.reference)).toContainText("Cancelled");
    }
    await expect(page.getByLabel("Status")).toHaveValue("CANCELLED");

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL(/\/portal\/requests$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(table(page).getByRole("row")).toHaveCount(6);
  });

  test("says what to do when there are no requests, and when a filter matches none", async ({
    page,
  }) => {
    await signedInCustomer(page);

    await openList(page);
    await expect(
      page.getByRole("heading", { name: "You haven't sent a request yet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Request a service" }).last(),
    ).toHaveAttribute("href", "/request-service");

    await openList(page, "?status=QUOTED");
    await expect(page.getByRole("heading", { name: "No requests match" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Show all requests" })).toBeVisible();
  });

  test("the overview shows the latest three, with a link to all of them", async ({ page }) => {
    const account = await signedInCustomer(page);
    const created = await createRequestsFor(account.id, 5);

    await page.goto("/portal");

    const section = page.getByRole("region", { name: "Your requests" });
    await expect(section).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(section.getByRole("link", { name: /FF-/ })).toHaveCount(3);
    await expect(
      section.getByRole("link", { name: new RegExp(created.at(-1)?.reference ?? "") }),
    ).toBeVisible();
    await expect(section.getByRole("link", { name: "View all requests (5)" })).toHaveAttribute(
      "href",
      "/portal/requests",
    );
    await expect(
      page.getByRole("main").getByRole("link", { name: "Request a service" }).first(),
    ).toHaveAttribute("href", "/request-service");
  });

  test("the customer's navigation has Requests, current on its pages", async ({ page }) => {
    const account = await signedInCustomer(page);
    const [request] = await createRequestsFor(account.id, 1);

    await page.goto(`/portal/requests/${request?.id}`);

    await expect(
      page.getByRole("heading", { level: 1, name: request?.reference ?? "" }),
    ).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(
      page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Requests" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("shows the notes the business shared and the history written for the customer, and nothing internal", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const [request] = await createRequestsFor(account.id, 1);
    const [stored] = await readRequestsOf(account.id);
    const requestId = request?.id ?? "";
    const customerId = stored?.customerId ?? "";
    const adminId = await userIdFor("admin@demo.fixflow.test");
    await createNoteOn(
      requestId,
      adminId,
      "We will bring a replacement capacitor with us.",
      "CUSTOMER_VISIBLE",
    );
    await createNoteOn(
      requestId,
      adminId,
      "Customer was difficult last year; quote high.",
      "INTERNAL",
    );
    await createEventOn({ id: requestId, customerId }, adminId, "Flagged: repeat no-show.", null);
    await createEventOn(
      { id: requestId, customerId },
      adminId,
      "Asked for more detail.",
      "We asked you for a little more detail.",
    );

    await page.goto(`/portal/requests/${requestId}`);

    await expect(
      page.getByRole("heading", { level: 1, name: request?.reference ?? "" }),
    ).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    const notes = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: "Messages from us" }) });
    await expect(notes).toContainText("We will bring a replacement capacitor with us.");
    await expect(notes).toContainText("CoolBreeze Home Services");
    await expect(page.getByRole("list", { name: "Request history" })).toContainText(
      "We asked you for a little more detail.",
    );
    // Nothing the business wrote for itself is anywhere on the page.
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).not.toContain("Customer was difficult");
    expect(text).not.toContain("Flagged: repeat no-show");
    expect(text).not.toContain("Asked for more detail.");
    expect(text).not.toContain("Morgan Reyes");
  });
});

test.describe("one customer cannot see another's request (G.5)", () => {
  const NOT_FOUND = "We couldn't find that request";

  test("shows 'not found' for someone else's request, exactly as for one that does not exist", async ({
    page,
  }) => {
    const owner = await createCustomerAccount({ name: "Owner Fixture" });
    const [theirs] = await createRequestsFor(owner.id, 1);
    await signedInCustomer(page);

    await page.goto(`/portal/requests/${theirs?.id}`);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    const foreign = await page.locator("main").innerText();

    await page.goto("/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    expect(await page.locator("main").innerText()).toBe(foreign);
    expect(foreign).not.toContain(theirs?.reference ?? "never");

    // A reference is a label, not a key: it opens nothing.
    await page.goto(`/portal/requests/${theirs?.reference}`);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("lists only the customer's own requests", async ({ page }) => {
    const other = await createCustomerAccount();
    const [theirs] = await createRequestsFor(other.id, 1);
    const mine = await signedInCustomer(page);
    const [own] = await createRequestsFor(mine.id, 1);

    await page.goto("/portal/requests");

    await expect(page.getByRole("row").filter({ hasText: own?.reference ?? "" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByText(theirs?.reference ?? "never")).toHaveCount(0);
  });

  test("sends a visitor who is not signed in to sign-in, remembering the request", async ({
    page,
  }) => {
    const owner = await createCustomerAccount();
    const [theirs] = await createRequestsFor(owner.id, 1);

    await page.goto(`/portal/requests/${theirs?.id}`);

    await expect(page).toHaveURL(
      new RegExp(`/login\\?returnTo=%2Fportal%2Frequests%2F${theirs?.id}`),
      { timeout: NAVIGATION_TIMEOUT },
    );
  });
});

test.describe("services that cannot be requested (FR-006, G.3)", () => {
  for (const state of ["unpublished", "archived"] as const) {
    test(`a link to an ${state} service says so and chooses nothing, and the service is not offered`, async ({
      page,
    }) => {
      const service = await createInactiveService(state);
      await signedInCustomer(page);

      const form = await openForm(page, `?service=${service.slug}`);

      await expect(
        form.getByText("The service you picked isn't open for requests right now."),
      ).toBeVisible();
      const group = form.getByRole("group", { name: "Service", exact: true });
      await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
      await expect(group.getByRole("radio", { name: new RegExp(service.name) })).toHaveCount(0);
      await expect(group.getByRole("radio")).toHaveCount(5);
    });
  }

  test("a link to a service that does not exist does the same", async ({ page }) => {
    await signedInCustomer(page);

    const form = await openForm(page, "?service=no-such-service");

    await expect(form.getByText("The service you picked isn't open for requests")).toBeVisible();
    const group = form.getByRole("group", { name: "Service", exact: true });
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
  });

  test("a service withdrawn while the form is open is refused with a message beside the service, and the form is kept", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    await fillForm(form, { keepPreselectedService: true });
    // The API refuses, as it does for a service archived a moment ago. The real refusal, through
    // the API, is covered in requests.int.test.ts; here the question is what the form does with it.
    await page.route("**/api/v1/requests", (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        json: {
          error: {
            code: "SERVICE_INACTIVE",
            message: "This service isn't open for new requests right now.",
            fieldErrors: {
              serviceId:
                "This service isn't open for new requests right now. Please choose another service.",
            },
            requestId: "e2e",
          },
        },
      }),
    );

    await sendButton(form).click();

    const services = form.getByRole("group", { name: "Service", exact: true });
    await expect(services).toContainText("isn't open for new requests right now");
    await expect(form.getByLabel(/^What needs fixing/)).toHaveValue(DESCRIPTION);
    await expect(form.getByRole("radio", { name: /Morning/ })).toBeChecked();
    await expect(page).toHaveURL(/\/request-service/);
    expect(await countRequestsOf(account.id)).toBe(0);
  });
});

test.describe("when sending fails", () => {
  test("keeps the form and says what happened; a retry sends the same submission key and makes one request", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    await fillForm(form, { keepPreselectedService: true });
    const keys: string[] = [];
    let attempts = 0;
    await page.route("**/api/v1/requests", async (route) => {
      keys.push((route.request().postDataJSON() as { submissionKey: string }).submissionKey);
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          json: {
            error: {
              code: "INTERNAL_ERROR",
              message: "Something went wrong on our side. Please try again.",
              requestId: "e2e",
            },
          },
        });
        return;
      }
      await route.continue();
    });

    await sendButton(form).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Something went wrong on our side" }),
    ).toBeVisible();
    await expect(form.getByLabel(/^What needs fixing/)).toHaveValue(DESCRIPTION);
    await expect(sendButton(form)).toBeEnabled();
    expect(await countRequestsOf(account.id)).toBe(0);

    await sendButton(form).click();
    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(await countRequestsOf(account.id)).toBe(1);
  });

  test("a request that got through but whose answer was lost is not duplicated by the retry", async ({
    page,
  }) => {
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    await fillForm(form, { keepPreselectedService: true });
    let attempts = 0;
    await page.route("**/api/v1/requests", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        // The request reaches the server and is created; the browser never hears back.
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    await sendButton(form).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /couldn't reach the server/ }),
    ).toBeVisible();
    expect(await countRequestsOf(account.id)).toBe(1);
    await sendButton(form).click();

    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
    expect(await countRequestsOf(account.id)).toBe(1);
  });
});

/** Presses Tab until `target` has focus, failing if it is not reached: proof it can be reached by keyboard. */
async function tabTo(page: Page, target: Locator, maxPresses = 25): Promise<void> {
  for (let press = 0; press <= maxPresses; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Focus never reached ${String(target)} in ${maxPresses} presses of Tab.`);
}

test("the whole form can be completed and sent with the keyboard alone", async ({ page }) => {
  const account = await signedInCustomer(page);
  const form = await openForm(page);
  const day = chooseDay(4);
  const [year, month, dayOfMonth] = day.split("-");
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  // 1. A service: Tab to the group, Space chooses the focused one.
  await tabTo(page, form.getByRole("radio", { name: /AC Diagnostic Visit/ }));
  await page.keyboard.press("Space");
  await expect(form.getByRole("radio", { name: /AC Diagnostic Visit/ })).toBeChecked();

  // 2. The problem.
  await tabTo(page, form.getByLabel(/^What needs fixing/));
  await page.keyboard.type(DESCRIPTION);

  // 3. The address offered first (the default) is already chosen; Tab passes through it.
  await expect(form.getByRole("radio", { name: /^Home Default/ })).toBeChecked();

  // 4. The date, typed into the date field's segments (month, day, year), then the window.
  await tabTo(page, form.getByLabel(/^Preferred date/));
  await page.keyboard.type(`${month}${dayOfMonth}${year}`);
  await expect(form.getByLabel(/^Preferred date/)).toHaveValue(day);
  await tabTo(page, form.getByRole("radio", { name: /Morning/ }));
  // Radix chooses the radio the arrow key lands on while the key is still down, as a person's
  // key press does; Playwright's `press` would release it in the same instant.
  await page.keyboard.down("ArrowDown");
  await expect(form.getByRole("radio", { name: /Afternoon/ })).toBeFocused();
  await page.keyboard.up("ArrowDown");
  await expect(form.getByRole("radio", { name: /Afternoon/ })).toBeChecked();

  // 5. Send.
  await tabTo(page, sendButton(form));
  await page.keyboard.press("Enter");

  await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
  const [stored] = await readRequestsOf(account.id);
  expect(stored).toMatchObject({
    serviceNameSnapshot: "AC Diagnostic Visit",
    preferredDate: day,
    preferredWindow: "AFTERNOON",
  });
});

test.describe("on a phone (360 px) and at every width", () => {
  test("can be completed and sent at 360 px with comfortable targets and no sideways scroll", async ({
    page,
  }) => {
    await useViewport(page, 360);
    const account = await signedInCustomer(page);
    const form = await openForm(page, "?service=ac-routine-maintenance");
    await expectNoHorizontalOverflow(page);

    // Targets a thumb can hit: the fields, the choices and the main button are at least 44 px tall.
    const tall = async (locator: Locator, minimum: number, what: string) => {
      for (const element of await locator.all()) {
        const box = await element.boundingBox();
        expect(box?.height ?? 0, `${what} is tall enough`).toBeGreaterThanOrEqual(minimum);
      }
    };
    await tall(form.locator("input:not([type=radio]):not([type=hidden]), textarea"), 44, "a field");
    await tall(form.locator("label").filter({ has: page.getByRole("radio") }), 44, "a choice");
    await tall(sendButton(form), 44, "the Send button");
    const send = await sendButton(form).boundingBox();
    const fillsItsContainer = await sendButton(form).evaluate((button) => {
      const parent = button.parentElement as HTMLElement;
      const style = getComputedStyle(parent);
      const inner =
        parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return Math.abs(button.getBoundingClientRect().width - inner) <= 1;
    });
    expect(fillsItsContainer).toBe(true);
    expect(send?.width ?? 0).toBeGreaterThan(250); // and that is most of a 360 px screen

    await fillForm(form, { keepPreselectedService: true, window: /Evening/ });
    await expectNoHorizontalOverflow(page);
    await sendButton(form).click();

    await page.waitForURL(CONFIRMATION_URL, { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("region", { name: "Your request has been sent" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await countRequestsOf(account.id)).toBe(1);
  });

  for (const width of WIDTHS) {
    test(`the form, the list and a request fit at ${width} px`, async ({ page }) => {
      await useViewport(page, width);
      const account = await signedInCustomer(page);
      const [request] = await createRequestsFor(account.id, 3);

      await openForm(page, "?service=ac-routine-maintenance");
      await expectNoHorizontalOverflow(page);
      await requestForm(page).getByRole("button", { name: "Add a new address" }).click();
      await requestForm(page)
        .getByRole("switch", { name: "Save this address to my profile" })
        .click();
      await expectNoHorizontalOverflow(page);

      await page.goto("/portal/requests");
      await expect(page.getByRole("heading", { level: 1, name: "Your requests" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);

      await page.goto(`/portal/requests/${request?.id}?submitted=1`);
      await expect(
        page.getByRole("heading", { level: 1, name: request?.reference ?? "" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);

      await page.goto("/portal");
      await expect(page.getByRole("region", { name: "Your requests" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("accessibility (axe)", () => {
  for (const width of [360, 1440]) {
    test(`the form is clean at ${width} px: empty, with errors, and typing a new address`, async ({
      page,
    }) => {
      await useViewport(page, width);
      await signedInCustomer(page);
      const form = await openForm(page, "?service=ac-routine-maintenance");
      await expectAccessible(page);

      await sendButton(form).click();
      await expect(page.getByRole("alert").filter({ hasText: "problems to fix" })).toBeVisible();
      await expectAccessible(page);

      await form.getByRole("button", { name: "Add a new address" }).click();
      await form.getByRole("switch", { name: "Save this address to my profile" }).click();
      await sendButton(form).click();
      await expect(form.getByLabel(/^Label/)).toHaveAttribute("aria-invalid", "true");
      await expectAccessible(page);
    });

    test(`the list, a request, its confirmation and the empty states are clean at ${width} px`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const account = await signedInCustomer(page);
      await page.goto("/portal/requests");
      await expect(
        page.getByRole("heading", { name: "You haven't sent a request yet" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      const [request] = await createRequestsFor(account.id, 3);
      const [stored] = await readRequestsOf(account.id);
      const adminId = await userIdFor("admin@demo.fixflow.test");
      await createNoteOn(
        request?.id ?? "",
        adminId,
        "We will bring a spare part.",
        "CUSTOMER_VISIBLE",
      );
      await createEventOn(
        { id: request?.id ?? "", customerId: stored?.customerId ?? "" },
        adminId,
        "Looked at the photos.",
        "We reviewed your request.",
      );

      await page.goto("/portal/requests");
      await expect(page.getByRole("link", { name: request?.reference ?? "" }).first()).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await page.goto(`/portal/requests/${request?.id}?submitted=1`);
      await expect(
        page.getByRole("heading", { level: 1, name: request?.reference ?? "" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await page.goto("/portal");
      await expect(page.getByRole("region", { name: "Your requests" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);

      await page.goto("/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that request" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectAccessible(page);
    });
  }

  test("the notice about a service that cannot be requested is clean", async ({ page }) => {
    await signedInCustomer(page);
    await openForm(page, "?service=no-such-service");
    await expectAccessible(page);
  });

  test("the message an admin sees instead of the form is clean", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(FORM);
    await expect(page.getByText("Requests are made by customers")).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectAccessible(page);
  });
});
