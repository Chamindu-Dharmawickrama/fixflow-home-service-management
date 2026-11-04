import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createVisitWithStatus,
  createWaitingJobFor,
  dayOfWeek,
  ownWeek,
} from "../fixtures/calendar.js";
import { createBookedJobFor } from "../fixtures/jobs.js";
import {
  deleteTechniciansTagged,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { drawer, needsPanel, openCalendar, visitOf } from "./helpers/calendar.js";
import { dialogReady, fillSchedule } from "./helpers/jobs.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T19 screens at the four required widths, for the visual review recorded in
 * docs/IMPLEMENTATION_PROGRESS.md: the week at 1440 and 1024 px, the day at 768 px and the agenda at
 * 360 px, each with its drawer, the panel of jobs waiting for a time, the scheduling dialog with the
 * pre-check's warning, and an empty week. They are written to the git-ignored artifacts folder; the
 * tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t19");

async function shoot(page: Page, width: number, name: string): Promise<void> {
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

/** A busy, realistic week for three technicians: overlaps, an early start, a late finish, every status. */
async function busyWeek() {
  const monday = await ownWeek();
  const tag = newTechnicianTag();
  tags.push(tag);
  const jordan = await insertTechnician(tag, { name: `Jordan Lee ${tag}`, calendarColor: "blue" });
  const sam = await insertTechnician(tag, { name: `Sam Okafor ${tag}`, calendarColor: "green" });
  const casey = await insertTechnician(tag, {
    name: `Casey Brooks ${tag}`,
    calendarColor: "amber",
  });
  const [alex, priya, marcus, lena, owen] = await Promise.all(
    ["Avery Dalton", "Nadia Okoye", "Marcus Webb", "Lena Fischer", "Owen Clarke"].map((name) =>
      createCustomerAccount({ name }),
    ),
  );
  if (!alex || !priya || !marcus || !lena || !owen) throw new Error("setup");
  const d = (offset: number) => dayOfWeek(monday, offset);

  const moving = await createBookedJobFor(alex.id, jordan.id, d(1), "10:00", "12:00");
  await createBookedJobFor(priya.id, sam.id, d(1), "11:00", "13:30");
  await createBookedJobFor(marcus.id, casey.id, d(1), "08:00", "09:30");
  const blocker = await createBookedJobFor(lena.id, jordan.id, d(2), "13:00", "15:00");
  await createBookedJobFor(owen.id, sam.id, d(2), "06:30", "08:00");
  await createBookedJobFor(alex.id, casey.id, d(2), "10:00", "11:00");
  await createVisitWithStatus(priya.id, jordan.id, d(3), "09:00", "11:00", "IN_PROGRESS");
  await createVisitWithStatus(marcus.id, sam.id, d(3), "09:30", "10:30", "COMPLETED");
  await createBookedJobFor(lena.id, casey.id, d(3), "14:00", "16:30");
  await createBookedJobFor(owen.id, jordan.id, d(4), "10:00", "11:00");
  await createBookedJobFor(alex.id, sam.id, d(4), "10:30", "12:00");
  await createBookedJobFor(priya.id, casey.id, d(4), "10:00", "12:00");
  await createBookedJobFor(marcus.id, jordan.id, d(5), "09:00", "12:00");
  await createBookedJobFor(lena.id, sam.id, d(5), "19:00", "20:30");
  const waiting = await createWaitingJobFor(owen.id);
  return { monday, tag, jordan, moving, blocker, waiting };
}

const PICTURES = [
  { width: 1440, view: "week" },
  { width: 1024, view: "week" },
  { width: 768, view: "day" },
  { width: 360, view: "agenda" },
] as const;

for (const { width, view } of PICTURES) {
  test(`pictures of the calendar at ${String(width)} px (${view})`, async ({ page }) => {
    await useViewport(page, width);
    const w = await busyWeek();
    await loginAs(page, "admin");

    // The view the width chooses by itself (no view in the address), on a day with several visits.
    const date = view === "day" ? dayOfWeek(w.monday, 1) : w.monday;
    await openCalendar(page, `date=${date}`);
    await expect(
      page.locator(`[data-testid="${view === "agenda" ? "agenda" : "time-grid"}"]`),
    ).toBeVisible();
    await shoot(page, width, `${view}`);

    // The drawer for a visit.
    await visitOf(page, w.moving.jobReference).click();
    await expect(drawer(page, w.moving.jobReference)).toBeVisible();
    await shoot(page, width, "drawer");

    // The scheduling dialog, with the pre-check warning about a clash.
    await drawer(page, w.moving.jobReference).getByRole("button", { name: "Reschedule" }).click();
    const dialog = await dialogReady(page, `Jordan Lee ${w.tag}`);
    await fillSchedule(dialog, {
      date: dayOfWeek(w.monday, 2),
      time: "14:00",
      reason: "The customer asked for Wednesday.",
    });
    await expect(dialog.getByTestId("conflict-check")).toContainText(
      `Conflicts with ${w.blocker.jobReference}`,
      { timeout: NAVIGATION_TIMEOUT },
    );
    await shoot(page, width, "reschedule-conflict");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // The panel of jobs waiting for a time.
    await page.getByRole("button", { name: /^Needs scheduling/ }).click();
    await expect(needsPanel(page)).toBeVisible();
    await expect(needsPanel(page)).toContainText(w.waiting.jobReference);
    await shoot(page, width, "needs-scheduling");
  });
}

for (const width of [360, 1440] as const) {
  test(`picture of an empty week and the week of the other views at ${String(width)} px`, async ({
    page,
  }) => {
    await useViewport(page, width);
    const tag = newTechnicianTag();
    tags.push(tag);
    const nobody = await insertTechnician(tag, { name: `Quiet Technician ${tag}` });
    await loginAs(page, "admin");
    await openCalendar(page, `view=week&technician=${nobody.id}`);
    await expect(
      page.getByRole("heading", { level: 3, name: /^No visits scheduled/ }),
    ).toBeVisible();
    await shoot(page, width, "empty");
  });
}
