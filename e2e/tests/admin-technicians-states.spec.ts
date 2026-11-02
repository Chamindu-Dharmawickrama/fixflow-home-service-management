import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  assignJob,
  deleteTechniciansTagged,
  inDays,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The states of the technician screens (T16): the list, a technician's page, the add and edit sheet
 * and the deactivate dialog at the four required widths, with ordinary content and with content that
 * is as long as the rules allow, axe-clean, with nothing scrolling sideways and every dialog inside
 * the screen; and the screens that say there is nothing to show. Each test makes technicians of its
 * own (the tests run in parallel on one database) and removes only those.
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

async function worldWithJobs() {
  const tag = newTechnicianTag();
  tags.push(tag);
  const customer = await createCustomerAccount({ name: `Pat Customer ${tag}` });
  const ordinary = await insertTechnician(tag, {
    name: `Casey Brooks ${tag}`,
    specialties: ["Air conditioning", "Heat pumps", "Diagnostics"],
    notes: "Takes the early visits.\nCarries the common parts.",
    calendarColor: "teal",
  });
  const long = await insertTechnician(tag, {
    name: longNameFor(tag),
    email: `${"e".repeat(60)}.${tag}@${"d".repeat(60)}.coolbreeze.test`,
    phone: "+44 20 7946 0958",
    specialties: Array.from({ length: 8 }, (_, i) => `${String(i)}${"s".repeat(39)}`),
    notes: `${"W".repeat(500)}\n${"A long note. ".repeat(60)}`.slice(0, 1000),
    calendarColor: "rose",
  });
  await assignJob(ordinary.id, customer.id, inDays(1));
  await assignJob(ordinary.id, customer.id, inDays(2));
  await assignJob(long.id, customer.id, inDays(3));
  return { tag, ordinary, long };
}

/** Opens the list narrowed to one run's technicians, and waits for the table, or the cards on a phone. */
async function openListFor(page: Page, width: number, tag: string): Promise<void> {
  await page.goto(`/app/technicians?active=all&q=${tag}`);
  await expect(
    page.getByRole(width >= 1024 ? "table" : "list", { name: "Technicians" }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(page.getByRole("button", { name: "Add technician" }));
}

async function openDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/app/technicians/${id}`);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("button", { name: "Edit", exact: true }));
}

/** Waits for the toasts to leave: one mid-animation is measured at the wrong size and colour. */
async function toastsGone(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

/** The box of a dialog lies inside the viewport, with nothing cut off at either side. */
async function expectInsideScreen(page: Page, dialog: Locator, label: string): Promise<void> {
  // A sheet slides in and a dialog fades in: measured mid-way, its box is not where it will rest.
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

test.describe("every screen at the four widths", () => {
  for (const width of WIDTHS) {
    test(`works at ${String(width)} px: no sideways scroll, axe-clean, dialogs inside the screen`, async ({
      page,
    }) => {
      const { tag, ordinary, long } = await worldWithJobs();
      await useViewport(page, width);
      await loginAs(page, "admin");

      // ---- The list, with an ordinary and a very long technician -------------------------------
      await openListFor(page, width, tag);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the list at ${String(width)} px`).toBe("");

      // ---- A technician with jobs coming up ---------------------------------------------------
      await openDetail(page, ordinary.id);
      await expect(
        page.getByRole(width >= 768 ? "table" : "list", {
          name: `Upcoming jobs for ${ordinary.name}`,
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `a technician at ${String(width)} px`).toBe("");

      // ---- One whose every field is as long as it can be --------------------------------------
      await openDetail(page, long.id);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `a long technician at ${String(width)} px`).toBe("");

      // ---- The edit sheet, full of long values ------------------------------------------------
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const editSheet = page.getByRole("dialog", { name: `Edit ${long.name}` });
      await expect(editSheet).toBeVisible();
      await expect(editSheet.getByLabel(/^Name/)).toBeFocused();
      await expectInsideScreen(page, editSheet, "the edit sheet");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the edit sheet at ${String(width)} px`,
      ).toBe("");
      // Every control is reachable by scrolling the sheet, and none is cut off at the side.
      for (const control of [
        editSheet.getByLabel("Phone number"),
        editSheet.getByLabel("Email address"),
        editSheet.getByLabel("Notes"),
        editSheet.getByRole("button", { name: "Save changes" }),
      ]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
      }
      await page.keyboard.press("Escape");
      await expect(editSheet).toBeHidden();

      // ---- The deactivate dialog, with the long name in its title and its sentence ------------
      await page.getByRole("button", { name: "Deactivate" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText("1 upcoming job. It stays assigned");
      await expectInsideScreen(page, confirm, "the deactivate dialog");
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=alertdialog]"),
        `the deactivate dialog at ${String(width)} px`,
      ).toBe("");
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toBeHidden();

      // ---- The add sheet from the list, filled with the longest values the rules allow ---------
      await openListFor(page, width, tag);
      await page.getByRole("button", { name: "Add technician" }).click();
      const addSheet = page.getByRole("dialog", { name: "Add technician" });
      await expect(addSheet).toBeVisible();
      await expectInsideScreen(page, addSheet, "the add sheet");
      await addSheet.getByLabel(/^Name/).fill(longNameFor(tag));
      await addSheet.getByLabel("Add a specialty").fill("x".repeat(40));
      await addSheet.getByLabel("Add a specialty").press("Enter");
      await addSheet.getByLabel("Notes").fill("n".repeat(1000));
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page, "[role=dialog]"),
        `the add sheet at ${String(width)} px`,
      ).toBe("");

      // Saving it lands on the new technician's page, which fits the screen too.
      await addSheet.getByRole("button", { name: "Add technician" }).click();
      await page.waitForURL(/\/app\/technicians\/[0-9a-f-]{36}$/, { timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await toastsGone(page);
      await expectNoHorizontalOverflow(page);
      expect(
        await seriousViolations(page),
        `the page of a technician just added at ${String(width)} px`,
      ).toBe("");
    });
  }
});

test.describe("the screens that have nothing to show", () => {
  for (const width of WIDTHS) {
    test(`say so clearly at ${String(width)} px`, async ({ page }) => {
      await useViewport(page, width);
      await loginAs(page, "admin");

      // A search that finds nobody.
      await page.goto("/app/technicians?active=all&q=zzz-nobody-has-this");
      await expect(
        page.getByRole("heading", { level: 2, name: "No technicians match" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `no match at ${String(width)} px`).toBe("");

      // A page past the end of a list that has people on it.
      await page.goto("/app/technicians?active=all&page=999");
      await expect(
        page.getByRole("heading", { level: 2, name: "There is nothing on this page" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByText(/Everyone is inactive/)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `past the end at ${String(width)} px`).toBe("");

      // A technician that does not exist.
      await page.goto("/app/technicians/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that technician" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `not found at ${String(width)} px`).toBe("");
    });
  }

  test("an inactive technician with nothing coming up shows seven free days and an empty list of jobs", async ({
    page,
  }) => {
    const tag = newTechnicianTag();
    tags.push(tag);
    const idle = await insertTechnician(tag, { name: `Idle Person ${tag}`, isActive: false });
    await useViewport(page, 1024);
    await loginAs(page, "admin");

    await openDetail(page, idle.id);

    await expect(page.getByText("Free", { exact: true })).toHaveCount(7);
    await expect(page.getByRole("heading", { level: 3, name: "No upcoming jobs" })).toBeVisible();
    // Inactive: said in words, with the way back.
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Idle is inactive, so they are not offered for new jobs/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
    expect(await seriousViolations(page), "an inactive technician").toBe("");
  });
});
