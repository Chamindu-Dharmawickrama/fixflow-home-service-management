import { addDaysToDateOnly } from "@fixflow/shared";
import { expect, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createVisitWithStatus,
  createWaitingJobFor,
  dayOfWeek,
  extendPastMidnight,
  ownWeek,
} from "../fixtures/calendar.js";
import {
  createBookedJobFor,
  instantAt,
  ownTechnician,
  withDatabaseQuery,
  workOrderById,
} from "../fixtures/jobs.js";
import {
  deleteTechniciansTagged,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  blocks,
  calendarRegion,
  cards,
  dayList,
  drawer,
  longDate,
  needsPanel,
  openCalendar,
  overlaps,
  topOffsetFromHourRow,
  visitOf,
} from "./helpers/calendar.js";
import { conflictCheck, dialogReady, fillSchedule, scheduleDialog, toast } from "./helpers/jobs.js";
import { NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * The scheduling calendar (T19, FR-052, FR-053, BR-17, UX-QB-CAL). Every test makes the customers and
 * technicians it needs, books them in a week of its own (the calendar is the whole business's, see
 * `fixtures/calendar.ts`) and removes the technicians afterwards. The first group runs with the
 * browser set to zones far from the business's, because the point of the screen is that a 10:00
 * visit on the business's clocks is in the 10:00 row whoever is looking and from wherever.
 */

test.describe.configure({ timeout: 240_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

function newTag(): string {
  const tag = newTechnicianTag();
  tags.push(tag);
  return tag;
}

// ---- Where a visit is drawn, wherever the browser is -------------------------------------------------

for (const timezoneId of ["Asia/Colombo", "Pacific/Kiritimati", "America/Los_Angeles"]) {
  test.describe(`with the browser set to ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("draws a 10:00 visit in the 10:00 row, a late one late and an early one early", async ({
      page,
    }) => {
      await useViewport(page, 1440);
      const monday = await ownWeek();
      const tag = newTag();
      const jordan = await ownTechnician(tag);
      const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
      const tuesday = dayOfWeek(monday, 1);
      const wednesday = dayOfWeek(monday, 2);
      const thursday = dayOfWeek(monday, 3);
      const morning = await createBookedJobFor(alex.id, jordan.id, tuesday, "10:00", "12:00");
      const evening = await createBookedJobFor(alex.id, jordan.id, wednesday, "21:00", "22:30");
      const early = await createBookedJobFor(alex.id, jordan.id, thursday, "06:00", "07:30");

      await loginAs(page, "admin");
      await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

      // The 10:00 visit is in Tuesday's list, minute 600 of its day, and in the 10:00 row of the grid.
      const block = dayList(page, tuesday).getByRole("button", {
        name: new RegExp(morning.jobReference),
      });
      await expect(block).toHaveAttribute("data-start-minute", "600");
      await expect(block).toContainText("10:00 AM – 12:00 PM");
      expect(Math.abs(await topOffsetFromHourRow(page, block, 10))).toBeLessThan(1.5);

      // Its name says the same time, on the business's clocks.
      await expect(block).toHaveAccessibleName(
        new RegExp(
          `^Tuesday 10:00 AM – 12:00 PM ${morning.jobReference} AC Routine Maintenance Avery Dalton`,
        ),
      );

      // 21:00 is 9 PM on the business's clocks, though it is already tomorrow in UTC and, here, elsewhere.
      const late = dayList(page, wednesday).getByRole("button", {
        name: new RegExp(evening.jobReference),
      });
      await expect(late).toHaveAttribute("data-start-minute", String(21 * 60));
      expect(Math.abs(await topOffsetFromHourRow(page, late, 21))).toBeLessThan(1.5);

      // The early and the late visits widen the grid to take them in: 6 AM to 10 PM.
      const early6 = dayList(page, thursday).getByRole("button", {
        name: new RegExp(early.jobReference),
      });
      await expect(early6).toHaveAttribute("data-start-minute", String(6 * 60));
      await expect(page.locator('[data-hour="6"]').first()).toContainText("6 AM");
      await expect(page.locator('[data-hour="22"]').first()).toContainText("10 PM");
      await expect(page.locator('[data-hour="5"]')).toHaveCount(0);
      await expect(page.locator('[data-hour="23"]')).toHaveCount(0);

      // The agenda says the same times and the same days.
      await openCalendar(page, `view=agenda&date=${monday}&technician=${jordan.id}`);
      const agendaDay = page.getByRole("list", { name: /^Tuesday, Jan|^Tuesday, / }).first();
      await expect(agendaDay).toContainText("10:00 AM – 12:00 PM");
      await expect(cards(page)).toHaveCount(3);
    });
  });
}

// ---- The weeks the clocks change ---------------------------------------------------------------------

test.describe("in the weeks the clocks change", () => {
  test.use({ timezoneId: "Asia/Colombo" });

  test("keeps visits in the same hour row in the weeks the clocks go forward and back", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const tag = newTag();
    const jordan = await ownTechnician(tag);
    const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
    await loginAs(page, "admin");

    // New York's clocks go forward on Sunday 14 March 2027 and back on Sunday 7 November 2027.
    for (const [monday, changeAt] of [
      ["2027-03-08", "2027-03-14"],
      ["2027-11-01", "2027-11-07"],
    ] as const) {
      const saturday = addDaysToDateOnly(changeAt, -1);
      const [before, onDay, evening] = await Promise.all([
        createBookedJobFor(alex.id, jordan.id, saturday, "10:00", "12:00"),
        createBookedJobFor(alex.id, jordan.id, changeAt, "10:00", "12:00"),
        createBookedJobFor(alex.id, jordan.id, changeAt, "21:00", "22:00"),
      ]);

      // The same wall-clock hour is a different UTC instant on either side of the change.
      const [savedBefore, savedOn] = await Promise.all([
        workOrderById(before.jobId),
        workOrderById(onDay.jobId),
      ]);
      expect(savedBefore.scheduledStart?.toISOString().slice(11, 16)).not.toBe(
        savedOn.scheduledStart?.toISOString().slice(11, 16),
      );

      await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);
      await expect(blocks(page)).toHaveCount(3);
      for (const [job, date, minute, hour] of [
        [before, saturday, 600, 10],
        [onDay, changeAt, 600, 10],
        [evening, changeAt, 1260, 21],
      ] as const) {
        const block = dayList(page, date).getByRole("button", {
          name: new RegExp(job.jobReference),
        });
        await expect(block, `${job.jobReference} on ${date}`).toHaveAttribute(
          "data-start-minute",
          String(minute),
        );
        expect(Math.abs(await topOffsetFromHourRow(page, block, hour))).toBeLessThan(1.5);
      }
      // Seven day columns, whatever the length of the day.
      await expect(calendarRegion(page).getByRole("heading", { level: 3 })).toHaveCount(7);
    }
  });
});

// ---- Moving through time and filtering ---------------------------------------------------------------

test("moves by week and by day, jumps to a date, and filters by technician, all kept in the address", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const nextMonday = addDaysToDateOnly(monday, 7);
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const sam = await insertTechnician(tag, { name: `Sam Ortiz ${tag}`, calendarColor: "green" });
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const jordansTuesday = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(monday, 1),
    "10:00",
    "12:00",
  );
  const samsWednesday = await createBookedJobFor(
    alex.id,
    sam.id,
    dayOfWeek(monday, 2),
    "13:00",
    "14:00",
  );
  const jordansNextWeek = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(nextMonday, 0),
    "09:00",
    "10:00",
  );
  await loginAs(page, "admin");

  await openCalendar(page, `view=week&date=${dayOfWeek(monday, 2)}`);
  // The heading names the week, and the region is named by it.
  const heading = calendarRegion(page).getByRole("heading", { level: 2 });
  await expect(heading).toHaveText(/ – .*\d{4}$/);
  const thisWeek = await heading.innerText();
  await expect(visitOf(page, jordansTuesday.jobReference)).toBeVisible();
  await expect(visitOf(page, samsWednesday.jobReference)).toBeVisible();
  await expect(visitOf(page, jordansNextWeek.jobReference)).toHaveCount(0);

  // The legend names the colours of the technicians.
  const legend = page.getByRole("list", { name: "Technician colours" });
  await expect(legend).toContainText(`Jordan Lee ${tag}`);
  await expect(legend).toContainText(`Sam Ortiz ${tag}`);

  // Next week: the address changes, the heading changes, and the other week's visit appears.
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${dayOfWeek(nextMonday, 2)}`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(visitOf(page, jordansNextWeek.jobReference)).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(visitOf(page, jordansTuesday.jobReference)).toHaveCount(0);
  await expect(heading).not.toHaveText(thisWeek);

  await page.getByRole("link", { name: "Previous week" }).click();
  await expect(visitOf(page, jordansTuesday.jobReference)).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // One technician's calendar: the choice is in the address and the other's visit goes.
  await page
    .getByRole("combobox", { name: "Technician" })
    .selectOption({ label: `Sam Ortiz ${tag}` });
  await expect(page).toHaveURL(new RegExp(`technician=${sam.id}`), { timeout: NAVIGATION_TIMEOUT });
  await expect(visitOf(page, samsWednesday.jobReference)).toBeVisible();
  await expect(visitOf(page, jordansTuesday.jobReference)).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Technician" })
    .selectOption({ label: "All technicians" });
  await expect(visitOf(page, jordansTuesday.jobReference)).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page).not.toHaveURL(/technician=/);

  // Day view: a single day, stepped a day at a time.
  await page
    .getByRole("navigation", { name: "Calendar view" })
    .getByRole("link", { name: "Day" })
    .click();
  await expect(page).toHaveURL(/view=day/, { timeout: NAVIGATION_TIMEOUT });
  await expect(heading).toHaveText(longDate(dayOfWeek(monday, 2)), { timeout: NAVIGATION_TIMEOUT });
  await expect(visitOf(page, samsWednesday.jobReference)).toBeVisible();
  await expect(visitOf(page, jordansTuesday.jobReference)).toHaveCount(0);
  await page.getByRole("link", { name: "Previous day" }).click();
  await expect(heading).toHaveText(longDate(dayOfWeek(monday, 1)), { timeout: NAVIGATION_TIMEOUT });
  await expect(visitOf(page, jordansTuesday.jobReference)).toBeVisible();

  // The date picker jumps to any date.
  await page.getByLabel("Go to date").fill(dayOfWeek(nextMonday, 0));
  await expect(heading).toHaveText(longDate(dayOfWeek(nextMonday, 0)), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(visitOf(page, jordansNextWeek.jobReference)).toBeVisible();

  // "Today" drops the date from the address and marks today's column.
  await page
    .getByRole("navigation", { name: "Calendar view" })
    .getByRole("link", { name: "Week" })
    .click();
  await expect(page).toHaveURL(/view=week/, { timeout: NAVIGATION_TIMEOUT });
  await expect(heading).toHaveText(/ – .*\d{4}$/, { timeout: NAVIGATION_TIMEOUT });
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page).not.toHaveURL(/date=/, { timeout: NAVIGATION_TIMEOUT });
  // Today's week is drawn: today's column is marked, or (when nothing is booked this week) the empty
  // state says "this week". Either way it is not the week we were looking at.
  await expect(
    calendarRegion(page).locator(
      'h3[aria-current="date"], h3:has-text("No visits scheduled this week")',
    ),
  ).toHaveCount(1);
  await expect(heading).not.toHaveText(longDate(dayOfWeek(nextMonday, 0)));
  await expect(visitOf(page, jordansNextWeek.jobReference)).toHaveCount(0);

  // Opening the address by hand lands on the same screen.
  await openCalendar(page, `view=day&date=${dayOfWeek(monday, 2)}&technician=${sam.id}`);
  await expect(visitOf(page, samsWednesday.jobReference)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Technician" })).toHaveValue(sam.id);
  await expect(
    page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Day" }),
  ).toHaveAttribute("aria-current", "page");
});

// ---- Overlapping visits ------------------------------------------------------------------------------

test("lays visits of different technicians at the same time side by side, without overlapping", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const sam = await insertTechnician(tag, { name: `Sam Ortiz ${tag}`, calendarColor: "green" });
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const day = dayOfWeek(monday, 2);
  const first = await createBookedJobFor(alex.id, jordan.id, day, "10:00", "12:00");
  const second = await createBookedJobFor(alex.id, sam.id, day, "11:00", "13:00");
  const third = await createBookedJobFor(alex.id, sam.id, day, "15:00", "16:00");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}`);

  const [a, b, c] = await Promise.all(
    [first, second, third].map((job) => visitOf(page, job.jobReference).boundingBox()),
  );
  if (!a || !b || !c) throw new Error("the blocks have boxes");
  expect(overlaps(a, b), "the two overlapping visits do not cover each other").toBe(false);
  // Side by side: the same top row of the grid does not matter, the columns do.
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  // Each takes half of its day's column; the lone visit takes the whole of it.
  expect(c.width).toBeGreaterThan(a.width * 1.8);
  // Their text is their own: no line is wider than its block.
  for (const job of [first, second]) {
    const clipped = await visitOf(page, job.jobReference).evaluate((element) =>
      [...element.querySelectorAll("span")].some(
        (span) => span.getBoundingClientRect().right > element.getBoundingClientRect().right + 1,
      ),
    );
    expect(clipped, `${job.jobReference}'s text stays inside its block`).toBe(false);
  }

  // The day view split by technician shows them in a column each.
  await page.goto(`/app/calendar?view=day&date=${day}&split=1`);
  await expect(
    page.getByRole("heading", { level: 3, name: new RegExp(`Jordan Lee ${tag}`) }),
  ).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(
    page.getByRole("heading", { level: 3, name: new RegExp(`Sam Ortiz ${tag}`) }),
  ).toBeVisible();
  const [left, right] = await Promise.all(
    [first, second].map((job) => visitOf(page, job.jobReference).boundingBox()),
  );
  if (!left || !right) throw new Error("the blocks have boxes");
  expect(left.x).toBeLessThan(right.x);
  expect(overlaps(left, right)).toBe(false);
});

