import AxeBuilder from "@axe-core/playwright";
import { dateOnlyInTimeZone } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { withDatabase } from "../fixtures/accounts.js";
import { loginAs } from "../support/auth.js";
import { cards, openCalendar } from "../tests/helpers/calendar.js";
import {
  activity,
  card,
  figures,
  openDashboard,
  queue,
  schedule,
  valueOf,
} from "../tests/helpers/dashboard.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "../tests/helpers/layout.js";

/**
 * The application on the showcase data (T24): what a reviewer opens first. Every check is read-only
 * (the database is shared by the specs of this suite, which run side by side), and each number is
 * one that follows from the stories in `apps/server/src/db/showcase/showcase-data.ts`.
 */

test.describe.configure({ timeout: 120_000 });

const BUSINESS_TIME_ZONE = "America/New_York";

async function seriousViolations(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const violations = await seriousViolations(page);
  const report = violations
    .map((violation) => `${violation.id}: ${violation.nodes.length} node(s)`)
    .join("\n");
  expect(violations, report).toEqual([]);
}

test.describe("the business admin", () => {
  test("opens a dashboard with real figures, a queue of work, this week's visits and recent activity", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await openDashboard(page);

    // Worked out from the stories: two new requests today, a quotation accepted and not yet a job, one
    // declined and one under review, so five requests need action; one completed job has no invoice yet.
    expect(await valueOf(page, "Requests needing action")).toBe(5);
    expect(await valueOf(page, "Completed, awaiting invoice")).toBe(1);
    expect(await valueOf(page, "New requests")).toBeGreaterThanOrEqual(6);
    await expect(card(page, "Jobs today")).toContainText("1");
    // The unpaid balance is money, with the overdue part said on its own.
    await expect(card(page, "Unpaid balance")).toContainText("$");
    await expect(card(page, "Unpaid balance")).toContainText(/overdue/i);

    const items = queue(page).getByRole("listitem");
    expect(await items.count()).toBeGreaterThanOrEqual(6);
    await expect(queue(page)).toContainText("Overdue invoice");
    await expect(queue(page)).toContainText("New request");
    await expect(queue(page)).toContainText("Accepted quotation");
    await expect(queue(page)).toContainText("Needs scheduling");
    await expect(queue(page)).toContainText("Ready to invoice");

    expect(await schedule(page).getByRole("listitem").count()).toBeGreaterThanOrEqual(4);
    expect(await activity(page).getByRole("listitem").count()).toBeGreaterThanOrEqual(8);
    await expect(figures(page)).toBeVisible();
  });

  test("fills the main lists with the business's people, work and invoices", async ({ page }) => {
    await loginAs(page, "admin");
    const lists: [path: string, heading: string, mustShow: (RegExp | string)[]][] = [
      // Each list opens on its own view: all requests, the jobs that need a time, all invoices.
      ["/app/requests", "Service requests", [/FF-\d{4}-00001/, /FF-\d{4}-00020/, "Marcus Webb"]],
      ["/app/jobs", "Jobs", ["Needs rescheduling", "Pending scheduling", "Tomás Herrera"]],
      [
        "/app/invoices",
        "Invoices",
        ["Overdue", "Partially paid", "Paid", "Issued", "Draft", "Void"],
      ],
      ["/app/customers", "Customers", ["Alex Morgan", "Priya Shah", "Elena Rossi", "Hannah Kim"]],
      [
        "/app/technicians",
        "Technicians",
        ["Jordan Lee", "Sam Okafor", "Taylor Brooks", "Casey Nguyen"],
      ],
    ];
    for (const [path, heading, mustShow] of lists) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      for (const text of mustShow) {
        await expect(
          page.getByRole("main").getByText(text).first(),
          `${path}: ${String(text)}`,
        ).toBeVisible({
          timeout: NAVIGATION_TIMEOUT,
        });
      }
    }
  });

  test("shows this week's jobs on the calendar, today's visit in progress among them", async ({
    page,
  }) => {
    const { reference, customerName } = await withDatabase(async (prisma) => {
      const job = await prisma.workOrder.findFirstOrThrow({
        where: { status: "IN_PROGRESS" },
        select: { reference: true, customer: { select: { user: { select: { name: true } } } } },
      });
      return { reference: job.reference, customerName: job.customer.user.name };
    });
    await loginAs(page, "admin");

    await openCalendar(page, "view=week");

    // Today's visit is on the grid, found the way a screen reader finds it: by its name.
    const visit = page.getByRole("button", { name: new RegExp(reference) });
    await expect(visit.first()).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(visit.first()).toContainText(customerName);

    // The visits still to come are on the next working days, which may fall in next week: open the agenda
    // at the day of each one, and find it there with its technician.
    const upcoming = await withDatabase(async (prisma) =>
      (
        await prisma.workOrder.findMany({
          where: { status: "SCHEDULED" },
          select: { reference: true, scheduledStart: true, technician: { select: { name: true } } },
        })
      ).map((job) => ({
        reference: job.reference,
        date: dateOnlyInTimeZone(job.scheduledStart ?? new Date(), BUSINESS_TIME_ZONE),
        technician: job.technician?.name ?? "",
      })),
    );
    expect(upcoming).toHaveLength(3);
    expect(new Set(upcoming.map((job) => job.technician)).size).toBeGreaterThanOrEqual(2);
    for (const visitToCome of upcoming) {
      await openCalendar(page, `view=agenda&date=${visitToCome.date}`);
      const card = cards(page).filter({ hasText: visitToCome.reference });
      await expect(card, visitToCome.reference).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(card).toContainText(visitToCome.technician);
    }
  });

  test("has no serious accessibility violation on the dashboard with this much data", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await openDashboard(page);
    await expectNoSeriousViolations(page);
  });

  test("tells the demo admin what is locked and what is not on the settings page", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/app/settings/business");
    await expectHydrated(page.getByRole("form", { name: "Business settings" }));

    await expect(page.getByTestId("identity-locked-notice")).toContainText(
      "business name, logo and contact details are locked",
    );
    await expect(page.getByLabel(/^Business name/)).toBeDisabled();
    await expect(page.getByLabel(/^Default tax rate/)).toBeEnabled();
    // The portfolio notice is in the signed-in area too, with the reset frequency.
    await expect(page.getByRole("region", { name: "Demo notice" })).toContainText(
      "Data resets daily",
    );
  });
});

