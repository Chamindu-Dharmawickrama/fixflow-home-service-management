import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  BUSINESS_TIME_ZONE,
  createBookedJobFor,
  seededTechnician,
  uniqueFutureDay,
} from "../fixtures/jobs.js";
import { createSentQuotationFor } from "../fixtures/quotations.js";
import { createRequestsFor } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT } from "./helpers/layout.js";
import { customerWithInvoices, signInAsCustomer } from "./helpers/portal-invoices.js";

/**
 * The customer's overview (T23, IA-C01, spec §9.3): what needs the customer first (quotations to
 * answer, invoices to pay), the visits to come, the latest requests and the way to ask for a service;
 * a welcome for a customer with nothing yet; and nothing at all of another customer's. Each test makes
 * its own customers, because the specs run in parallel on one database.
 */

test.describe.configure({ timeout: 180_000 });

const overview = (page: Page) => page.getByRole("main");

test("a customer with work in progress sees what needs them first, then the visits and the requests", async ({
  page,
}) => {
  const { customer, make } = await customerWithInvoices("Olivia Overview");
  const invoice = await make();
  const quotation = await createSentQuotationFor(customer.id);
  const day = uniqueFutureDay();
  const jordan = await seededTechnician("Jordan Lee");
  const job = await createBookedJobFor(customer.id, jordan.id, day, "10:00", "12:00");
  const [recent] = await createRequestsFor(customer.id, 1);

  await signInAsCustomer(page, customer);
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Olivia Overview" })).toBeVisible(
    {
      timeout: NAVIGATION_TIMEOUT,
    },
  );

  // ---- Action required comes first, with the quotation to answer and the invoice to pay ---------------
  const headings = await overview(page).getByRole("heading").allTextContents();
  expect(headings.slice(0, 4)).toEqual([
    "Hello, Olivia Overview",
    "Action required",
    "Awaiting your decision",
    "Outstanding invoices",
  ]);
  const action = page.getByRole("region", { name: "Action required" });
  await expect(action.getByText(quotation.quotation.reference).first()).toBeVisible();
  await expect(action).toContainText(invoice.invoiceNumber ?? "never");
  await expect(action.getByRole("link", { name: /^Review quotation/ })).toHaveAttribute(
    "href",
    new RegExp(`/portal/quotations/${quotation.quotation.id}$`),
  );

  // ---- The visit, with its day and time on the business's clocks ----------------------------------
  const visits = page.getByRole("region", { name: "Upcoming visits" });
  await expect(visits).toContainText(job.jobReference);
  await expect(visits).toContainText(/10:00 AM|10:00 – 12:00 PM|10:00 AM – 12:00 PM/);
  expect(BUSINESS_TIME_ZONE).toBe("America/New_York");

  // ---- The latest requests ------------------------------------------------------------------------
  const requests = page.getByRole("region", { name: "Your requests" });
  await expect(requests).toContainText(recent?.reference ?? "never");

  // ---- The way to ask for a service is at the top and works --------------------------------------
  await page.getByRole("link", { name: "Request a service" }).first().click();
  await page.waitForURL(/\/request-service$/, { timeout: NAVIGATION_TIMEOUT });
});

test("a customer who has not asked for anything yet is welcomed and shown the first step", async ({
  page,
}) => {
  const customer = await createCustomerAccount({ name: "Nina Newcomer" });
  await signInAsCustomer(page, customer);
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Nina Newcomer" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Action required" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Upcoming visits" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your requests" })).toHaveCount(0);
  const links = page.getByRole("link", { name: "Request a service" });
  await expect(links).toHaveCount(2);
  await links.last().click();
  await page.waitForURL(/\/request-service$/, { timeout: NAVIGATION_TIMEOUT });
});

test("another customer sees none of it: their overview is their own", async ({ page, browser }) => {
  const { customer: first, make } = await customerWithInvoices("Fiona First");
  const invoice = await make();
  const quotation = await createSentQuotationFor(first.id);
  const [request] = await createRequestsFor(first.id, 1);
  const second = await createCustomerAccount({ name: "Sam Second" });

  const context = await browser.newContext();
  const secondPage = await context.newPage();
  await signInAsCustomer(secondPage, second);
  await secondPage.goto("/portal");
  await expect(
    secondPage.getByRole("heading", { level: 1, name: "Hello, Sam Second" }),
  ).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const text = (await secondPage.getByRole("main").innerText()).replace(/\s+/g, " ");
  for (const secret of [
    invoice.invoiceNumber ?? "never",
    quotation.quotation.reference,
    request?.reference ?? "never",
    "Fiona First",
  ]) {
    expect(text, secret).not.toContain(secret);
  }
  await context.close();

  // The same customer, signed in, does see theirs (the check above is not an empty page).
  await signInAsCustomer(page, first);
  await page.goto("/portal");
  await expect(page.getByRole("region", { name: "Action required" })).toContainText(
    quotation.quotation.reference,
  );
});

test("an admin is not shown the customer's overview, and the endpoint answers 403", async ({
  page,
}) => {
  await loginAs(page, "admin");
  const response = await page.request.get("/api/v1/customers/me/overview");
  expect(response.status()).toBe(403);
});
