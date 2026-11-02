import { expect, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  businessDay,
  createSentQuotationFor,
  decisionTrailOf,
  quotationDecisionOf,
} from "../fixtures/quotations.js";
import { readRequestState } from "../fixtures/requests.js";
import { loginAs, signOut } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  acceptButton,
  acceptThroughDialog,
  awaitingDecision,
  confirmation,
  customerWithQuotation,
  decisionBar,
  declineButton,
  declineThroughDialog,
  openAwaitingQuotation,
  openPortalQuotation,
  openPortalRequest,
  pageBadge,
  PORTAL_QUOTATION_PATH,
  portalBanner,
} from "./helpers/portal-quotations.js";
import {
  banner,
  headerBadge,
  openRequest,
  quotationDocument,
  toast,
} from "./helpers/quotations.js";

/**
 * The customer's answer to a quotation (T15, workflow 7.3, FR-044, FR-045). Every flow runs on a
 * customer and a quotation made for that test, because the specs run in parallel on one shared demo
 * admin and one database. The customer signs in through the real form; the business is checked on its
 * own screens; and what each screen shows is checked against what was actually stored.
 */

test.describe.configure({ timeout: 150_000 });

test("a customer finds the quotation on their overview, accepts it, and the business sees it accepted", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, request, quotation } = await customerWithQuotation();
  await loginAs(page, customer);

  // The overview leads with what is waiting for an answer.
  await page.goto("/portal");
  await expect(awaitingDecision(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(awaitingDecision(page)).toContainText(quotation.reference);
  await expect(awaitingDecision(page)).toContainText("$255.64");
  await expect(awaitingDecision(page)).toContainText("5 days left");
  await awaitingDecision(page)
    .getByRole("link", { name: /Review quotation/ })
    .click();

  // The quotation reads as a document, with how long there is to answer.
  await expect(page).toHaveURL(PORTAL_QUOTATION_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(
    page.getByRole("heading", { level: 1, name: `Quotation ${quotation.reference}` }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(pageBadge(page)).toHaveAttribute("data-status", "SENT");
  await expect(portalBanner(page)).toContainText(/Valid until .+ — 5 days left/);
  await expect(quotationDocument(page)).toContainText("CoolBreeze Home Services");
  await expect(quotationDocument(page)).toContainText("Quinn Quotable");
  await expect(quotationDocument(page)).toContainText("Diagnostic visit");
  await expect(quotationDocument(page)).toContainText("$252.00");
  await expect(quotationDocument(page)).toContainText("$3.64");
  await expect(decisionBar(page)).toContainText("Total $255.64");

  // Accepting asks first: the total, what happens next, and that it is not a signature.
  await openAwaitingQuotation(page, quotation);
  await acceptButton(page).click();
  const dialog = page.getByRole("alertdialog", {
    name: `Accept ${quotation.reference}?`,
  });
  await expect(dialog).toContainText("a total of $255.64");
  await expect(dialog).toContainText("we'll contact you to schedule the work");
  await expect(dialog).toContainText(
    "This records your acceptance; it is not a contract signature.",
  );
  expect((await quotationDecisionOf(quotation.id)).status).toBe("SENT");
  await dialog.getByRole("button", { name: "Accept quotation", exact: true }).click();

  // After the server has said yes: a confirmation that takes focus, and the page as it now is.
  await expect(confirmation(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(confirmation(page)).toContainText("Thank you — your acceptance is recorded");
  await expect(confirmation(page)).toBeFocused();
  await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(portalBanner(page)).toContainText("You accepted this quotation on");
  await expect(acceptButton(page)).toHaveCount(0);
  await expect(declineButton(page)).toHaveCount(0);
  await expect(decisionBar(page)).toHaveCount(0);

  // What was stored: who, when, the request, the history, and every admin told.
  const stored = await quotationDecisionOf(quotation.id);
  expect(stored).toMatchObject({
    status: "ACCEPTED",
    respondedByUserId: customer.id,
    declineReason: null,
  });
  expect(stored.respondedAt).not.toBeNull();
  expect((await readRequestState(request.id)).status).toBe("ACCEPTED");
  const trail = await decisionTrailOf(quotation.id);
  expect(trail.events).toEqual([
    expect.objectContaining({
      action: "quotation.accepted",
      actorUserId: customer.id,
      summary: `Quinn Quotable accepted quotation ${quotation.reference}.`,
      publicSummary: `You accepted quotation ${quotation.reference}.`,
    }),
  ]);
  expect(trail.notifications.length).toBeGreaterThan(0);
  for (const notification of trail.notifications) {
    expect(notification).toMatchObject({
      type: "QUOTATION_ACCEPTED",
      title: `Quotation ${quotation.reference} accepted`,
      linkPath: `/app/quotations/${quotation.id}`,
    });
  }

  // Back on the overview nothing is waiting any more, and the request says what the customer did.
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(awaitingDecision(page)).toHaveCount(0);
  await openPortalRequest(page, request);
  await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED");
  await expect(page.getByTestId("current-quotation")).toContainText("You accepted it on");
  await expect(page.getByRole("list", { name: "Request history" })).toContainText(
    `You accepted quotation ${quotation.reference}.`,
  );

  // The business sees the decision on the request and on the quotation.
  await signOut(page);
  await loginAs(page, "admin");
  await openRequest(page, request);
  await expect(headerBadge(page)).toHaveAttribute("data-status", "ACCEPTED");
  const versions = page.getByRole("table", { name: "Quotations for this request" });
  await expect(versions.getByRole("row", { name: new RegExp(quotation.reference) })).toContainText(
    "Accepted",
  );
  await versions.getByRole("link", { name: new RegExp(quotation.reference) }).click();
  await expect(banner(page)).toContainText("Accepted", { timeout: NAVIGATION_TIMEOUT });
  await expect(banner(page)).toContainText("Quinn Quotable accepted this quotation");
  await expect(page.getByRole("list", { name: "Quotation history" })).toContainText(
    `Quinn Quotable accepted quotation ${quotation.reference}.`,
  );
});

test("a customer declines with a reason, and the business reads it", async ({ page }) => {
  await useViewport(page, 1440);
  const { customer, request, quotation } = await customerWithQuotation("Dana Declines");
  await loginAs(page, customer);
  await openAwaitingQuotation(page, quotation);

  // The reason is asked for without insisting on it, and nothing is sent before the confirmation.
  await declineButton(page).click();
  const dialog = page.getByRole("alertdialog", {
    name: `Decline ${quotation.reference}?`,
  });
  await expect(dialog.getByLabel(/Help us improve — why are you declining\?/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Decline quotation", exact: true }),
  ).toBeEnabled();
  expect((await quotationDecisionOf(quotation.id)).status).toBe("SENT");
  await dialog.getByLabel(/why are you declining/).fill("Found a lower price elsewhere.");
  await dialog.getByRole("button", { name: "Decline quotation", exact: true }).click();

  await expect(confirmation(page)).toContainText("Your answer is recorded", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(confirmation(page)).toContainText("No work will be scheduled from this quotation");
  await expect(pageBadge(page)).toHaveAttribute("data-status", "DECLINED", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(portalBanner(page)).toContainText("You declined this quotation on");
  await expect(decisionBar(page)).toHaveCount(0);

  expect(await quotationDecisionOf(quotation.id)).toMatchObject({
    status: "DECLINED",
    respondedByUserId: customer.id,
    declineReason: "Found a lower price elsewhere.",
  });
  expect((await readRequestState(request.id)).status).toBe("DECLINED");
  const trail = await decisionTrailOf(quotation.id);
  expect(trail.events).toEqual([
    expect.objectContaining({
      action: "quotation.declined",
      publicSummary: `You declined quotation ${quotation.reference}.`,
    }),
  ]);
  expect(trail.notifications.length).toBeGreaterThan(0);
  for (const notification of trail.notifications) {
    expect(notification).toMatchObject({
      type: "QUOTATION_DECLINED",
      linkPath: `/app/quotations/${quotation.id}`,
    });
  }

  // The business reads the customer's own words, and the request is declined.
  await signOut(page);
  await loginAs(page, "admin");
  await page.goto(`/app/quotations/${quotation.id}`);
  await expect(banner(page)).toContainText("Declined", { timeout: NAVIGATION_TIMEOUT });
  await expect(banner(page)).toContainText("“Found a lower price elsewhere.”");
  await expect(headerBadge(page)).toHaveAttribute("data-status", "DECLINED");
  await openRequest(page, request);
  await expect(headerBadge(page)).toHaveAttribute("data-status", "DECLINED");
});

test("a customer can decline without saying why", async ({ page }) => {
  await useViewport(page, 1440);
  const { customer, quotation } = await customerWithQuotation("Sam Silent");
  await loginAs(page, customer);
  await openAwaitingQuotation(page, quotation);

  await declineThroughDialog(page, quotation.reference);

  expect(await quotationDecisionOf(quotation.id)).toMatchObject({
    status: "DECLINED",
    declineReason: null,
  });
});

test("a quotation that ran out before it was answered shows the expired banner and no way to answer", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Late Larkin" });
  const { request, quotation } = await createSentQuotationFor(customer.id, {
    validUntil: businessDay(-2),
  });
  await loginAs(page, customer);

  // The overview does not offer an expired quotation as waiting for an answer.
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(awaitingDecision(page)).toHaveCount(0);

  await openPortalQuotation(page, quotation);
  await expect(pageBadge(page)).toHaveAttribute("data-status", "EXPIRED");
  await expect(portalBanner(page)).toContainText(
    "This quotation has expired — contact us for an updated quote",
  );
  await expect(portalBanner(page).getByRole("link", { name: /@/ })).toBeVisible();
  await expect(acceptButton(page)).toHaveCount(0);
  await expect(declineButton(page)).toHaveCount(0);
  await expect(decisionBar(page)).toHaveCount(0);
  // It is still a readable document.
  await expect(quotationDocument(page)).toContainText("$255.64");

  // Reading it saved the expiry, and the request went back to the business to be quoted afresh.
  expect((await quotationDecisionOf(quotation.id)).status).toBe("EXPIRED");
  expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");

  // Asking the server directly is refused in words, and records nothing.
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/v1/quotations/${quotation.id}/accept`, {
    data: {},
    headers: { origin },
  });
  expect(response.status()).toBe(409);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("QUOTATION_NOT_AVAILABLE");
  expect(body.error.message).toMatch(
    /has expired\. Contact us and we'll send an updated quotation\./,
  );
  expect(await quotationDecisionOf(quotation.id)).toMatchObject({
    status: "EXPIRED",
    respondedAt: null,
  });
});

test("another customer cannot open, accept or decline someone else's quotation", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { quotation } = await customerWithQuotation("Owner Olsen");
  const stranger = await createCustomerAccount({ name: "Prying Pat" });
  await loginAs(page, stranger);

  await page.goto(`/portal/quotations/${quotation.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "We couldn't find that quotation" }),
  ).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByText(quotation.reference)).toHaveCount(0);
  await expect(acceptButton(page)).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  for (const action of ["accept", "decline"]) {
    const response = await page.request.post(`/api/v1/quotations/${quotation.id}/${action}`, {
      data: {},
      headers: { origin },
    });
    expect(response.status(), action).toBe(404);
  }
  expect((await quotationDecisionOf(quotation.id)).status).toBe("SENT");
});

test("an answer given in another tab is explained, not repeated", async ({ browser }) => {
  const { customer, quotation } = await customerWithQuotation("Tabs Tanaka");
  const context = await browser.newContext();
  const first = await context.newPage();
  await useViewport(first, 1440);
  await loginAs(first, customer);
  await openAwaitingQuotation(first, quotation);
  // The second tab loads the quotation while it is still waiting for an answer.
  const second = await context.newPage();
  await useViewport(second, 1440);
  await openAwaitingQuotation(second, quotation);

  await acceptThroughDialog(first, quotation.reference);
  expect((await quotationDecisionOf(quotation.id)).status).toBe("ACCEPTED");

  // The stale tab still offers the buttons; pressing one is refused, in words that say what happened.
  await acceptButton(second).click();
  const dialog = second.getByRole("alertdialog", {
    name: `Accept ${quotation.reference}?`,
  });
  await dialog.getByRole("button", { name: "Accept quotation", exact: true }).click();
  await expect(toast(second, "You already accepted this quotation on")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // The page then shows the truth, and the second tab's answer changed nothing.
  await expect(pageBadge(second)).toHaveAttribute("data-status", "ACCEPTED", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(decisionBar(second)).toHaveCount(0);
  const trail = await decisionTrailOf(quotation.id);
  expect(trail.events).toHaveLength(1);
  await context.close();
});

test("declining a quotation that was accepted in another tab is refused with the right words", async ({
  browser,
}) => {
  const { customer, quotation } = await customerWithQuotation("Mixed Mendez");
  const context = await browser.newContext();
  const first = await context.newPage();
  await useViewport(first, 1440);
  await loginAs(first, customer);
  await openAwaitingQuotation(first, quotation);
  const second = await context.newPage();
  await useViewport(second, 1440);
  await openAwaitingQuotation(second, quotation);
  await acceptThroughDialog(first, quotation.reference);

  await declineButton(second).click();
  const dialog = second.getByRole("alertdialog", {
    name: `Decline ${quotation.reference}?`,
  });
  await dialog.getByRole("button", { name: "Decline quotation", exact: true }).click();

  await expect(toast(second, "so it can't be declined now")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  expect((await quotationDecisionOf(quotation.id)).status).toBe("ACCEPTED");
  await context.close();
});
