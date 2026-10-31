import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { quotationsOf } from "../fixtures/quotations.js";
import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  banner,
  button,
  createDraft,
  customerWithRequest,
  fillWorkedExample,
  line,
  openQuotation,
  openRequest,
  quotationDocument,
  saveDraft,
  sendThroughDialog,
  sendWorkedExample,
} from "./helpers/quotations.js";

/**
 * Screenshots of the T14 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the draft editor (empty, filled, with an error on a
 * row), the preview, the send confirmation, the sent quotation, a replaced one with its chain, the
 * request with its quotations, and the printed document. They are written to the git-ignored
 * artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 180_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t14");

async function shoot(page: Page, width: number, name: string): Promise<void> {
  // Toasts slide in from the edge; wait for them to go so the picture shows the page.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

for (const width of [360, 1440]) {
  test.describe(`at ${width} px`, () => {
    test("the editor: new draft, filled in, and with an error on a row", async ({ page }) => {
      await useViewport(page, width);
      const { request } = await customerWithRequest("Daniela Brooks");
      await loginAs(page, "admin");

      await createDraft(page, request);
      await shoot(page, width, "editor-new");

      await fillWorkedExample(page, "25.20");
      await page
        .getByLabel("Note for the customer")
        .fill("The price assumes the part is in stock.");
      await shoot(page, width, "editor-filled-unsaved");

      await saveDraft(page);
      await shoot(page, width, "editor-saved");

      await line(page, 2).getByLabel("Quantity").fill("0");
      await button(page, "Save draft").click();
      await expect(line(page, 2)).toContainText("Enter a quantity");
      await shoot(page, width, "editor-row-error");
    });

    test("the preview, the send confirmation, and the sent quotation", async ({ page }) => {
      await useViewport(page, width);
      const { request } = await customerWithRequest("Daniela Brooks");
      await loginAs(page, "admin");
      await createDraft(page, request);
      await fillWorkedExample(page, "25.20");
      await page
        .getByLabel("Note for the customer")
        .fill("The price assumes the part is in stock.");
      await saveDraft(page);

      await button(page, "Preview").click();
      const preview = page.getByRole("dialog", { name: "Preview for the customer" });
      await expect(preview.getByTestId("quotation-document")).toBeVisible();
      await expect(preview.getByText("$230.08")).toBeVisible();
      await shoot(page, width, "preview");
      await page.keyboard.press("Escape");

      await button(page, "Send to customer…").click();
      await expect(page.getByRole("alertdialog", { name: /^Send QT-/ })).toBeVisible();
      await shoot(page, width, "send-confirmation");
      await page.getByRole("button", { name: "Not yet" }).click();

      await sendThroughDialog(page);
      await shoot(page, width, "sent");
    });

    test("a replaced quotation with its chain, the request with its versions, and the void dialog", async ({
      page,
    }) => {
      await useViewport(page, width);
      const { request } = await customerWithRequest("Daniela Brooks");
      await loginAs(page, "admin");
      const original = await sendWorkedExample(page, request, "25.20");

      await button(page, "Replace with a new draft").click();
      await expect(page.getByRole("form", { name: "Quotation draft" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await line(page, 3).getByLabel("Quantity").fill("2");
      await page.getByLabel("Tax rate (%)").fill("8.00");
      await saveDraft(page);
      await sendThroughDialog(page);
      await shoot(page, width, "replacement-sent");

      await openQuotation(page, original.id);
      await expect(banner(page)).toContainText("Replaced by");
      await shoot(page, width, "replaced-void");

      await openRequest(page, request);
      await expect(page.getByRole("heading", { name: "Quotations", level: 2 })).toBeVisible();
      await shoot(page, width, "request-with-versions");

      const [current] = await quotationsOf(request.id);
      await openQuotation(page, current?.id ?? "");
      await button(page, "More actions").click();
      await page.getByRole("menuitem", { name: "Void quotation" }).click();
      const dialog = page.getByRole("alertdialog", { name: /^Void QT-/ });
      await dialog.getByLabel(/Reason \(internal\)/).fill("Priced the wrong unit.");
      await expect(dialog).toBeVisible();
      await shoot(page, width, "void-dialog");
    });
  });
}

test("the printed quotation", async ({ page }) => {
  await useViewport(page, 1440);
  const { request } = await customerWithRequest("Daniela Brooks");
  await loginAs(page, "admin");
  await sendWorkedExample(page, request, "25.20");

  await page.emulateMedia({ media: "print" });
  await expect(quotationDocument(page)).toBeVisible();
  const dir = resolve(SCREENSHOT_DIR, "print");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, "printed.png"), fullPage: true });
});
