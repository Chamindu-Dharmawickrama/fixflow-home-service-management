import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import {
  banner,
  customerWithInvoices,
  downloadButton,
  invoiceDocument,
  openPortalInvoice,
  signInAsCustomer,
} from "./helpers/portal-invoices.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The customer's invoice screens at the four required widths (T22, UX-QB-INV, spec §17.4, §18.4): the
 * list (every state, a filter with nothing in it), the overview with its Outstanding invoices, and an
 * invoice in each state (issued, part-paid, overdue, paid, withdrawn), with ordinary content and with
 * text as long as the rules allow (an unbroken customer name and note). Each screen is axe-clean and
 * nothing scrolls sideways. Each test makes the customer it needs (the tests run in parallel on one
 * database).
 */

test.describe.configure({ timeout: 240_000 });

/** A word with no space to break at, the way a pasted name or reference reads. */
const UNBROKEN = "W".repeat(100);

async function expectPageFits(page: Page, label: string, width: number) {
  await expectNoHorizontalOverflow(page);
  expect(await seriousViolations(page), `${label} at ${String(width)} px`).toBe("");
}

/** One customer with an invoice in every interesting state, and a name that will not break. */
async function world() {
  const { customer, make, pay } = await customerWithInvoices(`Dana ${UNBROKEN}`);
  const issued = await make({ note: `Thank you. ${UNBROKEN}` });
  const partly = await make();
  await pay(partly.id, { amount: "60.00", method: "CHEQUE", reference: UNBROKEN });
  const overdue = await make({ issueDate: "2026-01-05", dueDate: "2026-01-19" });
  const paid = await make();
  await pay(paid.id, { amount: paid.job.totals.totalAmount, method: "CASH" });
  const withdrawn = await make({ status: "VOID" });
  return { customer, issued, partly, overdue, paid, withdrawn };
}

test.describe("the customer's invoice screens at the four widths", () => {
  for (const width of WIDTHS) {
    test(`work at ${String(width)} px: the list, a filter with nothing in it, the overview and each state of an invoice`, async ({
      page,
    }) => {
      const w = await world();
      await useViewport(page, width);
      await signInAsCustomer(page, w.customer);

      // ---- The list, with every state on it -------------------------------------------------------------
      await page.goto("/portal/invoices");
      await expect(page.getByRole("heading", { level: 1, name: "Your invoices" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(page.getByTestId("portal-invoice-card").filter({ visible: true })).toHaveCount(
        5,
      );
      await expectPageFits(page, "the invoice list", width);

      // ---- A filter with nothing in it: the empty state guides ----------------------------------------------
      const fresh = await createCustomerAccount({ name: "Nora Newcomer" });
      await page.context().clearCookies();
      await signInAsCustomer(page, fresh);
      await page.goto("/portal/invoices?filter=outstanding");
      await expect(page.getByRole("heading", { name: "Nothing to pay right now" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "the empty Outstanding list", width);
      await page.goto("/portal/invoices");
      await expect(
        page.getByRole("heading", { name: "You don't have an invoice yet" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "the empty invoice list", width);

      // ---- The overview with its Outstanding invoices ---------------------------------------------------------
      await page.context().clearCookies();
      await signInAsCustomer(page, w.customer);
      await page.goto("/portal");
      await expect(page.getByRole("region", { name: "Outstanding invoices" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "the overview", width);

      // ---- Each state of an invoice ---------------------------------------------------------------------------------
      const states = [
        {
          label: "an issued invoice",
          invoice: w.issued,
          banner: /Balance due \$\d+\.\d{2} by Jan 1, 2999/,
        },
        {
          label: "a part-paid invoice",
          invoice: w.partly,
          banner: /\$60\.00 of \$\d+\.\d{2} has been received\./,
        },
        {
          label: "an overdue invoice",
          invoice: w.overdue,
          banner: /Overdue: \$\d+\.\d{2} was due Jan 19, 2026/,
        },
        { label: "a paid invoice", invoice: w.paid, banner: /Paid in full on Nov 3, 2026/ },
        {
          label: "a withdrawn invoice",
          invoice: w.withdrawn,
          banner: /The business withdrew this invoice/,
        },
      ] as const;
      for (const state of states) {
        await openPortalInvoice(page, state.invoice.id, state.invoice.invoiceNumber ?? "");
        await expect(banner(page)).toContainText(state.banner);
        await expect(invoiceDocument(page)).toBeVisible();
        await expect(downloadButton(page)).toBeVisible();
        await expectPageFits(page, state.label, width);
      }

      // ---- An address that is not an invoice ------------------------------------------------------------------------
      await page.goto("/portal/invoices/not-an-id");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that invoice" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectPageFits(page, "the not-found page", width);
    });
  }
});

test("the invoice page says what the business wrote, and long words stay inside their boxes at 360 px", async ({
  page,
}) => {
  const w = await world();
  await useViewport(page, 360);
  await signInAsCustomer(page, w.customer);
  await openPortalInvoice(page, w.issued.id, w.issued.invoiceNumber ?? "");
  const doc = invoiceDocument(page);
  await expect(doc).toContainText("Thank you.");
  // Every box in the document stays inside the screen, whatever the customer's name or note holds.
  const outside = await doc.evaluate((element) => {
    const viewport = window.innerWidth;
    return [...element.querySelectorAll("*")]
      .filter((child) => child.getBoundingClientRect().right > viewport + 1)
      .map((child) => child.tagName.toLowerCase());
  });
  expect(outside).toEqual([]);
});
