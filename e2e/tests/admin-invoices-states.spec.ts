import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createCompletedJobWithQuote,
  insertInvoiceFor,
  invoicesOfJob,
} from "../fixtures/invoices.js";
import { newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectInsideScreen,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The states of the invoice screens (T20): the list, the draft editor and the issued document in every
 * status, with their dialogs, at the four required widths, with ordinary content and with text as long
 * as the rules allow (an unbroken word included). Each is axe-clean, nothing scrolls sideways, and
 * every dialog stays inside the screen. The issued document is also printed on A4 and Letter paper,
 * where the application's frame disappears and the document fits the page. Each test makes the
 * customers it needs (the tests run in parallel on one database).
 */

test.describe.configure({ timeout: 240_000 });

/** A word with no space to break at, the way a pasted link or a long part number reads. */
const UNBROKEN = "L".repeat(120);
const LONG_NOTE = `${UNBROKEN}\n\nThank you for your patience. ${"The unit now cools to 68 degrees. ".repeat(20)}`;

/** One customer with a completed job and an invoice in every interesting state. */
async function world() {
  const tag = newTechnicianTag();
  const customer = await createCustomerAccount({ name: `Wanda Invoice ${tag}` });

  const jobFor = () => createCompletedJobWithQuote(customer.id);
  const readyJob = await jobFor();
  const draftJob = await jobFor();
  const issuedJob = await jobFor();
  const overdueJob = await jobFor();
  const voidJob = await jobFor();
  const draft = await insertInvoiceFor(draftJob, customer.id, {
    status: "DRAFT",
    note: LONG_NOTE.slice(0, 2000),
  });
  const issued = await insertInvoiceFor(issuedJob, customer.id, {
    status: "ISSUED",
    issueDate: "2026-11-02",
    dueDate: "2999-01-01",
    note: LONG_NOTE.slice(0, 2000),
  });
  const overdue = await insertInvoiceFor(overdueJob, customer.id, {
    status: "ISSUED",
    issueDate: "2026-01-05",
    dueDate: "2026-01-19",
  });
  const voided = await insertInvoiceFor(voidJob, customer.id, {
    status: "VOID",
    voidReason: `${UNBROKEN} ${"Raised for the wrong visit. ".repeat(10)}`,
  });
  return { tag, customer, readyJob, draftJob, draft, issued, overdue, voided };
}

async function expectPageFits(page: Page, label: string, width: number) {
  await expectNoHorizontalOverflow(page);
  expect(await seriousViolations(page), `${label} at ${String(width)} px`).toBe("");
}

async function openInvoice(page: Page, id: string, heading: string | RegExp) {
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

test.describe("the admin's invoice screens at the four widths", () => {
  for (const width of WIDTHS) {
    test(`work at ${String(width)} px: the list, the Ready to invoice tab, the draft, an issued, an overdue and a void invoice, and the dialogs`, async ({
      page,
    }) => {
      const w = await world();
      await useViewport(page, width);
      await loginAs(page, "admin");

      // ---- The list, with one invoice of each kind ------------------------------------------------
      await page.goto(`/app/invoices?q=${encodeURIComponent(w.customer.name)}`);
      await expect(
        page.getByRole(width >= 1024 ? "table" : "list", { name: "Invoices" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      // Below 1024 px the table is replaced by cards: only the one a person sees counts.
      await expect(
        page
          .getByText(w.issued.invoiceNumber ?? "")
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByText(/Overdue by \d+ days?/)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expectPageFits(page, "the invoice list", width);

      // ---- An empty result, and a page that does not exist ----------------------------------------
      await page.goto("/app/invoices?q=no-invoice-has-this-text-zzz");
      await expect(page.getByRole("heading", { name: "No invoices match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "an empty invoice list", width);
      await page.goto("/app/invoices/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { name: "We couldn't find that invoice" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "a missing invoice", width);

      // ---- The Ready to invoice tab, with a button in each row ------------------------------------
      await page.goto(`/app/jobs?view=ready-to-invoice&q=${w.readyJob.jobReference}`);
      await expect(
        page.getByRole("button", { name: `Create invoice for ${w.readyJob.jobReference}` }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectPageFits(page, "the Ready to invoice tab", width);

      // ---- The draft editor, with a note as long as it may be -------------------------------------
      await openInvoice(page, w.draft.id, "Draft invoice");
      await expectHydrated(page.getByRole("button", { name: "Add line" }));
      await expectPageFits(page, "the draft editor", width);

      const issue = page.getByRole("button", { name: "Issue invoice…" });
      await issue.click();
      const issueDialog = page.getByRole("alertdialog", {
        name: `Issue the invoice to ${w.customer.name}?`,
      });
      await expect(issueDialog).toBeVisible();
      await expectInsideScreen(page, issueDialog, "the Issue invoice dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        `the Issue invoice dialog at ${String(width)} px`,
      ).toBe("");
      await closeDialog(page);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Void invoice" }).click();
      const draftVoid = page.getByRole("alertdialog", { name: "Void the draft invoice?" });
      await expect(draftVoid).toBeVisible();
      await draftVoid.getByLabel(/Reason/).fill(`${UNBROKEN} ${"x".repeat(300)}`);
      await expectInsideScreen(page, draftVoid, "the Void dialog for a draft");
      await expectNoHorizontalOverflow(page);
      await closeDialog(page);

      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const preview = page.getByRole("dialog", { name: "Preview of the invoice" });
      await expect(preview.getByText("Draft: not issued yet")).toBeVisible({ timeout: 20_000 });
      await expectInsideScreen(page, preview, "the preview dialog");
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");

      // ---- An issued invoice, its long note, the Void dialog --------------------------------------
      await openInvoice(page, w.issued.id, w.issued.invoiceNumber ?? "");
      await expect(page.getByTestId("invoice-document")).toBeVisible();
      await expectPageFits(page, "an issued invoice", width);
      const voidButton = page.getByRole("button", { name: "Void invoice…" });
      await expectHydrated(voidButton);
      await voidButton.click();
      const voidDialog = page.getByRole("alertdialog", {
        name: `Void ${w.issued.invoiceNumber ?? ""}?`,
      });
      await expect(voidDialog).toBeVisible();
      await voidDialog.getByLabel(/Reason/).fill(`${UNBROKEN} ${"x".repeat(300)}`);
      await expectInsideScreen(page, voidDialog, "the Void dialog for an issued invoice");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        `the Void dialog at ${String(width)} px`,
      ).toBe("");
      await closeDialog(page);

      // ---- An overdue and a voided invoice --------------------------------------------------------
      await openInvoice(page, w.overdue.id, w.overdue.invoiceNumber ?? "");
      await expect(page.getByTestId("invoice-banner")).toContainText(/Overdue by \d+ days?/);
      await expectPageFits(page, "an overdue invoice", width);
      await openInvoice(page, w.voided.id, w.voided.invoiceNumber ?? "");
      await expect(page.getByTestId("invoice-void-mark")).toBeVisible();
      await expectPageFits(page, "a voided invoice with a long reason", width);
    });
  }
});

test.describe("printing an issued invoice", () => {
  /** A4 and US Letter at 96 dpi, in CSS pixels. */
  const SHEETS = [
    { name: "A4", width: 794, height: 1123 },
    { name: "Letter", width: 816, height: 1056 },
  ] as const;

  for (const sheet of SHEETS) {
    test(`comes out as the document alone and fits ${sheet.name} paper`, async ({ page }) => {
      const w = await world();
      await useViewport(page, 1440);
      await loginAs(page, "admin");
      await openInvoice(page, w.issued.id, w.issued.invoiceNumber ?? "");
      await expect(page.getByTestId("invoice-document")).toBeVisible();

      await page.setViewportSize({ width: sheet.width, height: sheet.height });
      await page.emulateMedia({ media: "print" });

      const invoiceDocument = page.getByTestId("invoice-document");
      await expect(invoiceDocument).toBeVisible();
      // The frame is gone: no sidebar, no page header with its buttons, no side cards.
      await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Void invoice…" })).toBeHidden();
      await expect(page.getByTestId("invoice-banner")).toBeHidden();
      await expect(page.getByTestId("invoice-payments")).toBeHidden();
      await expect(page.getByRole("navigation").filter({ visible: true })).toHaveCount(0);

      // The document is inside the sheet with nothing clipped at either side.
      const box = await invoiceDocument.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) throw new Error("The document has no box.");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(sheet.width + 1);
      await expectNoHorizontalOverflow(page);
      const clipped = await page.evaluate(() => {
        const article = document.querySelector("[data-testid=invoice-document]");
        if (article === null) return ["no document"];
        const right = article.getBoundingClientRect().right;
        return [...article.querySelectorAll("*")]
          .filter((element) => element.getBoundingClientRect().right > right + 1)
          .map((element) => element.tagName.toLowerCase());
      });
      expect(clipped, "elements sticking out of the document").toEqual([]);

      // The browser's own PDF of it is made at that paper size, over one or two pages, never more.
      const pdf = await page.pdf({
        format: sheet.name === "A4" ? "A4" : "Letter",
        printBackground: true,
      });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages, `${sheet.name} pages`).toBeGreaterThanOrEqual(1);
      expect(pages, `${sheet.name} pages`).toBeLessThanOrEqual(2);
    });
  }
});

test("the draft's server-side numbers do not change when the page is only previewed", async ({
  page,
}) => {
  const w = await world();
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await openInvoice(page, w.draft.id, "Draft invoice");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Preview of the invoice" }).getByText("Draft: not issued yet"),
  ).toBeVisible({ timeout: 20_000 });
  const [stored] = await invoicesOfJob(w.draftJob.jobId);
  expect(stored?.status).toBe("DRAFT");
  expect(stored?.invoiceNumber).toBeNull();
});