// ---- Statuses, and visits that cross midnight --------------------------------------------------------

test("shows every status in words and with an icon, and a visit past midnight on both days", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const day = dayOfWeek(monday, 1);
  const scheduled = await createBookedJobFor(alex.id, jordan.id, day, "08:00", "09:00");
  const underWay = await createVisitWithStatus(
    alex.id,
    jordan.id,
    day,
    "09:00",
    "10:00",
    "IN_PROGRESS",
  );
  const done = await createVisitWithStatus(alex.id, jordan.id, day, "10:00", "11:00", "COMPLETED");
  const overnight = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(monday, 3),
    "23:00",
    "23:30",
  );
  await extendPastMidnight(overnight.jobId, dayOfWeek(monday, 4), "01:00");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  await expect(visitOf(page, scheduled.jobReference)).toHaveAccessibleName(/, Scheduled$/);
  await expect(visitOf(page, underWay.jobReference)).toHaveAccessibleName(/, In progress$/);
  await expect(visitOf(page, done.jobReference)).toHaveAccessibleName(/, Completed$/);
  for (const job of [scheduled, underWay, done]) {
    // The icon is part of the block, and the legend explains each.
    await expect(visitOf(page, job.jobReference).locator("svg")).toHaveCount(1);
  }
  const statusKey = page.getByRole("list", { name: "Status icons" });
  await expect(statusKey).toContainText("Scheduled");
  await expect(statusKey).toContainText("In progress");
  await expect(statusKey).toContainText("Completed");

  // A visit that runs past midnight has a block on each day, clipped at midnight.
  const both = visitOf(page, overnight.jobReference);
  await expect(both).toHaveCount(2);
  const onThursday = dayList(page, dayOfWeek(monday, 3)).getByRole("button", {
    name: new RegExp(overnight.jobReference),
  });
  const onFriday = dayList(page, dayOfWeek(monday, 4)).getByRole("button", {
    name: new RegExp(overnight.jobReference),
  });
  await expect(onThursday).toHaveAttribute("data-start-minute", String(23 * 60));
  await expect(onThursday).toHaveAttribute("data-end-minute", "1440");
  await expect(onFriday).toHaveAttribute("data-start-minute", "0");
  await expect(onFriday).toHaveAttribute("data-end-minute", "60");
  // The grid reaches midnight at both ends so neither part is cut off.
  await expect(page.locator('[data-hour="0"]').first()).toContainText("12 AM");
  await expect(page.locator('[data-hour="23"]').first()).toContainText("11 PM");
  await expect(onThursday).toHaveAccessibleName(
    /^Thursday [A-Z][a-z]{2} \d+, 11:00 PM – [A-Z][a-z]{2} \d+, 1:00 AM JOB-/,
  );
});