test.describe("the customer, Alex Morgan", () => {
  test("sees the quotation that waits for an answer and the invoice to pay, first", async ({
    page,
  }) => {
    const { quotation, invoice } = await withDatabase(async (prisma) => {
      const waiting = await prisma.quotation.findFirstOrThrow({
        where: { status: "SENT", customer: { user: { email: "alex.morgan@example.test" } } },
        select: { id: true, reference: true },
      });
      const owed = await prisma.invoice.findFirstOrThrow({
        where: { status: "ISSUED", customer: { user: { email: "alex.morgan@example.test" } } },
        select: { invoiceNumber: true },
      });
      return { quotation: waiting, invoice: owed };
    });
    await loginAs(page, "customer");
    await expect(page).toHaveURL(/\/portal$/);

    const action = page.getByRole("region", { name: "Action required" });
    await expect(action).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expect(action).toContainText(quotation.reference);
    await expect(action).toContainText(invoice.invoiceNumber ?? "INV-");

    // A visit is booked for the coming days, so the portal does not say that nothing is booked.
    const visits = page.getByRole("region", { name: "Upcoming visits" });
    await expect(visits).toBeVisible();
    await expect(visits).toContainText(/AC Routine Maintenance/);
    await expect(visits).not.toContainText("No visits are booked");

    // The quotation opens, and Alex can answer it (nothing is clicked: the data is shared).
    await action
      .getByRole("link", { name: new RegExp(quotation.reference) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/portal/quotations/${quotation.id}$`), {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("button", { name: /Accept/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Decline/ })).toBeVisible();
  });

  test("can start a fresh AC repair request with the addresses already saved", async ({ page }) => {
    await loginAs(page, "customer");
    await page.goto("/request-service?service=ac-diagnostic-visit");

    const form = page.getByRole("form", { name: "Request a service" });
    await expect(form).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expectHydrated(page.getByLabel(/^Preferred date/));
    await expect(form.getByRole("radio", { name: /AC Diagnostic Visit/ })).toBeChecked();
    // Alex has two saved addresses; nothing has to be typed to say where.
    await expect(
      form.getByRole("radio", { name: /^Home Default 214 Larkspur Lane/ }),
    ).toBeChecked();
    await expect(form.getByRole("radio", { name: /^Mum's flat 9 Orchard Row/ })).toBeVisible();
    await expect(form.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  test("has no serious accessibility violation on the portal overview", async ({ page }) => {
    await loginAs(page, "customer");
    await expect(page.getByRole("region", { name: "Action required" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectNoSeriousViolations(page);
  });
});

test.describe("the sign-in page of the public demo", () => {
  test("explains what each demo account can do and warns to use fictional details", async ({
    page,
  }) => {
    await page.goto("/login");
    const panel = page.getByRole("region", { name: "Demo accounts" });
    await expect(panel).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

    await expect(panel).toContainText("Public demo — use fictional details");
    await expect(panel).toContainText("Review requests, send quotations and schedule jobs");
    await expect(panel).toContainText("Accept or decline a quotation");
    await expect(panel).toContainText(
      "Cannot change its password, or the business name, logo and contact details",
    );
    await expect(panel.getByRole("link", { name: "Read the demo notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  test("the privacy notice gives the reset frequency and the limits", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });

    const main = page.getByRole("main");
    await expect(main).toContainText("reset every day");
    await expect(main).toContainText("cannot change their passwords");
    await expect(main).toContainText("name, logo and contact details");
  });
});
