import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { withDatabase } from "../fixtures/accounts.js";
import { loginAs } from "../support/auth.js";
import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
} from "../tests/helpers/layout.js";

/**
 * The walk-through of T24: every admin and portal screen on the showcase data at 1440 and 360 px,
 * photographed into `artifacts/screenshots/t24/<width>/` (git-ignored) so the data can be looked at
 * for anything empty or implausible. Each page must also load without sideways scrolling; a failure
 * there is reported at the end rather than stopping the walk, so every picture is still taken.
 */

test.describe.configure({ timeout: 900_000 });

const DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t24");
const WIDTHS = [1440, 360] as const;
const ALEX = "alex.morgan@example.test";

interface Screen {
  name: string;
  path: string;
}

async function shoot(page: Page, width: number, screen: Screen): Promise<void> {
  await useViewport(page, width);
  await page.goto(screen.path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
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
  const folder = resolve(DIR, String(width));
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, `${screen.name}.png`), fullPage: true });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect.soft(fits, `${screen.path} at ${String(width)} px scrolls sideways`).toBe(true);
}

test("the admin screens, on the showcase data, at 1440 and 360 px", async ({ page }) => {
  const ids = await withDatabase(async (prisma) => {
    const pick = async (id: Promise<{ id: string }>) => (await id).id;
    return {
      quotedRequest: await pick(
        prisma.serviceRequest.findFirstOrThrow({ where: { status: "QUOTED" } }),
      ),
      sentQuotation: await pick(prisma.quotation.findFirstOrThrow({ where: { status: "SENT" } })),
      declinedQuotation: await pick(
        prisma.quotation.findFirstOrThrow({ where: { status: "DECLINED" } }),
      ),
      inProgressJob: await pick(
        prisma.workOrder.findFirstOrThrow({ where: { status: "IN_PROGRESS" } }),
      ),
      needsTimeJob: await pick(
        prisma.workOrder.findFirstOrThrow({ where: { status: "NEEDS_RESCHEDULING" } }),
      ),
      completedJob: await pick(
        prisma.workOrder.findFirstOrThrow({
          where: {
            status: "COMPLETED",
            invoices: { some: { status: "VOID" }, none: { status: { not: "VOID" } } },
          },
        }),
      ),
      paidInvoice: await pick(prisma.invoice.findFirstOrThrow({ where: { status: "PAID" } })),
      overdueInvoice: await pick(prisma.invoice.findFirstOrThrow({ where: { status: "OVERDUE" } })),
      draftInvoice: await pick(prisma.invoice.findFirstOrThrow({ where: { status: "DRAFT" } })),
      alex: await pick(
        prisma.customerProfile.findFirstOrThrow({ where: { user: { email: ALEX } } }),
      ),
      jordan: await pick(prisma.technician.findFirstOrThrow({ where: { name: "Jordan Lee" } })),
    };
  });
  const screens: Screen[] = [
    { name: "admin-dashboard", path: "/app/dashboard" },
    { name: "admin-requests", path: "/app/requests" },
    { name: "admin-request-quoted", path: `/app/requests/${ids.quotedRequest}` },
    { name: "admin-quotation-sent", path: `/app/quotations/${ids.sentQuotation}` },
    { name: "admin-quotation-declined", path: `/app/quotations/${ids.declinedQuotation}` },
    { name: "admin-jobs", path: "/app/jobs" },
    { name: "admin-job-in-progress", path: `/app/jobs/${ids.inProgressJob}` },
    { name: "admin-job-needs-rescheduling", path: `/app/jobs/${ids.needsTimeJob}` },
    { name: "admin-job-completed-awaiting-invoice", path: `/app/jobs/${ids.completedJob}` },
    { name: "admin-calendar-week", path: "/app/calendar?view=week" },
    { name: "admin-calendar-agenda", path: "/app/calendar?view=agenda" },
    { name: "admin-customers", path: "/app/customers" },
    { name: "admin-customer-alex", path: `/app/customers/${ids.alex}` },
    { name: "admin-invoices", path: "/app/invoices" },
    { name: "admin-invoice-paid", path: `/app/invoices/${ids.paidInvoice}` },
    { name: "admin-invoice-overdue", path: `/app/invoices/${ids.overdueInvoice}` },
    { name: "admin-invoice-draft", path: `/app/invoices/${ids.draftInvoice}` },
    { name: "admin-technicians", path: "/app/technicians" },
    { name: "admin-technician-jordan", path: `/app/technicians/${ids.jordan}` },
    { name: "admin-settings-business", path: "/app/settings/business" },
    { name: "admin-settings-services", path: "/app/settings/services" },
  ];

  await loginAs(page, "admin");
  for (const width of WIDTHS) {
    for (const screen of screens) {
      await shoot(page, width, screen);
    }
  }
  await useViewport(page, 1440);
  await expectNoHorizontalOverflow(page);
});

