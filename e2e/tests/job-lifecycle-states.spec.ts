import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createJobFor } from "../fixtures/customers.js";
import { instantAt, ownTechnician, uniqueFutureDay, withDatabaseQuery } from "../fixtures/jobs.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
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
 * The states of the job lifecycle screens (T18): the admin's job pages in every status with their
 * dialogs, the Ready to invoice tab, and the customer's overview, job list and job pages, at the four
 * required widths, with ordinary content and with text as long as the rules allow (an unbroken word
 * included). Each is axe-clean, nothing scrolls sideways, and every dialog stays inside the screen.
 * Each test makes the customers and the technician it needs (the tests run in parallel on one
 * database) and removes only the technician.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

/** A word with no space to break at, the way a pasted link or a long part number reads. */
const UNBROKEN = "L".repeat(120);
const LONG_SUMMARY = `${UNBROKEN}\n\nReplaced the run capacitor and re-gassed the system. ${"The unit now cools to 68 degrees. ".repeat(20)}`;
const LONG_INTERNAL = `INTERNAL ${UNBROKEN} ${"Offer a surge protector at the next visit. ".repeat(10)}`;

type Status = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_RESCHEDULING" | "CANCELLED";

/** A customer with a job in every interesting state, the text of each as long as it may be. */
async function world() {
  const tag = newTechnicianTag();
  tags.push(tag);
  const jordan = await ownTechnician(tag);
  const day = uniqueFutureDay();
  const customer = await createCustomerAccount({ name: `Wanda Width ${tag}` });
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

  const scheduled = await make("SCHEDULED");
  const started = await make("IN_PROGRESS", { startedAt: new Date() });
  const completed = await make("COMPLETED", {
    startedAt: new Date(Date.now() - 3_600_000),
    completionNote: LONG_SUMMARY,
    internalCompletionNote: LONG_INTERNAL,
    scopeDescription: `${UNBROKEN}\n\nAgreed work:\n- ${"S".repeat(150)}`,
  });
  const needs = await make("NEEDS_RESCHEDULING");
  const cancelled = await make("CANCELLED", {
    cancelReason: `${UNBROKEN} ${"No longer needed. ".repeat(20)}`,
  });
  // A job that has not been given a time has no appointment at all.
  const pending = await createJobFor(customer.id, { status: "PENDING_SCHEDULING" });
  return { tag, jordan, customer, scheduled, started, completed, needs, cancelled, pending };
}

