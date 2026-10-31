import { expect, test } from "@playwright/test";

import {
  businessDay,
  notificationsFor,
  quotationDefaults,
  quotationEventsOf,
  quotationLinesOf,
  quotationsOf,
} from "../fixtures/quotations.js";
import { readRequestState } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  banner,
  button,
  createDraft,
  customerWithRequest,
  expectEditor,
  fillWorkedExample,
  headerBadge,
  line,
  openRequest,
  quotationDocument,
  referenceOnPage,
  saveDraft,
  sendThroughDialog,
  totalsCard,
} from "./helpers/quotations.js";

/**
 * The quotation builder, sending and replacement (T14, workflow 7.2 steps 4 to 8, FR-040 to FR-047).
 * Every flow runs on a customer and a request made for that test, because the specs run in parallel
 * on one shared demo admin and one database. What the screens show is checked against what was
 * actually stored, read back from the E2E database.
 */

test.describe.configure({ timeout: 150_000 });

test("an admin creates a quotation with three lines and a discount, saves, previews and sends it, then replaces it", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, request } = await customerWithRequest();
  const defaults = await quotationDefaults();
  await loginAs(page, "admin");

  // The request has no quotation yet, and says how to start one.
  await openRequest(page, request);
  await expect(page.getByText(/Use “Create quotation” above to prepare one/)).toBeVisible();

  // Creating the draft opens its editor, filled in from the settings.
  await button(page, "Create quotation").click();
  await expectEditor(page);
  await expect(page.getByLabel("Tax rate (%)")).toHaveValue(defaults.taxRate);
  await expect(page.getByLabel(/^Valid until/)).toHaveValue(businessDay(defaults.validityDays));
  if (defaults.terms !== null) {
    await expect(page.getByLabel("Terms")).toHaveValue(defaults.terms);
  }
  await expect(page.getByLabel("Description").first()).toHaveValue("AC Routine Maintenance");
  await expect(page.getByText("Preview — final totals are calculated when you save")).toBeVisible();
  const draftReference = await referenceOnPage(page);
  const [draft] = await quotationsOf(request.id);
  expect(draft).toMatchObject({ status: "DRAFT", reference: draftReference, lineCount: 1 });
  // A fixed-price service starts the draft at its price; the quote-only ones at zero.
  await expect(line(page, 1).getByLabel(/^Unit price/)).toHaveValue("129.00");

  // Three lines and a discount: the totals update as the admin types.
  await fillWorkedExample(page, "25.20");
  await expect(totalsCard(page).getByText("$252.00")).toBeVisible();
  await expect(totalsCard(page).getByText("-$25.20")).toBeVisible();
  await expect(totalsCard(page).getByText("$3.28")).toBeVisible();
  await expect(totalsCard(page).getByText("$230.08")).toBeVisible();
  await expect(line(page, 3).getByText("$127.50")).toBeVisible();

  // Nothing is stored until Save draft, and Preview and Send wait for it.
  expect((await quotationsOf(request.id))[0]).toMatchObject({
    totalAmount: draft?.totalAmount,
    lineCount: 1,
  });
  await expect(button(page, "Preview")).toBeDisabled();
  await expect(button(page, "Send to customer…")).toBeDisabled();
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();

  await saveDraft(page);
  await expect(button(page, "Preview")).toBeEnabled();
  await expect(button(page, "Send to customer…")).toBeEnabled();
  const [saved] = await quotationsOf(request.id);
  expect(saved).toMatchObject({
    status: "DRAFT",
    subtotal: "252.00",
    discountAmount: "25.20",
    taxableBase: "40.95",
    taxAmount: "3.28",
    totalAmount: "230.08",
    lineCount: 3,
  });
  expect((await quotationLinesOf(draft?.id ?? "")).map((row) => row.lineSubtotal)).toEqual([
    "79.00",
    "45.50",
    "127.50",
  ]);

  // Preview shows the customer's view of the saved draft; closing it returns focus to the button.
  await button(page, "Preview").click();
  const preview = page.getByRole("dialog", { name: "Preview for the customer" });
  await expect(preview.getByTestId("quotation-document")).toBeVisible();
  await expect(preview.getByText("$230.08")).toBeVisible();
  await expect(preview.getByText("Quinn Quotable")).toBeVisible();
  await expect(preview).toContainText("It has not been sent");
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(button(page, "Preview")).toBeFocused();
  expect(await notificationsFor(customer.id, "QUOTATION_SENT")).toHaveLength(0);

  // Sending asks first, says it cannot be edited and until when, and then does it.
  await button(page, "Send to customer…").click();
  const confirmation = page.getByRole("alertdialog", {
    name: `Send ${draftReference} to Quinn Quotable?`,
  });
  await expect(confirmation).toContainText("After sending, this quotation can't be edited.");
  await expect(confirmation).toContainText(
    "The customer will be able to accept or decline it until",
  );
  await confirmation.getByRole("button", { name: "Send to customer", exact: true }).click();
  await expect(banner(page)).toContainText("Sent", { timeout: NAVIGATION_TIMEOUT });
  await expect(banner(page)).toContainText("valid until");
  await expect(page.getByRole("form", { name: "Quotation draft" })).toHaveCount(0);
  await expect(button(page, "Save draft")).toHaveCount(0);
  await expect(quotationDocument(page)).toContainText("$230.08");
  await expect(headerBadge(page)).toHaveAttribute("data-status", "SENT");

  // The customer was told, the request is quoted, and the history says so.
  expect((await quotationsOf(request.id))[0]).toMatchObject({ status: "SENT" });
  expect((await readRequestState(request.id)).status).toBe("QUOTED");
  expect(await notificationsFor(customer.id, "QUOTATION_SENT")).toEqual([
    expect.objectContaining({
      title: `Quotation ${draftReference} is ready`,
      linkPath: `/portal/quotations/${draft?.id ?? ""}`,
    }),
  ]);
  await expect(page.getByRole("list", { name: "Quotation history" })).toContainText(
    "sent quotation",
  );

  // The request page lists it, and has nothing more to offer in the way of a first quotation.
  await page.getByRole("link", { name: request.reference }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const versions = page.getByRole("table", { name: "Quotations for this request" });
  await expect(versions.getByRole("row", { name: new RegExp(draftReference) })).toContainText(
    "$230.08",
  );
  await expect(headerBadge(page)).toHaveAttribute("data-status", "QUOTED");
  await expect(button(page, "Create quotation")).toHaveCount(0);

  // Replacing: a new draft with the same lines, the old one still the live offer.
  await versions.getByRole("link", { name: new RegExp(draftReference) }).click();
  await expect(banner(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await button(page, "Replace with a new draft").click();
  await expectEditor(page);
  const replacementReference = await referenceOnPage(page);
  expect(replacementReference).not.toBe(draftReference);
  await expect(page.getByRole("group", { name: /^Line \d+$/ })).toHaveCount(3);
  await expect(line(page, 3).getByLabel("Description")).toHaveValue("Labour");
  await expect(page.getByLabel(/^Discount/)).toHaveValue("25.20");
  expect((await quotationsOf(request.id)).map((row) => row.status)).toEqual(["DRAFT", "SENT"]);

  // 79.00 + 45.50 + 2 × 85.00 = 294.50; the discount is spread, so the taxable base is 41.61,
  // tax 3.33 and the total 294.50 - 25.20 + 3.33 = 272.63. The tax rate is set so the figures are fixed.
  await page.getByLabel("Tax rate (%)").fill("8.00");
  await line(page, 3).getByLabel("Quantity").fill("2");
  await expect(totalsCard(page).getByText("$272.63")).toBeVisible();
  await saveDraft(page);
  await sendThroughDialog(page);

  // The replacement is sent and the old quotation is void, with the reason recorded.
  const all = await quotationsOf(request.id);
  const [replacement, original] = all;
  expect(replacement).toMatchObject({
    status: "SENT",
    reference: replacementReference,
    totalAmount: "272.63",
    replacesQuotationId: original?.id,
  });
  expect(original).toMatchObject({
    status: "VOID",
    reference: draftReference,
    voidReason: `Replaced by ${replacementReference}`,
  });
  expect(all).toHaveLength(2);
  expect(all.filter((row) => row.status === "SENT")).toHaveLength(1);
  expect((await readRequestState(request.id)).status).toBe("QUOTED");
  await expect(quotationDocument(page)).toContainText(replacementReference);
  await expect(page.getByRole("heading", { name: "Replacement chain" })).toBeVisible();
  await expect(page.getByText("Replaces", { exact: true })).toBeVisible();

  // The previous one shows VOID, and "Replaced by".
  await page.getByRole("link", { name: draftReference }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Quotation ${draftReference}` }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(headerBadge(page)).toHaveAttribute("data-status", "VOID");
  await expect(banner(page)).toContainText("Voided");
  await expect(banner(page)).toContainText(`Replaced by ${replacementReference}`);
  await expect(page.getByText("Replaced by", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: replacementReference }).first()).toBeVisible();
  // A void quotation has nothing left to do but be printed.
  await expect(button(page, "Replace with a new draft")).toHaveCount(0);
  await expect(button(page, "More actions")).toHaveCount(0);

  // Two sends, two notifications to the customer, and no "withdrawn" notice for the replaced one.
  expect(await notificationsFor(customer.id, "QUOTATION_SENT")).toHaveLength(2);
  expect(await notificationsFor(customer.id, "QUOTATION_WITHDRAWN")).toHaveLength(0);
  expect((await quotationEventsOf(request.id)).map((event) => event.action)).toEqual([
    "quotation.created",
    "quotation.sent",
    "quotation.created",
    "quotation.voided",
    "quotation.sent",
  ]);
});

test("a request that already has a draft opens it instead of making a second", async ({ page }) => {
  await useViewport(page, 1440);
  const { request } = await customerWithRequest();
  await loginAs(page, "admin");
  await createDraft(page, request);
  const reference = await referenceOnPage(page);

  // Back on the request, the main action is gone and the draft is in the list.
  await openRequest(page, request);
  await expect(button(page, "Create quotation")).toHaveCount(0);
  await expect(
    page
      .getByRole("table", { name: "Quotations for this request" })
      .getByRole("link", { name: new RegExp(reference) }),
  ).toBeVisible();
  expect(await quotationsOf(request.id)).toHaveLength(1);
});
