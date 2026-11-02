import { expect, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { businessDay, createSentQuotationFor } from "../fixtures/quotations.js";
import { loginAs } from "../support/auth.js";
import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import {
  acceptButton,
  acceptThroughDialog,
  awaitingDecision,
  confirmation,
  customerWithQuotation,
  decisionBar,
  declineButton,
  openAwaitingQuotation,
  openPortalQuotation,
  openPortalRequest,
  pageBadge,
  portalBanner,
} from "./helpers/portal-quotations.js";
import { seriousViolations } from "./helpers/public.js";
import { quotationDocument } from "./helpers/quotations.js";

/**
 * The states of the customer's quotation screens (T15): a withdrawn and a replaced quotation, what the
 * request page offers, printing on A4 and Letter, the bar that sticks to the foot of a phone, and
 * every screen at the four required widths, axe-clean.
 */

test.describe.configure({ timeout: 180_000 });

test.describe("a quotation the business replaced", () => {
  test("the old one says it was withdrawn and leads to the new one; the request lists both", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: "Rae Replaced" });
    const first = await createSentQuotationFor(customer.id, {
      status: "VOID",
      validUntil: businessDay(10),
    });
    const second = await createSentQuotationFor(customer.id, {
      request: first.request,
      replacesQuotationId: first.quotation.id,
      validUntil: businessDay(7),
    });
    await loginAs(page, customer);

    // The overview offers the live one only.
    await page.goto("/portal");
    await expect(awaitingDecision(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(awaitingDecision(page)).toContainText(second.quotation.reference);
    await expect(awaitingDecision(page)).not.toContainText(first.quotation.reference);
    await expect(awaitingDecision(page)).toContainText("7 days left");

    // The request leads with the current quotation and lists the earlier one, pointing forward.
    await openPortalRequest(page, first.request);
    const card = page.getByRole("region", { name: "Current quotation" });
    await expect(card.getByTestId("current-quotation")).toContainText(second.quotation.reference);
    await expect(card.getByTestId("current-quotation")).toContainText("Waiting for your answer");
    const earlier = card.getByRole("list");
    await expect(earlier).toContainText(first.quotation.reference);
    await expect(earlier).toContainText("Void");
    await expect(earlier.getByRole("link", { name: second.quotation.reference })).toBeVisible();

    // The withdrawn quotation can be read, but not answered, and it says where to go.
    await earlier.getByRole("link", { name: first.quotation.reference }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Quotation ${first.quotation.reference}` }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(pageBadge(page)).toHaveAttribute("data-status", "VOID");
    await expect(portalBanner(page)).toContainText("This quotation was withdrawn");
    await expect(acceptButton(page)).toHaveCount(0);
    await expect(declineButton(page)).toHaveCount(0);
    await expect(quotationDocument(page)).toContainText("$255.64");
    // Nothing of the business's own reason for withdrawing it reaches the customer.
    await expect(page.locator("main")).not.toContainText("Replaced by a newer quotation.");

    await portalBanner(page)
      .getByRole("link", { name: `Review ${second.quotation.reference}` })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Quotation ${second.quotation.reference}` }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(pageBadge(page)).toHaveAttribute("data-status", "SENT");
    await expect(decisionBar(page)).toBeVisible();
  });

  test("the request page offers the quotation to review, and the link opens it", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request, quotation } = await customerWithQuotation("Rey Review");
    await loginAs(page, customer);

    await openPortalRequest(page, request);
    const card = page.getByRole("region", { name: "Quotation", exact: true });
    await expect(card.getByTestId("current-quotation")).toContainText(quotation.reference);
    await expect(card.getByTestId("current-quotation")).toContainText("$255.64");
    await expect(card.getByTestId("current-quotation")).toContainText("5 days left");
    await expect(card.getByRole("heading", { name: "Earlier versions" })).toHaveCount(0);
    await card.getByRole("link", { name: /Review quotation/ }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: `Quotation ${quotation.reference}` }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(decisionBar(page)).toBeVisible();
  });
});

