import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { withDatabase } from "../fixtures/accounts.js";
import { loginAs } from "../support/auth.js";
import { NAVIGATION_TIMEOUT, useViewport, WIDTHS } from "../tests/helpers/layout.js";
import { seriousViolations } from "../tests/helpers/public.js";

/**
 * The T25 sweep (FR-004, NFR-02, NFR-03, AC-UQ-03, SC-04, UX-07, UX-08) on the showcase data: every
 * key screen of the public site, the sign-in pages, the portal and the business application, at 360,
 * 768, 1024 and 1440 px. On each one:
 *
 * - axe (WCAG 2.0/2.1/2.2 A and AA rules) reports no serious or critical violation;
 * - the headings form an outline (one `h1`, first, no level skipped);
 * - the page does not scroll sideways;
 * - a full-page screenshot is saved to `artifacts/screenshots/t25/<width>/<screen>.png` (git-ignored)
 *   for the visual review in `docs/QA_CHECKLIST.md`.
 *
 * Failures are soft, so one run reports every screen; the test still fails if any check did. The
 * showcase data is only read here.
 */

test.describe.configure({ timeout: 900_000 });

const DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t25");
const ALEX = "alex.morgan@example.test";

interface Screen {
  name: string;
  path: string;
}

/** Waits for the page to be still: fonts, data, finite animations, toasts gone. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
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
}

async function headingProblems(page: Page): Promise<string> {
  const levels = await page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter((heading) => heading.getClientRects().length > 0 || heading.closest(".sr-only"))
      .map((heading) => Number(heading.tagName.slice(1))),
  );
  const problems: string[] = [];
  if (levels.filter((level) => level === 1).length !== 1) problems.push("not exactly one h1");
  if (levels[0] !== 1) problems.push("the first heading is not the h1");
  levels.forEach((level, index) => {
    const previous = levels[index - 1];
    if (previous !== undefined && level > previous + 1) {
      problems.push(`h${String(previous)} followed by h${String(level)}`);
    }
  });
  return problems.length === 0 ? "" : `${problems.join("; ")} (${levels.join(",")})`;
}

async function sweep(page: Page, width: number, screens: readonly Screen[]): Promise<void> {
  await useViewport(page, width);
  const folder = resolve(DIR, String(width));
  mkdirSync(folder, { recursive: true });
  for (const screen of screens) {
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached({
      timeout: NAVIGATION_TIMEOUT,
    });
    await settle(page);
    const label = `${screen.name} (${screen.path}) at ${String(width)} px`;

    expect.soft(await seriousViolations(page), `${label}: serious axe violations`).toBe("");
    expect.soft(await headingProblems(page), `${label}: heading outline`).toBe("");
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect
      .soft(overflow.scroll, `${label}: scrolls sideways (${String(overflow.scroll)} px wide)`)
      .toBeLessThanOrEqual(overflow.viewport);
    await page.screenshot({ path: resolve(folder, `${screen.name}.png`), fullPage: true });

    // Branding (spec §18.4, last item): the title, the icon and the logo of every screen, recorded
    // for the review in docs/QA_CHECKLIST.md.
    const branding = await page.evaluate(() => ({
      title: document.title,
      icons: [...document.querySelectorAll("link[rel~=icon]")].map(
        (link) => (link as HTMLLinkElement).getAttribute("href") ?? "",
      ),
      logo:
        Boolean(document.querySelector("[aria-label*=FixFlow], img[alt*=FixFlow]")) ||
        document.body.innerText.includes("FixFlow"),
    }));
    expect.soft(branding.title, `${label}: a page title`).not.toBe("");
    expect.soft(branding.icons.length, `${label}: a favicon`).toBeGreaterThan(0);
    writeFileSync(
      resolve(folder, `${screen.name}.json`),
      JSON.stringify({ path: screen.path, ...branding }, null, 2),
    );
  }
}

async function adminScreens(): Promise<Screen[]> {
  const ids = await withDatabase(async (prisma) => {
    const pick = async (row: Promise<{ id: string }>) => (await row).id;
    return {
      request: await pick(prisma.serviceRequest.findFirstOrThrow({ where: { status: "QUOTED" } })),
      draftQuotation: await pick(prisma.quotation.findFirstOrThrow({ where: { status: "DRAFT" } })),
      sentQuotation: await pick(prisma.quotation.findFirstOrThrow({ where: { status: "SENT" } })),
      job: await pick(prisma.workOrder.findFirstOrThrow({ where: { status: "IN_PROGRESS" } })),
      customer: await pick(
        prisma.customerProfile.findFirstOrThrow({ where: { user: { email: ALEX } } }),
      ),
      technician: await pick(prisma.technician.findFirstOrThrow({ where: { name: "Jordan Lee" } })),
      invoice: await pick(prisma.invoice.findFirstOrThrow({ where: { status: "PARTIALLY_PAID" } })),
      draftInvoice: await pick(prisma.invoice.findFirstOrThrow({ where: { status: "DRAFT" } })),
      service: await pick(prisma.service.findFirstOrThrow({ orderBy: { sortOrder: "asc" } })),
    };
  });
  return [
    { name: "B01-dashboard", path: "/app/dashboard" },
    { name: "B02-requests", path: "/app/requests" },
    { name: "B03-request", path: `/app/requests/${ids.request}` },
    { name: "B04a-quotation-draft", path: `/app/quotations/${ids.draftQuotation}` },
    { name: "B04b-quotation-sent", path: `/app/quotations/${ids.sentQuotation}` },
    { name: "B05-jobs", path: "/app/jobs" },
    { name: "B06-job", path: `/app/jobs/${ids.job}` },
    { name: "B07a-calendar-week", path: "/app/calendar?view=week" },
    { name: "B07b-calendar-agenda", path: "/app/calendar?view=agenda" },
    { name: "B08-customers", path: "/app/customers" },
    { name: "B09-customer", path: `/app/customers/${ids.customer}` },
    { name: "B10-technicians", path: "/app/technicians" },
    { name: "B11-technician", path: `/app/technicians/${ids.technician}` },
    { name: "B12-invoices", path: "/app/invoices" },
    { name: "B13a-invoice-partly-paid", path: `/app/invoices/${ids.invoice}` },
    { name: "B13b-invoice-draft", path: `/app/invoices/${ids.draftInvoice}` },
    { name: "B14-settings-business", path: "/app/settings/business" },
    { name: "B15-settings-services", path: "/app/settings/services" },
    { name: "B16-service-editor", path: `/app/settings/services/${ids.service}` },
    { name: "B17-service-new", path: "/app/settings/services/new" },
    { name: "B18-account", path: "/app/account" },
  ];
}

async function portalScreens(): Promise<Screen[]> {
  const ids = await withDatabase(async (prisma) => {
    const pick = async (row: Promise<{ id: string }>) => (await row).id;
    const mine = { customer: { user: { email: ALEX } } };
    return {
      request: await pick(
        prisma.serviceRequest.findFirstOrThrow({ where: { ...mine, status: "CONVERTED_TO_JOB" } }),
      ),
      quotation: await pick(
        prisma.quotation.findFirstOrThrow({ where: { ...mine, status: "SENT" } }),
      ),
      job: await pick(
        prisma.workOrder.findFirstOrThrow({ where: { ...mine, status: "COMPLETED" } }),
      ),
      invoice: await pick(
        prisma.invoice.findFirstOrThrow({ where: { ...mine, status: "ISSUED" } }),
      ),
    };
  });
  return [
    { name: "C01-overview", path: "/portal" },
    { name: "C02-requests", path: "/portal/requests" },
    { name: "C03-request", path: `/portal/requests/${ids.request}` },
    { name: "C04-quotation", path: `/portal/quotations/${ids.quotation}` },
    { name: "C05-jobs", path: "/portal/jobs" },
    { name: "C06-job", path: `/portal/jobs/${ids.job}` },
    { name: "C07-invoices", path: "/portal/invoices" },
    { name: "C08-invoice", path: `/portal/invoices/${ids.invoice}` },
    { name: "C09-profile", path: "/portal/profile" },
    { name: "C10-request-service", path: "/request-service?service=ac-diagnostic-visit" },
  ];
}

const PUBLIC_SCREENS: Screen[] = [
  { name: "P01-home", path: "/" },
  { name: "P02-services", path: "/services" },
  { name: "P03-service", path: "/services/ac-routine-maintenance" },
  { name: "P04-privacy", path: "/privacy" },
  { name: "P05-not-found", path: "/no-such-page" },
  { name: "A01-login", path: "/login" },
  { name: "A02-register", path: "/register" },
  { name: "A03-forgot-password", path: "/forgot-password" },
  { name: "A04-reset-password", path: "/reset-password?token=example" },
];

for (const width of WIDTHS) {
  test(`public and sign-in screens at ${String(width)} px`, async ({ page }) => {
    await sweep(page, width, PUBLIC_SCREENS);
  });

  test(`customer portal screens at ${String(width)} px`, async ({ page }) => {
    const screens = await portalScreens();
    await loginAs(page, "customer");
    await sweep(page, width, screens);
  });

  test(`business application screens at ${String(width)} px`, async ({ page }) => {
    const screens = await adminScreens();
    await loginAs(page, "admin");
    await sweep(page, width, screens);
  });
}
