import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { renderPdfPages } from "../../apps/server/src/test/pdf-text.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";
import {
  customerWithInvoices,
  downloadPdf,
  openPortalInvoice,
  signInAsCustomer,
} from "./helpers/portal-invoices.js";

/**
 * Pictures of the T22 screens at the narrowest and widest required widths, and the manual print check
 * of the PDF (G.6), for the visual review recorded in docs/IMPLEMENTATION_PROGRESS.md. They are written
 * to the git-ignored artifacts folder: the customer's list, overview and invoice pages, and the
 * PDF of an issued, a part-paid and a paid invoice, drawn page by page and laid on an A4 sheet and a
 * Letter sheet at actual size, with the printer's unprintable margin marked. The tests fail only if a
 * page does not render or the PDF's ink would fall outside either sheet's printable area.
 */

test.describe.configure({ timeout: 240_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t22");

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

for (const width of [360, 1440] as const) {
  test(`pictures of the customer's invoice screens at ${String(width)} px`, async ({ page }) => {
    await useViewport(page, width);
    const { customer, make, pay } = await customerWithInvoices(
      `Amara Okafor Invoices ${String(width)}`,
    );
    const open = await make({
      note: "Thank you for your custom. We have kept the price as quoted.",
    });
    const partly = await make();
    await pay(partly.id, { amount: "100.00", method: "BANK_TRANSFER" });
    const overdue = await make({ issueDate: "2026-01-05", dueDate: "2026-01-19" });
    const paid = await make();
    await pay(paid.id, {
      amount: paid.job.totals.totalAmount,
      method: "CASH",
      paymentDate: "2026-11-03",
    });
    const withdrawn = await make({ status: "VOID" });

    await signInAsCustomer(page, customer);
    await page.goto("/portal");
    await expect(page.getByRole("region", { name: "Outstanding invoices" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(page, width, "overview");

    await page.goto("/portal/invoices");
    await expect(page.getByRole("heading", { level: 1, name: "Your invoices" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(page, width, "list");
    await page.goto("/portal/invoices?filter=outstanding");
    await expect(page.getByRole("link", { name: "Outstanding" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await shoot(page, width, "list-outstanding");

    for (const [name, invoice] of [
      ["invoice-issued", open],
      ["invoice-part-paid", partly],
      ["invoice-overdue", overdue],
      ["invoice-paid", paid],
      ["invoice-withdrawn", withdrawn],
    ] as const) {
      await openPortalInvoice(page, invoice.id, invoice.invoiceNumber ?? "");
      await shoot(page, width, name);
    }

    await page.goto("/portal/invoices/not-an-id");
    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't find that invoice" }),
    ).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(page, width, "invoice-not-found");
  });
}

// ---- The manual print check of the PDF (G.6) ----------------------------------------------------------------

/** Sheets in points (1/72 in). The unprintable margin is the usual 0.25 in a desktop printer leaves. */
const SHEETS = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;
const UNPRINTABLE = 18;

/** Where the ink is on a rendered page, in points from its top-left corner. */
async function inkBox(page: Page, png: Buffer, widthPoints: number, heightPoints: number) {
  return page.evaluate(
    async ({ base64, width, height }) => {
      const image = new Image();
      await new Promise<void>((resolveImage, rejectImage) => {
        image.onload = () => {
          resolveImage();
        };
        image.onerror = () => {
          rejectImage(new Error("The page picture did not load."));
        };
        image.src = `data:image/png;base64,${base64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("No canvas.");
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const at = (y * canvas.width + x) * 4;
          const alpha = data[at + 3] ?? 0;
          const isInk =
            alpha > 0 &&
            ((data[at] ?? 255) < 235 || (data[at + 1] ?? 255) < 235 || (data[at + 2] ?? 255) < 235);
          if (isInk) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const perPointX = canvas.width / width;
      const perPointY = canvas.height / height;
      return {
        left: left / perPointX,
        top: top / perPointY,
        right: (right + 1) / perPointX,
        bottom: (bottom + 1) / perPointY,
      };
    },
    { base64: png.toString("base64"), width: widthPoints, height: heightPoints },
  );
}

/** The page laid on an A4 sheet and a Letter sheet at actual size, with the unprintable margin dashed. */
async function sheetsPicture(
  page: Page,
  png: Buffer,
  widthPoints: number,
  heightPoints: number,
  path: string,
) {
  const sheet = (name: string, size: { width: number; height: number }) => `
    <figure>
      <figcaption>${name}</figcaption>
      <div class="sheet" style="width:${size.width}pt;height:${size.height}pt">
        <img src="data:image/png;base64,${png.toString("base64")}" style="width:${widthPoints}pt;height:${heightPoints}pt" />
        <div class="margin" style="inset:${UNPRINTABLE}pt"></div>
      </div>
    </figure>`;
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 24px; background: #cfd6da; display: flex; gap: 32px; align-items: flex-start; font: 14px sans-serif; }
    figure { margin: 0; } figcaption { margin-bottom: 8px; font-weight: 600; }
    .sheet { position: relative; background: white; box-shadow: 0 0 0 1px #888; }
    .sheet img { position: absolute; left: 0; top: 0; }
    .margin { position: absolute; border: 1px dashed #d4380d; }
  </style></head><body>${sheet("A4 (8.27 × 11.69 in)", SHEETS.A4)}${sheet("Letter (8.5 × 11 in)", SHEETS.Letter)}</body></html>`);
  await page.screenshot({ path, fullPage: true });
}

test("the invoice PDFs print on A4 and Letter: one page, content inside both printable areas", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, make, pay } = await customerWithInvoices("Amara Okafor Print");
  const issued = await make({
    note: "Thank you for your custom. We have kept the price as quoted.",
  });
  const partly = await make();
  await pay(partly.id, { amount: "100.00", method: "BANK_TRANSFER" });
  const paid = await make();
  await pay(paid.id, {
    amount: paid.job.totals.totalAmount,
    method: "CASH",
    paymentDate: "2026-11-03",
  });

  await signInAsCustomer(page, customer);
  const dir = resolve(SCREENSHOT_DIR, "pdf");
  mkdirSync(dir, { recursive: true });

  const measuring = await page.context().newPage();
  for (const [name, invoice] of [
    ["issued", issued],
    ["part-paid", partly],
    ["paid", paid],
  ] as const) {
    await openPortalInvoice(page, invoice.id, invoice.invoiceNumber ?? "");
    const file = await downloadPdf(page);
    writeFileSync(resolve(dir, `${name}.pdf`), file.bytes);

    const pages = await renderPdfPages(file.bytes, 2);
    expect(pages, `${name} is one page`).toHaveLength(1);
    const [first] = pages;
    if (first === undefined) throw new Error("No page.");
    writeFileSync(resolve(dir, `${name}-page-1.png`), first.png);

    // The page is as wide as A4 and as tall as Letter, so either sheet holds it.
    expect(first.widthPoints).toBeLessThanOrEqual(SHEETS.A4.width);
    expect(first.heightPoints).toBeLessThanOrEqual(SHEETS.Letter.height);

    // The ink (text, rules, shading) stays inside the printable area of both sheets.
    const ink = await inkBox(measuring, first.png, first.widthPoints, first.heightPoints);
    for (const [sheetName, sheet] of Object.entries(SHEETS)) {
      const message = `${name} on ${sheetName}: ink ${JSON.stringify(ink)}`;
      expect(ink.left, message).toBeGreaterThanOrEqual(UNPRINTABLE);
      expect(ink.top, message).toBeGreaterThanOrEqual(UNPRINTABLE);
      expect(ink.right, message).toBeLessThanOrEqual(sheet.width - UNPRINTABLE);
      expect(ink.bottom, message).toBeLessThanOrEqual(sheet.height - UNPRINTABLE);
    }
    await sheetsPicture(
      measuring,
      first.png,
      first.widthPoints,
      first.heightPoints,
      resolve(dir, `${name}-A4-and-Letter.png`),
    );
  }
  await measuring.close();
});