// ---- The drawer --------------------------------------------------------------------------------------

test("opens a drawer from a block with the keyboard, links to the job, and gives focus back", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const job = await createBookedJobFor(alex.id, jordan.id, dayOfWeek(monday, 1), "10:00", "12:00");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  const block = visitOf(page, job.jobReference);
  await block.focus();
  await page.keyboard.press("Enter");

  const panel = drawer(page, job.jobReference);
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-status]")).toHaveText("Scheduled");
  await expect(panel).toContainText(`Avery Dalton ${tag}`);
  await expect(panel).toContainText(`Jordan Lee ${tag}`);
  await expect(panel).toContainText("AC Routine Maintenance");
  await expect(panel).toContainText("10:00 AM – 12:00 PM");
  await expect(panel).toContainText(/ E[SD]T/);
  await expect(panel.getByRole("link", { name: /Open the job/ })).toHaveAttribute(
    "href",
    `/app/jobs/${job.jobId}`,
  );
  await expect(panel.getByRole("button", { name: "Reschedule" })).toBeVisible();

  // Escape closes it and focus is back on the block that opened it.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(block).toBeFocused();

  // It opens from a click too, and from an agenda card.
  await block.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect(block).toBeFocused();

  await openCalendar(page, `view=agenda&date=${monday}&technician=${jordan.id}`);
  const card = cards(page).filter({ hasText: job.jobReference });
  await card.click();
  await expect(drawer(page, job.jobReference)).toBeVisible();
  await drawer(page, job.jobReference)
    .getByRole("link", { name: /Open the job/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.jobId}$`), {
    timeout: NAVIGATION_TIMEOUT,
  });
});

test("does not offer Reschedule for a visit that is already under way or done", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const day = dayOfWeek(monday, 1);
  const underWay = await createVisitWithStatus(
    alex.id,
    jordan.id,
    day,
    "09:00",
    "10:00",
    "IN_PROGRESS",
  );
  const done = await createVisitWithStatus(alex.id, jordan.id, day, "10:00", "11:00", "COMPLETED");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  for (const job of [underWay, done]) {
    await visitOf(page, job.jobReference).click();
    const panel = drawer(page, job.jobReference);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: /Open the job/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
});

// ---- Rescheduling from the calendar ------------------------------------------------------------------

test("reschedules a visit from the drawer: states the move, needs a reason, saves, refreshes and keeps focus", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const tuesday = dayOfWeek(monday, 1);
  const thursday = dayOfWeek(monday, 3);
  const job = await createBookedJobFor(alex.id, jordan.id, tuesday, "10:00", "12:00");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  await visitOf(page, job.jobReference).click();
  await drawer(page, job.jobReference).getByRole("button", { name: "Reschedule" }).click();

  const dialog = await dialogReady(page, `Jordan Lee ${tag}`);
  await expect(dialog).toBeVisible();
  await expect(drawer(page, job.jobReference)).toHaveCount(0);
  // It starts from the visit's own time, and says nothing about a move until there is one.
  await expect(dialog.getByLabel(/^Date/)).toHaveValue(tuesday);
  await expect(dialog.getByLabel(/^Start time/)).toHaveValue("10:00");
  await expect(dialog.getByTestId("move-summary")).toHaveCount(0);

  await fillSchedule(dialog, { date: thursday, time: "14:00" });
  const summary = dialog.getByTestId("move-summary");
  await expect(summary).toContainText(`Move ${job.jobReference} from`);
  await expect(summary).toContainText("10:00 AM – 12:00 PM");
  await expect(summary).toContainText("2:00 – 4:00 PM");
  await expect(summary).toContainText(/ to Thu, /);
  await expect(conflictCheck(dialog)).toContainText("is free at that time");

  // A move needs a reason.
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();
  await expect(dialog.getByText(/Enter a reason of 5 to 200 characters/)).toBeVisible();
  expect((await workOrderById(job.jobId)).scheduledStart).toEqual(instantAt(tuesday, "10:00"));

  await fillSchedule(dialog, { reason: "The part arrives on Thursday." });
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();

  await expect(scheduleDialog(page)).toHaveCount(0, { timeout: NAVIGATION_TIMEOUT });
  await expect(toast(page, `${job.jobReference} moved`)).toBeVisible();
  // The calendar refreshed: the visit left Tuesday and is on Thursday at 14:00, in the 14:00 row.
  const moved = dayList(page, thursday).getByRole("button", {
    name: new RegExp(job.jobReference),
  });
  await expect(moved).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(moved).toHaveAttribute("data-start-minute", String(14 * 60));
  await expect(dayList(page, tuesday).getByRole("button")).toHaveCount(0);
  // Focus is on the visit that was changed, not lost.
  await expect(moved).toBeFocused();

  const saved = await workOrderById(job.jobId);
  expect(saved.scheduledStart).toEqual(instantAt(thursday, "14:00"));
  expect(saved.scheduledEnd).toEqual(instantAt(thursday, "16:00"));
  expect(saved.status).toBe("SCHEDULED");
});

test("shows the server's refusal when a move clashes, keeps what was typed, and leaves the visit where it was", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const priya = await createCustomerAccount({ name: `Nadia Okoye ${tag}` });
  const tuesday = dayOfWeek(monday, 1);
  const wednesday = dayOfWeek(monday, 2);
  const mover = await createBookedJobFor(alex.id, jordan.id, tuesday, "10:00", "12:00");
  const blocker = await createBookedJobFor(priya.id, jordan.id, wednesday, "10:00", "12:00");
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  await visitOf(page, mover.jobReference).click();
  await drawer(page, mover.jobReference).getByRole("button", { name: "Reschedule" }).click();
  const dialog = await dialogReady(page, `Jordan Lee ${tag}`);
  await fillSchedule(dialog, {
    date: wednesday,
    time: "11:00",
    reason: "The customer asked for Wednesday.",
  });

  // The pre-check already warns, naming the job in the way.
  await expect(conflictCheck(dialog)).toContainText(`Conflicts with ${blocker.jobReference}`, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(dialog.getByTestId("move-summary")).toBeVisible();

  // Saving anyway is refused by the server, which says which job it collided with.
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText(blocker.jobReference, { timeout: NAVIGATION_TIMEOUT });
  await expect(alert).toContainText("Your entries are kept");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Date/)).toHaveValue(wednesday);
  await expect(dialog.getByLabel(/^Start time/)).toHaveValue("11:00");
  await expect(dialog.getByLabel(/^Reason for moving it/)).toHaveValue(
    "The customer asked for Wednesday.",
  );
  expect((await workOrderById(mover.jobId)).scheduledStart).toEqual(instantAt(tuesday, "10:00"));

  // Cancel: the calendar is as it was, and focus is back on the visit.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(scheduleDialog(page)).toHaveCount(0);
  const stillThere = dayList(page, tuesday).getByRole("button", {
    name: new RegExp(mover.jobReference),
  });
  await expect(stillThere).toHaveAttribute("data-start-minute", String(10 * 60));
  await expect(stillThere).toBeFocused();

  // Another time works, and the page then shows it.
  await stillThere.click();
  await drawer(page, mover.jobReference).getByRole("button", { name: "Reschedule" }).click();
  const again = await dialogReady(page, `Jordan Lee ${tag}`);
  await fillSchedule(again, {
    date: wednesday,
    time: "12:00",
    reason: "Just after the other job.",
  });
  await again.getByRole("button", { name: "Reschedule visit" }).click();
  await expect(scheduleDialog(page)).toHaveCount(0, { timeout: NAVIGATION_TIMEOUT });
  await expect(
    dayList(page, wednesday).getByRole("button", { name: new RegExp(mover.jobReference) }),
  ).toHaveAttribute("data-start-minute", String(12 * 60), { timeout: NAVIGATION_TIMEOUT });
});

// ---- Jobs waiting for a time -------------------------------------------------------------------------

test("lists the jobs waiting for a time and schedules one from the panel with the same dialog", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const quinn = await createCustomerAccount({ name: `Quinn Quotable ${tag}` });
  const waiting = await createWaitingJobFor(quinn.id);
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  // The week is empty for Jordan, and the calendar says what is waiting.
  await expect(page.getByRole("heading", { level: 3, name: /^No visits scheduled/ })).toBeVisible();
  const open = page.getByRole("button", { name: /^Needs scheduling/ });
  await open.click();

  const panel = needsPanel(page);
  await expect(panel).toBeVisible();
  const entry = panel.getByTestId("waiting-job").filter({ hasText: waiting.jobReference });
  await expect(entry).toContainText(`Quinn Quotable ${tag}`);
  await expect(entry).toContainText("Pending scheduling");

  await entry.getByRole("button", { name: /^Schedule JOB/ }).click();
  await expect(panel).toHaveCount(0);
  const dialog = await dialogReady(page, `Jordan Lee ${tag}`);
  await expect(dialog).toContainText("Schedule visit");
  // A first booking asks for no reason and states no move.
  await expect(dialog.getByLabel(/^Reason for moving it/)).toHaveCount(0);
  const day = dayOfWeek(monday, 1);
  await fillSchedule(dialog, { date: day, time: "09:00", technician: `Jordan Lee ${tag}` });
  await expect(conflictCheck(dialog)).toContainText("is free at that time");
  await expect(dialog.getByTestId("move-summary")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Schedule visit" }).click();

  await expect(scheduleDialog(page)).toHaveCount(0, { timeout: NAVIGATION_TIMEOUT });
  await expect(toast(page, `${waiting.jobReference} scheduled`)).toBeVisible();
  const placed = dayList(page, day).getByRole("button", { name: new RegExp(waiting.jobReference) });
  await expect(placed).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(placed).toHaveAttribute("data-start-minute", String(9 * 60));
  await expect(placed).toBeFocused();

  const saved = await workOrderById(waiting.jobId);
  expect(saved.status).toBe("SCHEDULED");
  expect(saved.technicianId).toBe(jordan.id);
  expect(saved.scheduledStart).toEqual(instantAt(day, "09:00"));

  // It no longer waits.
  await open.click();
  await expect(
    needsPanel(page).getByTestId("waiting-job").filter({ hasText: waiting.jobReference }),
  ).toHaveCount(0);
});

test("shows a job that needs a new time with the appointment it had, and says when a booking is in another week", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const monday = await ownWeek();
  const farMonday = addDaysToDateOnly(monday, 7 * 3);
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const quinn = await createCustomerAccount({ name: `Quinn Quotable ${tag}` });
  const needs = await createWaitingJobFor(quinn.id, "NEEDS_RESCHEDULING");
  await withDatabaseQuery((prisma) =>
    prisma.workOrder.update({
      where: { id: needs.jobId },
      data: {
        technicianId: jordan.id,
        scheduledStart: instantAt(dayOfWeek(monday, 1), "10:00"),
        scheduledEnd: instantAt(dayOfWeek(monday, 1), "12:00"),
      },
    }),
  );
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${monday}&technician=${jordan.id}`);

  // It holds no time any more, so it is not on the grid; it is in the panel with its old slot.
  await expect(blocks(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^Needs scheduling/ }).click();
  const entry = needsPanel(page).getByTestId("waiting-job").filter({ hasText: needs.jobReference });
  await expect(entry).toContainText("Needs rescheduling");
  await expect(entry).toContainText("Was booked for");
  await expect(entry).toContainText("10:00 AM – 12:00 PM");

  // Scheduling it three weeks on: the visit is not in the week on screen, so the toast offers to show it.
  await entry.getByRole("button", { name: /^Schedule JOB/ }).click();
  const dialog = await dialogReady(page, `Jordan Lee ${tag}`);
  await fillSchedule(dialog, { date: dayOfWeek(farMonday, 2), time: "13:00" });
  await dialog.getByRole("button", { name: "Schedule visit" }).click();
  await expect(scheduleDialog(page)).toHaveCount(0, { timeout: NAVIGATION_TIMEOUT });
  const notice = toast(page, `${needs.jobReference} scheduled`);
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Show that week" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${dayOfWeek(farMonday, 2)}`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(visitOf(page, needs.jobReference)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
});