async function openAdminJob(page: Page, job: { jobId: string; jobReference: string }) {
  await page.goto(`/app/jobs/${job.jobId}`);
  await expect(page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function openPortalJob(page: Page, job: { jobId: string; jobReference: string }) {
  await page.goto(`/portal/jobs/${job.jobId}`);
  await expect(page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function expectPageFits(page: Page, label: string, width: number) {
  await expectNoHorizontalOverflow(page);
  expect(await seriousViolations(page), `${label} at ${String(width)} px`).toBe("");
}

async function expectDialogFits(
  page: Page,
  dialog: ReturnType<Page["locator"]>,
  label: string,
  width: number,
) {
  await expectInsideScreen(page, dialog, label);
  await expectNoHorizontalOverflow(page);
  expect(
    await seriousViolations(page, "[role=alertdialog]"),
    `${label} at ${String(width)} px`,
  ).toBe("");
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

test.describe("the admin's job screens at the four widths", () => {
  for (const width of WIDTHS) {
    test(`work at ${String(width)} px: every status, every dialog, the Ready to invoice tab`, async ({
      page,
    }) => {
      const w = await world();
      await useViewport(page, width);
      await loginAs(page, "admin");

      // ---- The Ready to invoice tab, with the long completed job in it -------------------------
      await page.goto(`/app/jobs?view=ready-to-invoice&q=${w.tag}`);
      await expect(page.getByRole(width >= 1024 ? "table" : "list", { name: "Jobs" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      // Below 1024 px the table is replaced by cards: only the one a person sees counts.
      await expect(
        page.getByText(w.completed.jobReference).filter({ visible: true }).first(),
      ).toBeVisible();
      await expectPageFits(page, "the Ready to invoice tab", width);

      // ---- A job under way: Complete job, with a summary as long as it may be -------------------
      await openAdminJob(page, w.started);
      await expectPageFits(page, "a job in progress", width);
      const complete = page.getByRole("button", { name: "Complete job", exact: true });
      await expectHydrated(complete);
      await complete.click();
      const dialog = page.getByRole("alertdialog", { name: `Complete ${w.started.jobReference}?` });
      await expect(dialog).toBeVisible();
      await expectDialogFits(page, dialog, "the Complete job dialog", width);
      await dialog
        .getByLabel(/Completion summary for the customer/)
        .fill(LONG_SUMMARY.slice(0, 2000));
      await dialog.getByLabel(/Internal note/).fill(LONG_INTERNAL);
      await expectDialogFits(page, dialog, "the filled Complete job dialog", width);
      await closeDialog(page);

      // ---- A scheduled job: Start job (the time has not come), then the two menu dialogs --------
      await openAdminJob(page, w.scheduled);
      await expectPageFits(page, "a scheduled job", width);
      const start = page.getByRole("button", { name: "Start job", exact: true });
      await expectHydrated(start);
      await start.click();
      const startDialog = page.getByRole("alertdialog", {
        name: `Start ${w.scheduled.jobReference}?`,
      });
      await expect(startDialog.getByRole("note")).toBeVisible();
      await expectDialogFits(page, startDialog, "the Start job dialog with its notice", width);
      await closeDialog(page);

      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Cancel job" })).toBeVisible();
      expect(await seriousViolations(page, "[role=menu]"), `the menu at ${String(width)} px`).toBe(
        "",
      );
      await page.getByRole("menuitem", { name: "Needs rescheduling" }).click();
      const needsDialog = page.getByRole("alertdialog", {
        name: `${w.scheduled.jobReference} needs a new time?`,
      });
      await expect(needsDialog).toBeVisible();
      await needsDialog.getByLabel(/Reason \(internal\)/).fill("r".repeat(200));
      await needsDialog
        .getByLabel(/Message to the customer/)
        .fill(`${UNBROKEN} ${"Sorry. ".repeat(60)}`);
      await expectDialogFits(page, needsDialog, "the Needs rescheduling dialog", width);
      await closeDialog(page);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel job" }).click();
      const cancelDialog = page.getByRole("alertdialog", {
        name: `Cancel ${w.scheduled.jobReference}?`,
      });
      await expect(cancelDialog).toBeVisible();
      await cancelDialog.getByLabel(/Reason \(internal\)/).fill(`${UNBROKEN} ${"x".repeat(300)}`);
      await expectDialogFits(page, cancelDialog, "the Cancel job dialog", width);
      await closeDialog(page);

      // ---- The jobs that have ended, left the path, or have no time yet ------------------------
      for (const [job, label] of [
        [w.completed, "a completed job with long notes"],
        [w.needs, "a job that needs a new time"],
        [w.cancelled, "a cancelled job with a long reason"],
        [w.pending, "a job waiting for a time"],
      ] as const) {
        await openAdminJob(page, job);
        await expectPageFits(page, label, width);
      }
    });
  }

  test("the Ready to invoice tab says so when it is empty, without offering an invoice", async ({
    page,
  }) => {
    await useViewport(page, 360);
    await loginAs(page, "admin");
    await page.goto("/app/jobs?view=ready-to-invoice&q=zzz-nobody-has-this");
    await expect(page.getByRole("heading", { level: 2, name: "No jobs match" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByText(/create invoice/i)).toHaveCount(0);
    await expectPageFits(page, "the empty Ready to invoice tab", 360);
  });
});

test.describe("the customer's job screens at the four widths", () => {
  for (const width of WIDTHS) {
    test(`work at ${String(width)} px: overview, list and every kind of job`, async ({ page }) => {
      const w = await world();
      await useViewport(page, width);
      await loginAs(page, w.customer);

      // ---- The overview, with its Upcoming visits -----------------------------------------------
      await page.goto("/portal");
      const visits = page.getByRole("region", { name: "Upcoming visits" });
      await expect(visits).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(visits).toContainText("With Jordan");
      await expectPageFits(page, "the overview", width);

      // ---- The list: upcoming and past, the long ones included -----------------------------------
      await page.goto("/portal/jobs");
      await expect(page.getByRole("list", { name: "Upcoming jobs" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(page.getByRole("list", { name: "Past jobs" })).toBeVisible();
      await expectPageFits(page, "the job list", width);

      // ---- Every kind of job ---------------------------------------------------------------------
      for (const [job, label] of [
        [w.scheduled, "a scheduled job"],
        [w.started, "a job under way"],
        [w.completed, "a completed job with a long summary"],
        [w.needs, "a job that needs a new time"],
        [w.cancelled, "a cancelled job"],
        [w.pending, "a job waiting for a time"],
      ] as const) {
        await openPortalJob(page, job);
        await expectPageFits(page, label, width);
      }

      // The long summary is shown whole, in the page, not cut off.
      await openPortalJob(page, w.completed);
      await expect(page.getByText(UNBROKEN).first()).toBeVisible();
    });
  }

  for (const width of WIDTHS) {
    test(`say what they mean when there is nothing to show, at ${String(width)} px`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const fresh = await createCustomerAccount({ name: "Nell Nothingyet" });
      await loginAs(page, fresh);

      await page.goto("/portal");
      await expect(page.getByRole("region", { name: "Upcoming visits" })).toContainText(
        "No visits are booked",
        { timeout: NAVIGATION_TIMEOUT },
      );
      await expectPageFits(page, "the overview with no jobs", width);

      await page.goto("/portal/jobs");
      await expect(
        page.getByRole("heading", { level: 2, name: "You don't have a job yet" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectPageFits(page, "the empty job list", width);

      await page.goto("/portal/jobs/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectPageFits(page, "a job that does not exist", width);

      await page.goto("/portal/jobs/not-an-id");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    });
  }
});
