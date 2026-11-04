import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createJobFor } from "../fixtures/customers.js";
import {
  createBookedJobFor,
  instantAt,
  ownTechnician,
  uniqueFutureDay,
  withDatabaseQuery,
} from "../fixtures/jobs.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { openJob } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T18 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the admin's job page in each status with the Start,
 * Complete, Needs rescheduling and Cancel dialogs, the Ready to invoice tab, and the customer's
 * overview, job list and job pages. They are written to the git-ignored artifacts folder; the tests
 * fail only if a page does not render.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t18");

async function shoot(page: Page, width: number, name: string): Promise<void> {
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

type Status = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_RESCHEDULING" | "CANCELLED";

for (const width of [360, 1440] as const) {
  test(`pictures of the job lifecycle at ${String(width)} px`, async ({ page, browser }) => {
    await useViewport(page, width);
    const tag = newTechnicianTag();
    tags.push(tag);
    const jordan = await ownTechnician(tag);
    const day = uniqueFutureDay();
    const customer = await createCustomerAccount({ name: `Amara Okafor ${tag}` });
    const start = instantAt(day, "10:00");

    const make = async (status: Status, data: Record<string, unknown> = {}) => {
      const job = await createJobFor(customer.id, { status, scheduledStart: start });
      await withDatabaseQuery((prisma) =>
        prisma.workOrder.update({
          where: { id: job.jobId },
          data: { technicianId: jordan.id, ...data },
        }),
      );
      return job;
    };
    const scheduled = await createBookedJobFor(customer.id, jordan.id, day, "10:00", "12:00");
    const started = await make("IN_PROGRESS", { startedAt: new Date() });
    const completed = await make("COMPLETED", {
      startedAt: new Date(Date.now() - 3_600_000),
      completionNote:
        "Replaced the run capacitor and re-gassed the system.\nThe unit now cools to 68 degrees. If it hums again, call us and we will come back at no charge.",
      internalCompletionNote: "Offer a surge protector at the next visit.",
    });
    const needs = await make("NEEDS_RESCHEDULING");
    const cancelled = await make("CANCELLED", { cancelReason: "The customer moved away." });
    const pending = await createJobFor(customer.id, { status: "PENDING_SCHEDULING" });

    // ---- The admin ----------------------------------------------------------------------------
    await loginAs(page, "admin");
    await page.goto(`/app/jobs?view=ready-to-invoice&q=${tag}`);
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
    await shoot(page, width, "admin-ready-to-invoice");

    await openJob(page, scheduled, { expectButton: "Start job" });
    await shoot(page, width, "admin-job-scheduled");
    await page.getByRole("button", { name: "Start job", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shoot(page, width, "admin-dialog-start");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Needs rescheduling" }).click();
    const needsDialog = page.getByRole("alertdialog");
    await needsDialog
      .getByLabel(/Reason \(internal\)/)
      .fill("The part is backordered until Friday.");
    await needsDialog
      .getByLabel(/Message to the customer/)
      .fill("Sorry: the part we need is late. We will phone you to agree a new time.");
    await shoot(page, width, "admin-dialog-needs-rescheduling");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Cancel job" }).click();
    await page
      .getByRole("alertdialog")
      .getByLabel(/Reason \(internal\)/)
      .fill("The customer moved away.");
    await shoot(page, width, "admin-dialog-cancel");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();

    await openJob(page, started, { expectButton: "Complete job" });
    await shoot(page, width, "admin-job-in-progress");
    await page.getByRole("button", { name: "Complete job", exact: true }).click();
    const completeDialog = page.getByRole("alertdialog");
    await completeDialog
      .getByLabel(/Completion summary for the customer/)
      .fill("Replaced the run capacitor and checked the cooling. The unit now reaches 68 degrees.");
    await completeDialog
      .getByLabel(/Internal note/)
      .fill("Offer a surge protector at the next visit.");
    await shoot(page, width, "admin-dialog-complete");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();

    for (const [job, name] of [
      [completed, "admin-job-completed"],
      [needs, "admin-job-needs-rescheduling"],
      [cancelled, "admin-job-cancelled"],
    ] as const) {
      await openJob(page, job);
      await shoot(page, width, name);
    }

    // ---- The customer -------------------------------------------------------------------------
    const context = await browser.newContext();
    const mine = await context.newPage();
    await useViewport(mine, width);
    await loginAs(mine, customer);
    await mine.goto("/portal");
    await expect(mine.getByRole("region", { name: "Upcoming visits" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(mine, width, "portal-overview");
    await mine.goto("/portal/jobs");
    await expect(mine.getByRole("list", { name: "Upcoming jobs" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await shoot(mine, width, "portal-jobs");
    for (const [job, name] of [
      [scheduled, "portal-job-scheduled"],
      [started, "portal-job-in-progress"],
      [completed, "portal-job-completed"],
      [needs, "portal-job-needs-rescheduling"],
      [cancelled, "portal-job-cancelled"],
      [pending, "portal-job-pending"],
    ] as const) {
      await mine.goto(`/portal/jobs/${job.jobId}`);
      await expect(mine.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(mine, width, name);
    }
    await context.close();
  });
}
