import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createCompletedJobWithQuote, insertInvoiceFor } from "../fixtures/invoices.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T20 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the invoice list, the Ready to invoice tab, the draft
 * editor and its dialogs, an issued invoice, an overdue one and a voided one, and the issued document
 * as it prints. They are written to the git-ignored artifacts folder; the tests fail only if a page
 * does not render.
 */

test.describe.configure({ timeout: 240_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t20");

async function shoot(page: Page, width: number | string, name: string): Promise<void> {
  // Toasts slide in from the edge; wait for them to go so the picture shows the page.
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

async function openInvoice(page: Page, id: string, heading: string | RegExp) {
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

for (const width of [360, 1440] as const) {
  test(`pictures of the invoice screens at ${String(width)} px`, async ({ page }) => {
    await useViewport(page, width);
    const customer = await createCustomerAccount({ name: `Amara Okafor Invoice ${String(width)}` });
    const make = () => createCompletedJobWithQuote(customer.id);
    const ready = await make();
    const draftJob = await make();
    const issuedJob = await make();
    const overdueJob = await make();
    const voidJob = await make();
    const draft = await insertInvoiceFor(draftJob, customer.id, { status: "DRAFT" });
    const issued = await insertInvoiceFor(issuedJob, customer.id, {
      status: "ISSUED",
      issueDate: "2026-11-02",
      dueDate: "2999-01-01",
      note: "Thank you for choosing us. The unit has a 30-day workmanship guarantee.",
    });
    const overdue = await insertInvoiceFor(overdueJob, customer.id, {
      status: "ISSUED",
      issueDate: "2026-01-05",
      dueDate: "2026-01-19",
    });
    const voided = await insertInvoiceFor(voidJob, customer.id, {
      status: "VOID",
      voidReason: "Raised for the wrong visit: the parts were billed on the earlier job.",
    });
    await loginAs(page, "admin");

    await page.goto(`/app/invoices?q=${encodeURIComponent(customer.name)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(
      page
        .getByText(issued.invoiceNumber ?? "")
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await shoot(page, width, "list");

    await page.goto("/app/invoices?q=no-invoice-has-this-text-zzz");
    await expect(page.getByRole("heading", { name: "No invoices match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(page, width, "list-no-match");

    await page.goto(`/app/jobs?view=ready-to-invoice&q=${ready.jobReference}`);
    await expect(
      page.getByRole("button", { name: `Create invoice for ${ready.jobReference}` }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await shoot(page, width, "ready-to-invoice");

    await openInvoice(page, draft.id, "Draft invoice");
    await expectHydrated(page.getByRole("button", { name: "Add line" }));
    await shoot(page, width, "draft");
    await page.getByRole("button", { name: "Issue invoice…" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shoot(page, width, "draft-issue-dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Draft: not issued yet")).toBeVisible({
      timeout: 20_000,
    });
    await shoot(page, width, "draft-preview");
    await page.keyboard.press("Escape");

    await openInvoice(page, issued.id, issued.invoiceNumber ?? "");
    await expect(page.getByTestId("invoice-document")).toBeVisible();
    await shoot(page, width, "issued");
    await page.getByRole("button", { name: "Void invoice…" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shoot(page, width, "issued-void-dialog");
    await page.keyboard.press("Escape");

    await openInvoice(page, overdue.id, overdue.invoiceNumber ?? "");
    await expect(page.getByTestId("invoice-banner")).toContainText(/Overdue by/);
    await shoot(page, width, "overdue");

    await openInvoice(page, voided.id, voided.invoiceNumber ?? "");
    await expect(page.getByTestId("invoice-void-mark")).toBeVisible();
    await shoot(page, width, "void");

    // The issued document as it prints on A4: the frame gone, the document alone.
    await openInvoice(page, issued.id, issued.invoiceNumber ?? "");
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("invoice-document")).toBeVisible();
    await shoot(page, `${String(width)}/print-a4`, "issued");
  });
}