test("the customer screens (Alex Morgan) and the public pages, on the showcase data, at 1440 and 360 px", async ({
  page,
}) => {
  const ids = await withDatabase(async (prisma) => {
    const pick = async (id: Promise<{ id: string }>) => (await id).id;
    const mine = { customer: { user: { email: ALEX } } };
    return {
      request: await pick(
        prisma.serviceRequest.findFirstOrThrow({ where: { ...mine, status: "CONVERTED_TO_JOB" } }),
      ),
      quotedRequest: await pick(
        prisma.serviceRequest.findFirstOrThrow({ where: { ...mine, status: "QUOTED" } }),
      ),
      quotation: await pick(
        prisma.quotation.findFirstOrThrow({ where: { ...mine, status: "SENT" } }),
      ),
      voidQuotation: await pick(
        prisma.quotation.findFirstOrThrow({ where: { ...mine, status: "VOID" } }),
      ),
      job: await pick(
        prisma.workOrder.findFirstOrThrow({ where: { ...mine, status: "COMPLETED" } }),
      ),
      invoice: await pick(
        prisma.invoice.findFirstOrThrow({ where: { ...mine, status: "ISSUED" } }),
      ),
    };
  });
  const screens: Screen[] = [
    { name: "portal-overview", path: "/portal" },
    { name: "portal-requests", path: "/portal/requests" },
    { name: "portal-request-converted", path: `/portal/requests/${ids.request}` },
    { name: "portal-request-quoted", path: `/portal/requests/${ids.quotedRequest}` },
    { name: "portal-quotations", path: "/portal/quotations" },
    { name: "portal-quotation-awaiting", path: `/portal/quotations/${ids.quotation}` },
    { name: "portal-quotation-withdrawn", path: `/portal/quotations/${ids.voidQuotation}` },
    { name: "portal-jobs", path: "/portal/jobs" },
    { name: "portal-job-completed", path: `/portal/jobs/${ids.job}` },
    { name: "portal-invoices", path: "/portal/invoices" },
    { name: "portal-invoice-issued", path: `/portal/invoices/${ids.invoice}` },
    { name: "portal-profile", path: "/portal/profile" },
    { name: "request-service-form", path: "/request-service?service=ac-diagnostic-visit" },
  ];

  await loginAs(page, "customer");
  for (const width of WIDTHS) {
    for (const screen of screens) {
      await shoot(page, width, screen);
    }
  }
});

test("the public pages and the sign-in page, at 1440 and 360 px", async ({ page }) => {
  const screens: Screen[] = [
    { name: "public-home", path: "/" },
    { name: "public-services", path: "/services" },
    { name: "public-privacy", path: "/privacy" },
    { name: "public-login-demo-accounts", path: "/login" },
    { name: "public-register", path: "/register" },
  ];
  for (const width of WIDTHS) {
    for (const screen of screens) {
      await shoot(page, width, screen);
    }
  }
});
