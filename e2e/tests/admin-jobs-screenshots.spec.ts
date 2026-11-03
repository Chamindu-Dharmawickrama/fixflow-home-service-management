import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createJobFor } from "../fixtures/customers.js";
import {
  createAcceptedQuotationFor,
  createBookedJobFor,
  ownTechnician,
  uniqueFutureDay,
} from "../fixtures/jobs.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { dialogReady, fillSchedule, openJob, scheduleDialog, toast } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T17 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the jobs list and its empty state, the accepted request
 * with "Create job", a new job with the scheduling dialog open, filled, with a clash and with the
 * server's refusal, a scheduled job, the reschedule dialog and a job that does not exist. They are
 * written to the git-ignored artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t17");

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

for (const width of [360, 1440] as const) {
  test(`pictures of the job screens at ${String(width)} px`, async ({ page }) => {
    await useViewport(page, width);
    const tag = newTechnicianTag();
    tags.push(tag);
    const jordan = await ownTechnician(tag);
    const day = uniqueFutureDay();
    const alex = await createCustomerAccount({ name: "Alex Morgan" });
    const priya = await createCustomerAccount({ name: "Priya Shah" });
    const nico = await createCustomerAccount({ name: "Nico Newcomer" });
    await createJobFor(alex.id, { status: "PENDING_SCHEDULING" });
    const existing = await createBookedJobFor(priya.id, jordan.id, day, "10:00", "12:00");
    const { request } = await createAcceptedQuotationFor(nico.id, {
      accessNotes: "Side gate code is 4471.",
    });
    await loginAs(page, "admin");

    // ---- The list --------------------------------------------------------------------------
    await page.goto("/app/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
    await shoot(page, width, "list-needs-scheduling");

    await page.goto("/app/jobs?view=upcoming");
    await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
    await shoot(page, width, "list-upcoming");

    await page.goto("/app/jobs?view=all&q=zzz-nobody-has-this");
    await expect(page.getByRole("heading", { level: 2, name: "No jobs match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
    await shoot(page, width, "list-empty");

    // ---- The accepted request, then the new job with its dialog ------------------------------
    await page.goto(`/app/requests/${request.id}`);
    const create = page.getByRole("button", { name: "Create job", exact: true });
    await expect(create).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expectHydrated(create);
    await shoot(page, width, "request-create-job");
    await create.click();
    const dialog = await dialogReady(page, jordan.name);
    await shoot(page, width, "dialog-empty");

    await fillSchedule(dialog, { date: day, time: "14:00", technician: jordan.name });
    await expect(dialog.getByText(`${jordan.name} is free at that time.`)).toBeVisible();
    await shoot(page, width, "dialog-free");

    await fillSchedule(dialog, { time: "11:00" });
    await expect(dialog.getByTestId("conflict-check")).toContainText(existing.jobReference);
    await shoot(page, width, "dialog-clash");

    await dialog.getByRole("button", { name: "Schedule visit" }).click();
    await expect(dialog.getByRole("alert")).toContainText("is already booked");
    await shoot(page, width, "dialog-refused");

    await dialog.getByLabel(/^Start time/).fill("12:00");
    await expect(dialog.getByText(`${jordan.name} is free at that time.`)).toBeVisible();
    await dialog.getByRole("button", { name: "Schedule visit" }).click();
    await expect(toast(page, "is scheduled")).toBeVisible();
    await expect(scheduleDialog(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Reschedule", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await shoot(page, width, "job-scheduled");

    // ---- Moving it -------------------------------------------------------------------------
    const reschedule = page.getByRole("button", { name: "Reschedule", exact: true });
    await expectHydrated(reschedule);
    await reschedule.click();
    const move = await dialogReady(page, jordan.name);
    await move.getByLabel(/^Start time/).fill("15:00");
    await move.getByRole("button", { name: "Reschedule visit" }).click();
    await expect(move.getByText(/Enter a reason of 5 to 200 characters/)).toBeVisible();
    await shoot(page, width, "dialog-reschedule-needs-reason");
    await page.keyboard.press("Escape");

    // ---- A job that is not there --------------------------------------------------------------
    await openJob(page, { jobId: existing.jobId, jobReference: existing.jobReference });
    await shoot(page, width, "job-booked");
    await page.goto("/app/jobs/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
    ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await shoot(page, width, "job-not-found");
  });
}
