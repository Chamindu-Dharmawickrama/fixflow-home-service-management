import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createJobFor } from "../fixtures/customers.js";
import {
  createAcceptedQuotationFor,
  createBookedJobFor,
  ownTechnician,
  uniqueFutureDay,
  withDatabaseQuery,
} from "../fixtures/jobs.js";
import {
  deleteTechniciansTagged,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { dialogReady, fillSchedule, scheduleDialog } from "./helpers/jobs.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The states of the job screens (T17): the list, a job's page and the scheduling dialog at the four
 * required widths, with ordinary content and with content as long as the rules allow, axe-clean,
 * nothing scrolling sideways and the dialog inside the screen; and the screens that say there is
 * nothing to show. Each test makes customers and technicians of its own (the tests run in parallel
 * on one database) and removes only the technicians.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

/** One word of the full 100 characters a name may have: there is no space to break it at. */
function longNameFor(tag: string): string {
  return `${"W".repeat(100 - tag.length - 1)}-${tag}`;
}

async function toastsGone(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

/** The box of a dialog lies inside the viewport, with nothing cut off at either side. */
async function expectInsideScreen(page: Page, dialog: Locator, label: string): Promise<void> {
  // A dialog fades in: measured mid-way, its box is not where it will rest.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} has a box`).not.toBeNull();
  expect(box?.x ?? -1, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0), `${label} ends inside the screen`).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 0.5,
  );
}

/** A world with a job in each interesting state, every name as long as it may be. */
async function world() {
  const tag = newTechnicianTag();
  tags.push(tag);
  const day = uniqueFutureDay();
  const jordan = await ownTechnician(tag);
  const longTechnician = await insertTechnician(tag, {
    name: longNameFor(tag),
    calendarColor: "rose",
  });
  const customer = await createCustomerAccount({ name: longNameFor(tag) });
  const ordinary = await createCustomerAccount({ name: `Pat Ordinary ${tag}` });

  // A job waiting for a time, for an ordinary customer.
  const waiting = await createJobFor(ordinary.id, { status: "PENDING_SCHEDULING" });
  // A booked job whose customer, technician, scope and access notes are as long as they can be.
  const booked = await createBookedJobFor(customer.id, longTechnician.id, day, "10:00", "12:00");
  await withDatabaseQuery((prisma) =>
    prisma.workOrder.update({
      where: { id: booked.jobId },
      data: {
        scopeDescription: `${"S".repeat(300)}\n\nAgreed work:\n- ${"L".repeat(150)}`,
        accessNotesSnapshot: "A".repeat(200),
        addressLine1: "9".repeat(120),
      },
    }),
  );
  // Another job, booked with Jordan the same day, which a new visit can clash with.
  const other = await createCustomerAccount({ name: `Olive Owner ${tag}` });
  const clash = await createBookedJobFor(other.id, jordan.id, day, "10:00", "12:00");
  return { tag, day, customer, ordinary, waiting, booked, clash, longTechnician, jordan };
}

