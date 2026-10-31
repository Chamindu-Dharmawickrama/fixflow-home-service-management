import { expect, test } from "@playwright/test";

import {
  businessDay,
  notificationsFor,
  quotationLinesOf,
  quotationsOf,
  setValidUntil,
} from "../fixtures/quotations.js";
import { readRequestState } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";
import {
  banner,
  button,
  createDraft,
  customerWithRequest,
  fillLine,
  fillWorkedExample,
  headerBadge,
  INTERNAL_REASON,
  line,
  LINES,
  openQuotation,
  openRequest,
  QUOTATION_PATH,
  quotationDocument,
  referenceOnPage,
  saveDraft,
  sendWorkedExample,
  toast,
  voidThroughDialog,
} from "./helpers/quotations.js";

/**
 * The states of the quotation builder (T14): errors beside the row that has them, the warning before
 * unsaved changes are lost, voiding, expiry as the days pass, what a customer can and cannot reach,
 * printing, and every screen at the four required widths, axe-clean.
 */

test.describe.configure({ timeout: 150_000 });

test.describe("errors, warnings and refusals", () => {
  test("a bad quantity is shown beside its row, with a link from the list of problems, and nothing is saved", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);
    const [draft] = await quotationsOf(request.id);

    await fillLine(page, 1, LINES[0]);
    await button(page, "Add line").click();
    await fillLine(page, 2, LINES[1]);
    await line(page, 2).getByLabel("Quantity").fill("0");
    await button(page, "Save draft").click();

    const quantity = line(page, 2).getByLabel("Quantity");
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    await expect(line(page, 2)).toContainText("Enter a quantity from 0.01 to 9,999.99.");
    await expect(line(page, 1).getByLabel("Quantity")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("link", { name: /Line 2 quantity/ })).toBeVisible();
    // What was typed stays, and nothing was saved or announced as saved.
    await expect(quantity).toHaveValue("0");
    await expect(line(page, 2).getByLabel("Description")).toHaveValue("Run capacitor");
    expect(await quotationLinesOf(draft?.id ?? "")).toHaveLength(1);
    await expect(toast(page, "Draft saved")).toHaveCount(0);

    // Fixing it lets the save through.
    await quantity.fill("2");
    await saveDraft(page);
    expect(await quotationLinesOf(draft?.id ?? "")).toHaveLength(2);
  });

  test("the whole list of problems is reported together, each beside its field", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);

    await line(page, 1).getByLabel("Description").fill("");
    await line(page, 1)
      .getByLabel(/^Unit price/)
      .fill("abc");
    await page.getByLabel(/^Discount/).fill("-5");
    await page.getByLabel("Tax rate (%)").fill("101");
    await page.getByLabel(/^Valid until/).fill("");
    await button(page, "Save draft").click();

    for (const problem of [
      "Line 1 description",
      "Line 1 unit price",
      "Discount",
      "Tax rate",
      "Valid until",
    ]) {
      await expect(page.getByRole("link", { name: problem })).toBeVisible();
    }
    await expect(page.getByLabel(/^Discount/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Tax rate (%)")).toHaveAttribute("aria-invalid", "true");
  });

  test("a draft with no price cannot be sent, and says why", async ({ page }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest("Quinn Quotable", {
      serviceName: "AC Diagnostic Visit",
    });
    await loginAs(page, "admin");
    await createDraft(page, request);

    // The starter line of a quote-required service costs nothing.
    await expect(button(page, "Send to customer…")).toBeDisabled();
    await expect(
      page.getByText(/a quotation needs a total above zero before it is sent/),
    ).toBeVisible();
    await expect(button(page, "Preview")).toBeEnabled();
  });

  test("leaving with unsaved changes asks first, and Keep editing keeps them", async ({ page }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);

    await page.getByLabel("Note for the customer").fill("A note I have not saved yet.");
    await page.getByRole("link", { name: request.reference }).first().click();

    const dialog = page.getByRole("alertdialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(QUOTATION_PATH);
    await expect(page.getByLabel("Note for the customer")).toHaveValue(
      "A note I have not saved yet.",
    );

    await page.getByRole("link", { name: request.reference }).first().click();
    await page
      .getByRole("alertdialog", { name: "Leave without saving?" })
      .getByRole("button", { name: "Leave without saving" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    expect((await quotationsOf(request.id))[0]?.customerNote).toBeNull();
  });

  test("a draft changed in another tab is not overwritten: the edits stay and the latest can be loaded", async ({
    browser,
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);
    const url = page.url();

    // A colleague (the same admin in another tab) saves a note first.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await useViewport(otherPage, 1440);
    await loginAs(otherPage, "admin");
    await otherPage.goto(url);
    await expectHydrated(otherPage.getByRole("form", { name: "Quotation draft" }));
    await expectHydrated(otherPage.getByLabel("Note for the customer"));
    await otherPage.getByLabel("Note for the customer").fill("Written in the other tab.");
    await saveDraft(otherPage);
    await other.close();

    await page.getByLabel("Note for the customer").fill("Written in this tab.");
    await button(page, "Save draft").click();

    await expect(
      page.getByRole("alert").filter({ hasText: "changed somewhere else" }),
    ).toBeVisible();
    await expect(page.getByLabel("Note for the customer")).toHaveValue("Written in this tab.");
    expect((await quotationsOf(request.id))[0]?.customerNote).toBe("Written in the other tab.");

    await button(page, "Load the latest version").click();
    await expect(page.getByLabel("Note for the customer")).toHaveValue("Written in the other tab.");
    await expect(page.getByText("All changes are saved.")).toBeVisible();
  });

  test("a quotation sent in another tab is refused when the stale editor tries to send it again", async ({
    browser,
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);
    await fillWorkedExample(page);
    await saveDraft(page);
    const url = page.url();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await useViewport(otherPage, 1440);
    await loginAs(otherPage, "admin");
    await otherPage.goto(url);
    await expectHydrated(otherPage.getByRole("form", { name: "Quotation draft" }));
    await button(otherPage, "Send to customer…").click();
    await otherPage
      .getByRole("alertdialog", { name: /^Send QT-/ })
      .getByRole("button", { name: "Send to customer", exact: true })
      .click();
    await expect(banner(otherPage)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await other.close();

    await button(page, "Send to customer…").click();
    const dialog = page.getByRole("alertdialog", { name: /^Send QT-/ });
    await dialog.getByRole("button", { name: "Send to customer", exact: true }).click();

    // Refused, and the page reloads into what is true: sent once, one notification.
    await expect(banner(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    expect((await quotationsOf(request.id)).filter((row) => row.status === "SENT")).toHaveLength(1);
    expect(await notificationsFor(customer.id, "QUOTATION_SENT")).toHaveLength(1);
  });
});

test.describe("voiding", () => {
  test("voiding a draft keeps it with the reason, tells the customer nothing, and lets a new one start", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);
    const reference = await referenceOnPage(page);

    await button(page, "More actions").click();
    await page.getByRole("menuitem", { name: "Void quotation" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Void ${reference}?` });
    await expect(dialog).toContainText("never saw it, so they are not told");
    // The reason is required.
    await expect(
      dialog.getByRole("button", { name: "Void quotation", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel(/Reason \(internal\)/).fill("Starting again with the right unit.");
    await dialog.getByRole("button", { name: "Void quotation", exact: true }).click();

    // Back on the request, which can be quoted again.
    await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(button(page, "Create quotation")).toBeVisible();
    const [voided] = await quotationsOf(request.id);
    expect(voided).toMatchObject({
      status: "VOID",
      voidReason: "Starting again with the right unit.",
    });
    expect(voided?.voidedAt).not.toBeNull();
    expect(await notificationsFor(customer.id, "QUOTATION_WITHDRAWN")).toHaveLength(0);
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");

    // The voided draft is still there to open.
    await page
      .getByRole("table", { name: "Quotations for this request" })
      .getByRole("link", { name: new RegExp(reference) })
      .click();
    await expect(banner(page)).toContainText("Starting again with the right unit.");
  });

  test("voiding a sent quotation tells the customer in the business's words, never with the internal reason, and reopens the review", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    const sent = await sendWorkedExample(page, request);

    await voidThroughDialog(page, {
      reason: INTERNAL_REASON,
      message: "We priced the wrong unit. A corrected quotation will follow.",
    });

    await expect(headerBadge(page)).toHaveAttribute("data-status", "VOID", {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(banner(page)).toContainText(`Voided`);
    await expect(banner(page)).toContainText(INTERNAL_REASON);
    await expect(banner(page)).toContainText("only your team sees it");
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");
    expect((await quotationsOf(request.id))[0]).toMatchObject({
      id: sent.id,
      status: "VOID",
      voidReason: INTERNAL_REASON,
    });

    const notices = await notificationsFor(customer.id, "QUOTATION_WITHDRAWN");
    expect(notices).toEqual([
      expect.objectContaining({
        message: "We priced the wrong unit. A corrected quotation will follow.",
        linkPath: `/portal/requests/${request.id}`,
      }),
    ]);
    expect(JSON.stringify(notices)).not.toContain("internal margin");

    // The request can be quoted afresh.
    await openRequest(page, request);
    await expect(button(page, "Create quotation")).toBeVisible();
    await expect(headerBadge(page)).toHaveAttribute("data-status", "UNDER_REVIEW");
  });

  test("the void dialog says a sent quotation's customer is told, and a double click voids once", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    await sendWorkedExample(page, request);

    await button(page, "More actions").click();
    await page.getByRole("menuitem", { name: "Void quotation" }).click();
    const dialog = page.getByRole("alertdialog", { name: /^Void QT-/ });
    await expect(dialog).toContainText("is told it was withdrawn");
    await dialog.getByLabel(/Reason \(internal\)/).fill(INTERNAL_REASON);
    await dialog.getByRole("button", { name: "Void quotation", exact: true }).dblclick();

    await expect(headerBadge(page)).toHaveAttribute("data-status", "VOID", {
      timeout: NAVIGATION_TIMEOUT,
    });
    expect(await notificationsFor(customer.id, "QUOTATION_WITHDRAWN")).toHaveLength(1);
  });
});

test.describe("time passing", () => {
  test("a sent quotation past its last day reads Expired, and the request is back under review", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    const sent = await sendWorkedExample(page, request);
    expect((await readRequestState(request.id)).status).toBe("QUOTED");

    // The last day was two days ago in the business's time zone.
    await setValidUntil(sent.id, businessDay(-2));
    await openQuotation(page, sent.id);

    await expect(headerBadge(page)).toHaveAttribute("data-status", "EXPIRED");
    await expect(banner(page)).toContainText("Expired");
    await expect(button(page, "Replace with a new draft")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Quotation history" })).toContainText(
      "marked quotation",
    );
    expect((await quotationsOf(request.id))[0]?.status).toBe("EXPIRED");
    expect((await readRequestState(request.id)).status).toBe("UNDER_REVIEW");

    // The request page agrees, and offers a new quotation.
    await openRequest(page, request);
    await expect(headerBadge(page)).toHaveAttribute("data-status", "UNDER_REVIEW");
    await expect(button(page, "Create quotation")).toBeVisible();
    // Nobody was notified by the passing of time.
    expect(await notificationsFor(customer.id, "QUOTATION_WITHDRAWN")).toHaveLength(0);
  });

  test("a quotation valid until today is still sent", async ({ page }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    const sent = await sendWorkedExample(page, request);

    await setValidUntil(sent.id, businessDay(0));
    await openQuotation(page, sent.id);

    await expect(headerBadge(page)).toHaveAttribute("data-status", "SENT");
    expect((await readRequestState(request.id)).status).toBe("QUOTED");
  });
});

test.describe("who can reach what", () => {
  test("a customer cannot read a draft, cannot reach the admin endpoints, and sees a sent quotation only as theirs", async ({
    browser,
    page,
  }) => {
    await useViewport(page, 1440);
    const { customer, request } = await customerWithRequest();
    await loginAs(page, "admin");
    await createDraft(page, request);
    const [draft] = await quotationsOf(request.id);
    const draftId = draft?.id ?? "";

    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    await loginAs(customerPage, { email: customer.email, password: customer.password });

    // A draft does not exist for the customer, and the admin endpoints are closed to them.
    expect((await customerPage.request.get(`/api/v1/quotations/${draftId}`)).status()).toBe(404);
    expect((await customerPage.request.get(`/api/v1/admin/quotations/${draftId}`)).status()).toBe(
      403,
    );
    expect(
      (
        await customerPage.request.post(`/api/v1/admin/requests/${request.id}/quotations`, {
          data: {},
          headers: { Origin: new URL(customerPage.url()).origin },
        })
      ).status(),
    ).toBe(403);

    // The admin pages turn the customer away.
    await customerPage.goto(`/app/quotations/${draftId}`);
    await expect(
      customerPage.getByRole("heading", { level: 1, name: "This area is for the business team" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    // Once sent, it is the owner's alone.
    await fillWorkedExample(page);
    await saveDraft(page);
    await page.getByRole("button", { name: "Send to customer…" }).click();
    await page
      .getByRole("alertdialog", { name: /^Send QT-/ })
      .getByRole("button", { name: "Send to customer", exact: true })
      .click();
    await expect(banner(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    const owned = await customerPage.request.get(`/api/v1/quotations/${draftId}`);
    expect(owned.status()).toBe(200);
    const body = JSON.stringify(await owned.json());
    expect(body).not.toContain("Morgan Reyes");
    expect(body).not.toContain("voidReason");

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await loginAs(strangerPage, "customer-b");
    expect((await strangerPage.request.get(`/api/v1/quotations/${draftId}`)).status()).toBe(404);
    await stranger.close();
    await customerContext.close();
  });
});

test.describe("printing", () => {
  test("a printed quotation is the document alone: no sidebar, no top bar, no buttons, no side cards", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const { request } = await customerWithRequest();
    await loginAs(page, "admin");
    await sendWorkedExample(page, request);

    await page.emulateMedia({ media: "print" });

    await expect(quotationDocument(page)).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.locator("body > div header").first()).toBeHidden();
    await expect(button(page, "Print")).toBeHidden();
    await expect(page.getByRole("heading", { name: "History" })).toBeHidden();
    await expect(banner(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: /^Quotation QT-/, level: 1 })).toBeHidden();
    await expect(quotationDocument(page)).toContainText("$252.00");
  });
});

test.describe("on every screen size", () => {
  for (const width of WIDTHS) {
    test(`the editor, the preview and the read-only view fit at ${width} px, and are axe-clean`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const { request } = await customerWithRequest("Bartholomew Montgomery-Featherstonehaugh");
      await loginAs(page, "admin");

      await openRequest(page, request);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the request").toBe("");

      await button(page, "Create quotation").click();
      await expect(page).toHaveURL(QUOTATION_PATH, { timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(page.getByRole("form", { name: "Quotation draft" }));
      await expectHydrated(page.getByLabel("Note for the customer"));

      // Three rows, a very long description, and a long note: the page never scrolls sideways.
      await fillWorkedExample(page, "25.20");
      await line(page, 1)
        .getByLabel("Description")
        .fill("Diagnostic visit and a very long unbroken description ".repeat(2) + "x".repeat(60));
      await page.getByLabel("Note for the customer").fill("y".repeat(120));
      await expectNoHorizontalOverflow(page);

      // Each row is a card with visible labels until the editor is wide enough for a table under a
      // header (the editor is about 760 px wide at 1440 px, and narrower at the other sizes).
      const label = line(page, 1).getByText("Quantity", { exact: true }).first();
      const priceLabel = line(page, 1)
        .getByText(/^Unit price/)
        .first();
      const labelBox = await label.boundingBox();
      const priceLabelBox = await priceLabel.boundingBox();
      if (width < 1440) {
        expect(labelBox?.width ?? 0, "visible label in a card").toBeGreaterThan(30);
        expect(priceLabelBox?.width ?? 0, "visible price label in a card").toBeGreaterThan(30);
      } else {
        expect(labelBox?.width ?? 0, "label hidden under a table header").toBeLessThan(5);
        expect(priceLabelBox?.width ?? 0, "price label hidden under a table header").toBeLessThan(
          5,
        );
      }

      expect(await seriousViolations(page), "serious axe violations in the editor").toBe("");

      // With an error on a row, the page is still clean and still fits.
      await line(page, 2).getByLabel("Quantity").fill("0");
      await button(page, "Save draft").click();
      await expect(line(page, 2)).toContainText("Enter a quantity");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations with an error").toBe("");
      await line(page, 2).getByLabel("Quantity").fill("1");
      await line(page, 1).getByLabel("Description").fill("Diagnostic visit");
      await saveDraft(page);

      // The preview dialog fits and is clean (scanned on its own: Radix hides the rest of the page).
      await button(page, "Preview").click();
      const preview = page.getByRole("dialog", { name: "Preview for the customer" });
      await expect(preview.getByTestId("quotation-document")).toBeVisible();
      const box = await preview.boundingBox();
      expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        "serious axe violations in the preview",
      ).toBe("");
      await page.keyboard.press("Escape");
      await expect(preview).toBeHidden();

      // The send confirmation fits, then the sent, read-only view.
      await button(page, "Send to customer…").click();
      const confirmation = page.getByRole("alertdialog", { name: /^Send QT-/ });
      const confirmBox = await confirmation.boundingBox();
      expect((confirmBox?.x ?? 0) + (confirmBox?.width ?? 0)).toBeLessThanOrEqual(width);
      await confirmation.getByRole("button", { name: "Send to customer", exact: true }).click();
      await expect(banner(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await page.mouse.move(1, 1);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the sent view").toBe("");

      // The request page lists it, still without sideways scroll.
      await openRequest(page, request);
      await expect(page.getByRole("heading", { name: "Quotations", level: 2 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), "serious axe violations on the request").toBe("");
    });
  }
});