test.describe("a quotation with little time left", () => {
  test("nudges on the last day, and still accepts", async ({ page }) => {
    await useViewport(page, 1440);
    const customer = await createCustomerAccount({ name: "Last Day Lee" });
    const { quotation } = await createSentQuotationFor(customer.id, { validUntil: businessDay(0) });
    await loginAs(page, customer);

    await openAwaitingQuotation(page, quotation);

    await expect(portalBanner(page)).toContainText("last day to answer");
    await expect(portalBanner(page)).toHaveAttribute("data-tone", "attention");
    await acceptThroughDialog(page, quotation.reference);
    await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED", {
      timeout: NAVIGATION_TIMEOUT,
    });
  });
});

test.describe("printing", () => {
  for (const [name, width, height] of [
    ["A4", 794, 1123],
    ["Letter", 816, 1056],
  ] as const) {
    test(`a printed quotation is the document alone, with every total in view on ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const { customer, quotation } = await customerWithQuotation("Pat Printer");
      await loginAs(page, customer);
      await openAwaitingQuotation(page, quotation);

      await page.emulateMedia({ media: "print" });

      await expect(quotationDocument(page)).toBeVisible();
      await expect(page.getByRole("banner")).toBeHidden();
      await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
      await expect(portalBanner(page)).toBeHidden();
      await expect(decisionBar(page)).toBeHidden();
      await expect(page.getByRole("button", { name: /Print/ })).toBeHidden();
      await expect(page.getByRole("link", { name: /Requests/ })).toBeHidden();
      // The document's own header and totals are all there, on white, none clipped by the page.
      await expect(quotationDocument(page)).toContainText(quotation.reference);
      await expect(quotationDocument(page)).toContainText("Valid until");
      await expectNoHorizontalOverflow(page);
      for (const total of ["$252.00", "$3.64", "$255.64"]) {
        const box = await quotationDocument(page).getByText(total, { exact: true }).boundingBox();
        expect(box, `${total} on ${name}`).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0), `${total} fits on ${name}`).toBeLessThanOrEqual(
          width,
        );
      }
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe("rgb(255, 255, 255)");
    });
  }

  test("the page's Print button prints (it opens the browser's print dialog)", async ({ page }) => {
    await useViewport(page, 1440);
    const { customer, quotation } = await customerWithQuotation("Pia Print");
    await loginAs(page, customer);
    await openPortalQuotation(page, quotation);
    await page.evaluate(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed += 1;
      };
    });

    await page.getByRole("button", { name: "Print quotation" }).click();

    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  });
});

test.describe("the bar that holds the decision", () => {
  test("sticks to the foot of a phone's screen, and is an ordinary card on a desktop", async ({
    page,
  }) => {
    const { customer, quotation } = await customerWithQuotation("Stick Sterling");
    await loginAs(page, customer);

    await useViewport(page, 360);
    await openAwaitingQuotation(page, quotation);
    const phone = await decisionBar(page).boundingBox();
    // The page is far taller than the screen, yet the bar is pinned to the bottom of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(900);
    expect((phone?.y ?? 0) + (phone?.height ?? 0)).toBeGreaterThan(890);
    expect((phone?.y ?? 0) + (phone?.height ?? 0)).toBeLessThanOrEqual(900);
    expect(phone?.width ?? 0).toBeGreaterThanOrEqual(359);
    // Both buttons fit side by side, with room to tap.
    const accept = await acceptButton(page).boundingBox();
    const decline = await declineButton(page).boundingBox();
    expect(accept?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect((accept?.x ?? 0) + (accept?.width ?? 0)).toBeLessThan(decline?.x ?? 0);
    expect((decline?.x ?? 0) + (decline?.width ?? 0)).toBeLessThanOrEqual(360);

    await useViewport(page, 1440);
    await expect
      .poll(() => decisionBar(page).evaluate((element) => getComputedStyle(element).position))
      .toBe("static");
  });
});

test.describe("on every screen size", () => {
  for (const width of WIDTHS) {
    test(`the overview, the quotation, both dialogs and each outcome fit at ${width} px, and are axe-clean`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const customer = await createCustomerAccount({
        name: "Bartholomew Montgomery-Featherstonehaugh",
      });
      const open = await createSentQuotationFor(customer.id, {
        validUntil: businessDay(1),
        customerNote: "y".repeat(120),
      });
      const expired = await createSentQuotationFor(customer.id, { validUntil: businessDay(-3) });
      const withdrawn = await createSentQuotationFor(customer.id, { status: "VOID" });
      await loginAs(page, customer);

      // The overview, with a quotation waiting.
      await page.goto("/portal");
      await expect(awaitingDecision(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the overview").toBe("");

      // The request page with its quotation card.
      await openPortalRequest(page, open.request);
      await expect(page.getByTestId("current-quotation")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the request").toBe("");

      // The quotation awaiting an answer, with a long customer name and a long note.
      await openAwaitingQuotation(page, open.quotation);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the quotation").toBe("");
      // The bar's buttons are big enough to touch and inside the screen.
      for (const button of [acceptButton(page), declineButton(page)]) {
        const box = await button.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }

      // Both dialogs fit the screen and are clean (scanned on their own: Radix hides the rest).
      await acceptButton(page).click();
      const acceptDialog = page.getByRole("alertdialog", {
        name: `Accept ${open.quotation.reference}?`,
      });
      await expect(acceptDialog).toBeVisible();
      const acceptBox = await acceptDialog.boundingBox();
      expect(acceptBox?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect((acceptBox?.x ?? 0) + (acceptBox?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        "serious axe violations in the accept dialog",
      ).toBe("");
      await acceptDialog.getByRole("button", { name: "Go back" }).click();
      await expect(acceptDialog).toBeHidden();
      await expect(acceptButton(page)).toBeFocused();

      await declineButton(page).click();
      const declineDialog = page.getByRole("alertdialog", {
        name: `Decline ${open.quotation.reference}?`,
      });
      await expect(declineDialog).toBeVisible();
      await declineDialog.getByLabel(/why are you declining/).fill("z".repeat(300));
      const declineBox = await declineDialog.boundingBox();
      expect((declineBox?.x ?? 0) + (declineBox?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        "serious axe violations in the decline dialog",
      ).toBe("");
      await declineDialog.getByRole("button", { name: "Go back" }).click();
      await expect(declineDialog).toBeHidden();

      // The confirmation after an answer, and the page as it then reads.
      await acceptThroughDialog(page, open.quotation.reference);
      await expect(pageBadge(page)).toHaveAttribute("data-status", "ACCEPTED", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await page.mouse.move(1, 1);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations after accepting").toBe("");
      await page.reload();
      await expect(portalBanner(page)).toContainText("You accepted this quotation");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the accepted page").toBe("");

      // An expired and a withdrawn quotation: a banner, a document, and no way to answer.
      await openPortalQuotation(page, expired.quotation);
      await expect(portalBanner(page)).toContainText("This quotation has expired");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the expired page").toBe("");
      await openPortalQuotation(page, withdrawn.quotation);
      await expect(portalBanner(page)).toContainText("This quotation was withdrawn");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the withdrawn page").toBe(
        "",
      );
    });
  }
});

test.describe("keyboard", () => {
  test("a customer can accept using only the keyboard, and lands on the confirmation", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, quotation } = await customerWithQuotation("Kay Keyboard");
    await loginAs(page, customer);
    await openAwaitingQuotation(page, quotation);

    await acceptButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog", {
      name: `Accept ${quotation.reference}?`,
    });
    await expect(dialog).toBeVisible();
    // Focus is inside the dialog, starts on the safe choice, and Escape backs out.
    await expect(dialog.getByRole("button", { name: "Go back" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(acceptButton(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Accept quotation", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(confirmation(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(confirmation(page)).toBeFocused();
  });
});