/** Opens the list narrowed to one run's customers, and waits for the table, or the cards on a phone. */
async function openListFor(page: Page, width: number, tag: string): Promise<void> {
  await page.goto(`/app/jobs?view=all&q=${tag}`);
  await expect(page.getByRole(width >= 1024 ? "table" : "list", { name: "Jobs" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
}

async function openJobPage(page: Page, id: string, reference: string): Promise<void> {
  await page.goto(`/app/jobs/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

test.describe("every screen at the four widths", () => {
  for (const width of WIDTHS) {
    test(`works at ${String(width)} px: no sideways scroll, axe-clean, the dialog inside the screen`, async ({
      page,
    }) => {
      const { tag, day, waiting, booked, jordan } = await world();
      await useViewport(page, width);
      await loginAs(page, "admin");

      // ---- The list, with an ordinary and a very long name ------------------------------------
      await openListFor(page, width, tag);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the list at ${String(width)} px`).toBe("");

      // ---- A job waiting for a time, and its scheduling dialog -------------------------------
      await openJobPage(page, waiting.jobId, waiting.jobReference);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `an unscheduled job at ${String(width)} px`).toBe("");

      const schedule = page.getByRole("button", { name: "Schedule", exact: true });
      await expectHydrated(schedule);
      await schedule.click();
      const dialog = await dialogReady(page, `${"W".repeat(100 - tag.length - 1)}-${tag}`);
      await expectInsideScreen(page, dialog, "the scheduling dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the scheduling dialog at ${String(width)} px`,
      ).toBe("");

      // Filled: the very long technician chosen, their day and the pre-check shown.
      await fillSchedule(dialog, { date: day, time: "13:00", technician: longNameFor(tag) });
      await expect(dialog.getByText("is free at that time.")).toBeVisible();
      await expect(dialog.getByRole("region", { name: /other jobs that day$/ })).toContainText(
        "JOB-",
      );
      await expectInsideScreen(page, dialog, "the filled scheduling dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the filled scheduling dialog at ${String(width)} px`,
      ).toBe("");

      // A clash with the long-named technician's own visit, before and after saving it.
      await fillSchedule(dialog, { time: "11:00" });
      await expect(dialog.getByTestId("conflict-check")).toContainText("Conflicts with JOB-");
      await dialog.getByRole("button", { name: "Schedule visit" }).click();
      await expect(dialog.getByRole("alert")).toContainText("is already booked for JOB-");
      await expectInsideScreen(page, dialog, "the dialog with a refusal");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the dialog with a refusal at ${String(width)} px`,
      ).toBe("");
      await page.keyboard.press("Escape");
      await expect(scheduleDialog(page)).toBeHidden();

      // ---- A booked job with every field as long as it can be ---------------------------------
      await openJobPage(page, booked.jobId, booked.jobReference);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `a long job at ${String(width)} px`).toBe("");

      // ---- Its reschedule dialog, with a reason as long as it may be -------------------------
      const reschedule = page.getByRole("button", { name: "Reschedule", exact: true });
      await expectHydrated(reschedule);
      await reschedule.click();
      const move = await dialogReady(page, jordan.name);
      await expectInsideScreen(page, move, "the reschedule dialog");
      await move.getByLabel(/^Reason for moving it/).fill("r".repeat(200));
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the reschedule dialog at ${String(width)} px`,
      ).toBe("");
      // Asking with no technician chosen shows the message beside the field, inside the screen.
      await move.getByLabel(/^Reason for moving it/).fill("");
      await move.getByRole("button", { name: "Reschedule visit" }).click();
      await expect(move.getByText(/Enter a reason of 5 to 200 characters/)).toBeVisible();
      await expectInsideScreen(page, move, "the reschedule dialog with a message");
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the reschedule dialog with a message at ${String(width)} px`,
      ).toBe("");
      await page.keyboard.press("Escape");
      await expect(scheduleDialog(page)).toBeHidden();
      await toastsGone(page);
    });

    test(`the request page offers 'Create job' at ${String(width)} px, and fits`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const customer = await createCustomerAccount({ name: "Wren Width" });
      const { request } = await createAcceptedQuotationFor(customer.id);
      await loginAs(page, "admin");
      await page.goto(`/app/requests/${request.id}`);
      const create = page.getByRole("button", { name: "Create job", exact: true });
      await expect(create).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectHydrated(create);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the request page at ${String(width)} px`).toBe("");

      // The accepted quotation's page offers it too.
      const quotationLink = page.getByRole("link", { name: /^QT-/ }).first();
      await quotationLink.click();
      await expect(page.getByRole("button", { name: "Create job", exact: true })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the quotation page at ${String(width)} px`).toBe("");
    });
  }
});

test.describe("the screens that have nothing to show", () => {
  for (const width of WIDTHS) {
    test(`say so clearly at ${String(width)} px`, async ({ page }) => {
      await useViewport(page, width);
      await loginAs(page, "admin");

      // A search that finds nothing.
      await page.goto("/app/jobs?view=all&q=zzz-nobody-has-this");
      await expect(page.getByRole("heading", { level: 2, name: "No jobs match" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `no match at ${String(width)} px`).toBe("");

      // A page past the end of a list that has jobs on it (the database always holds some by now).
      await page.goto("/app/jobs?view=all&page=999");
      await expect(
        page.getByRole("heading", { level: 2, name: /There is nothing on this page|No jobs yet/ }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `past the end at ${String(width)} px`).toBe("");

      // A job that does not exist.
      await page.goto("/app/jobs/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `a missing job at ${String(width)} px`).toBe("");

      // Something that is not an id.
      await page.goto("/app/jobs/not-an-id");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    });
  }
});