// ---- Views by width, the empty calendar, and who may see it -----------------------------------------

test("opens as the week on a wide screen, the day on a tablet and the agenda on a phone", async ({
  page,
}) => {
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const job = await createBookedJobFor(alex.id, jordan.id, dayOfWeek(monday, 1), "10:00", "12:00");
  await loginAs(page, "admin");
  const switcher = page.getByRole("navigation", { name: "Calendar view" });

  for (const [width, name] of [
    [1440, "Week"],
    [1024, "Week"],
    [900, "Day"],
    [768, "Day"],
    [767, "Agenda"],
    [360, "Agenda"],
  ] as const) {
    await useViewport(page, width);
    await openCalendar(page, `date=${dayOfWeek(monday, 1)}&technician=${jordan.id}`);
    await expect(switcher.getByRole("link", { name }), `${String(width)} px`).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(visitOf(page, job.jobReference)).toBeVisible();
    if (name === "Agenda") {
      await expect(page.getByTestId("agenda")).toBeVisible();
      await expect(page.getByTestId("time-grid")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("time-grid")).toBeVisible();
    }
  }

  // The address wins over the width: asking for the week on a phone gives the week.
  await openCalendar(page, `view=week&date=${dayOfWeek(monday, 1)}&technician=${jordan.id}`);
  await expect(switcher.getByRole("link", { name: "Week" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Resizing the window changes the view that fits, when the address names none.
  await openCalendar(page, `date=${dayOfWeek(monday, 1)}&technician=${jordan.id}`);
  await expect(switcher.getByRole("link", { name: "Agenda" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await useViewport(page, 1300);
  await expect(switcher.getByRole("link", { name: "Week" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("collapses the days with nothing on them in the agenda", async ({ page }) => {
  await useViewport(page, 360);
  const monday = await ownWeek();
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const alex = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const tuesday = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(monday, 1),
    "13:00",
    "14:00",
  );
  const tuesdayEarly = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(monday, 1),
    "08:00",
    "09:00",
  );
  const friday = await createBookedJobFor(
    alex.id,
    jordan.id,
    dayOfWeek(monday, 4),
    "10:00",
    "11:00",
  );
  await loginAs(page, "admin");
  await openCalendar(page, `view=agenda&date=${monday}&technician=${jordan.id}`);

  // Two days have visits; the other five have no heading at all.
  await expect(page.getByTestId("agenda").getByRole("heading", { level: 3 })).toHaveCount(2);
  await expect(page.getByTestId("agenda").getByRole("heading", { level: 3 }).first()).toContainText(
    "Tuesday",
  );
  await expect(page.getByTestId("agenda").getByRole("heading", { level: 3 }).nth(1)).toContainText(
    "Friday",
  );
  // In time order within a day.
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toContainText(tuesdayEarly.jobReference);
  await expect(cards(page).nth(1)).toContainText(tuesday.jobReference);
  await expect(cards(page).nth(2)).toContainText(friday.jobReference);
  // Each card carries the same information as a block, in words.
  await expect(cards(page).nth(0)).toContainText("8:00 – 9:00 AM");
  await expect(cards(page).nth(0)).toContainText(`Avery Dalton ${tag}`);
  await expect(cards(page).nth(0)).toContainText(`Jordan Lee ${tag}`);
  await expect(cards(page).nth(0)).toContainText("Scheduled");
});

test("says so when the week is empty, and points at the jobs waiting for a time", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const tag = newTag();
  const jordan = await ownTechnician(tag);
  const quinn = await createCustomerAccount({ name: `Quinn Quotable ${tag}` });
  await createWaitingJobFor(quinn.id);
  await loginAs(page, "admin");
  // No date: this week, on the business's calendar. Jordan has nothing in it.
  await openCalendar(page, `view=week&technician=${jordan.id}`);

  await expect(
    page.getByRole("heading", { level: 3, name: "No visits scheduled this week" }),
  ).toBeVisible();
  await expect(page.getByText(/waiting for a time/).first()).toBeVisible();
  await expect(page.getByText(/Choose All technicians/)).toBeVisible();
  const link = page.getByRole("link", { name: "See the jobs waiting for a time" });
  await expect(link).toHaveAttribute("href", "/app/jobs?view=needs-scheduling");

  // A day, too.
  await openCalendar(page, `view=day&technician=${jordan.id}`);
  await expect(
    page.getByRole("heading", { level: 3, name: "No visits scheduled today" }),
  ).toBeVisible();
  // And another week is named by its date.
  await openCalendar(page, `view=week&date=${await ownWeek()}&technician=${jordan.id}`);
  await expect(
    page.getByRole("heading", { level: 3, name: /^No visits scheduled the week of / }),
  ).toBeVisible();
});

test("is for the business only: a visitor is sent to sign in and a customer is turned away", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Cleo Customer" });

  await page.goto("/app/calendar");
  await page.waitForURL(/\/login\?returnTo=%2Fapp%2Fcalendar/, { timeout: NAVIGATION_TIMEOUT });

  await loginAs(page, customer);
  await expect(page.locator('a[href="/app/calendar"]')).toHaveCount(0);
  await page.goto("/app/calendar");
  await expect(
    page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(calendarRegion(page)).toHaveCount(0);
  expect(
    (await page.request.get("/api/v1/admin/calendar?from=2032-01-05&to=2032-01-11")).status(),
  ).toBe(403);
});

test("is in the business navigation and opens from it", async ({ page }) => {
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await page.getByRole("link", { name: "Calendar", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/calendar$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendar", exact: true }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );
});
