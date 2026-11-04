import { expect, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createVisitWithStatus,
  createWaitingJobFor,
  dayOfWeek,
  ownWeek,
} from "../fixtures/calendar.js";
import { createBookedJobFor, instantAt, ownTechnician, workOrderById } from "../fixtures/jobs.js";
import {
  deleteTechniciansTagged,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  blocks,
  cards,
  dayList,
  drawer,
  needsPanel,
  openCalendar,
  visitOf,
} from "./helpers/calendar.js";
import { dialogReady, fillSchedule, scheduleDialog, toast } from "./helpers/jobs.js";
import {
  expectInsideScreen,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { seriousViolations } from "./helpers/public.js";

/**
 * The states of the calendar (T19) at the four required widths: the week, the day and the agenda with
 * ordinary content and with names as long as the rules allow, three visits side by side, a very early
 * and a very late visit; nothing scrolling sideways, axe-clean, and the drawer, the scheduling dialog and
 * the panel inside the screen. The agenda is checked to be fully usable on a phone.
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

/** A week with ordinary visits, very long names, three visits side by side and the extremes of the day. */
async function world() {
  const monday = await ownWeek();
  const tag = newTechnicianTag();
  tags.push(tag);
  const jordan = await ownTechnician(tag);
  const sam = await insertTechnician(tag, { name: `Sam Ortiz ${tag}`, calendarColor: "green" });
  const longTechnician = await insertTechnician(tag, {
    name: longNameFor(tag),
    calendarColor: "rose",
  });
  const ordinary = await createCustomerAccount({ name: `Avery Dalton ${tag}` });
  const longCustomer = await createCustomerAccount({ name: longNameFor(tag) });
  const waitingCustomer = await createCustomerAccount({
    name: longNameFor(`w${tag}`).slice(0, 100),
  });

  const tuesday = dayOfWeek(monday, 1);
  const friday = dayOfWeek(monday, 4);
  const plain = await createBookedJobFor(ordinary.id, jordan.id, tuesday, "10:00", "12:00");
  const longVisit = await createBookedJobFor(
    longCustomer.id,
    longTechnician.id,
    tuesday,
    "11:00",
    "13:00",
  );
  const early = await createBookedJobFor(
    ordinary.id,
    sam.id,
    dayOfWeek(monday, 2),
    "06:30",
    "08:00",
  );
  const late = await createBookedJobFor(
    ordinary.id,
    sam.id,
    dayOfWeek(monday, 2),
    "21:00",
    "22:00",
  );
  const underWay = await createVisitWithStatus(
    ordinary.id,
    jordan.id,
    dayOfWeek(monday, 3),
    "09:00",
    "10:00",
    "IN_PROGRESS",
  );
  const done = await createVisitWithStatus(
    ordinary.id,
    sam.id,
    dayOfWeek(monday, 3),
    "09:30",
    "10:30",
    "COMPLETED",
  );
  const crowd = await Promise.all(
    [jordan, sam, longTechnician].map((technician) =>
      createBookedJobFor(ordinary.id, technician.id, friday, "14:00", "15:00"),
    ),
  );
  const waiting = await createWaitingJobFor(waitingCustomer.id);
  return {
    monday,
    tag,
    jordan,
    sam,
    longTechnician,
    plain,
    longVisit,
    early,
    late,
    underWay,
    done,
    crowd,
    waiting,
  };
}

test.describe("every view at the four widths", () => {
  for (const width of WIDTHS) {
    test(`works at ${String(width)} px: no sideways scroll, axe-clean, the drawer, dialog and panel inside the screen`, async ({
      page,
    }) => {
      const w = await world();
      await useViewport(page, width);
      await loginAs(page, "admin");

      for (const view of ["week", "day", "agenda"] as const) {
        const date = view === "day" ? dayOfWeek(w.monday, 1) : w.monday;
        await openCalendar(page, `view=${view}&date=${date}`);
        await expect(visitOf(page, w.plain.jobReference)).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(await seriousViolations(page), `the ${view} at ${String(width)} px`).toBe("");
      }

      // ---- The drawer for a visit whose customer and technician have 100-character names -------
      await openCalendar(page, `view=agenda&date=${w.monday}`);
      await visitOf(page, w.longVisit.jobReference).click();
      const panel = drawer(page, w.longVisit.jobReference);
      await expect(panel).toBeVisible();
      await expectInsideScreen(page, panel, "the drawer");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the drawer at ${String(width)} px`).toBe("");

      // ---- The scheduling dialog opened from it -------------------------------------------------
      await panel.getByRole("button", { name: "Reschedule" }).click();
      const dialog = await dialogReady(page, `Sam Ortiz ${w.tag}`);
      await fillSchedule(dialog, { date: dayOfWeek(w.monday, 5), time: "09:00" });
      await expect(dialog.getByTestId("move-summary")).toBeVisible();
      await expectInsideScreen(page, dialog, "the scheduling dialog");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the dialog at ${String(width)} px`).toBe("");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(scheduleDialog(page)).toHaveCount(0);

      // ---- The panel of jobs waiting for a time -------------------------------------------------
      await page.getByRole("button", { name: /^Needs scheduling/ }).click();
      const waitingPanel = needsPanel(page);
      await expect(waitingPanel).toBeVisible();
      await expect(
        waitingPanel.getByTestId("waiting-job").filter({ hasText: w.waiting.jobReference }),
      ).toBeVisible();
      await expectInsideScreen(page, waitingPanel, "the needs-scheduling panel");
      await expectNoHorizontalOverflow(page);
      expect(await seriousViolations(page), `the panel at ${String(width)} px`).toBe("");
    });
  }
});

test("draws the crowded day without overlapping text, in the week and the split day", async ({
  page,
}) => {
  const w = await world();
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${w.monday}`);

  // Three visits at the same time take a third of the column each; none covers another.
  // Which of the three takes which column is the layout's call (ties go by id), so take them left to right.
  const found = await Promise.all(
    w.crowd.map((job) => visitOf(page, job.jobReference).boundingBox()),
  );
  const boxes = found.flatMap((box) => (box === null ? [] : [box])).sort((p, q) => p.x - q.x);
  expect(boxes).toHaveLength(3);
  const [a, b, c] = boxes;
  if (!a || !b || !c) throw new Error("boxes");
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(b.x + b.width).toBeLessThanOrEqual(c.x + 1);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);

  // Their text does not run out of their blocks, however long the names.
  // (Polled: the first paint on a busy development server can come before the stylesheet.)
  for (const job of w.crowd) {
    await expect
      .poll(
        () =>
          visitOf(page, job.jobReference).evaluate((element) => {
            const edge = element.getBoundingClientRect().right;
            return [...element.querySelectorAll("span")].some(
              (span) => span.getBoundingClientRect().right > edge + 1,
            );
          }),
        { message: `${job.jobReference}'s text stays in its block` },
      )
      .toBe(false);
  }

  // Split by technician, each has a column of their own and is the whole width of it.
  await openCalendar(page, `view=day&date=${dayOfWeek(w.monday, 4)}&split=1`);
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
  const widths = await Promise.all(
    w.crowd.map(async (job) => (await visitOf(page, job.jobReference).boundingBox())?.width ?? 0),
  );
  expect(Math.min(...widths)).toBeGreaterThan(90);
  await expectNoHorizontalOverflow(page);
});

test("the agenda is fully usable on a phone: open a card, reschedule it, see it move", async ({
  page,
}) => {
  const w = await world();
  await useViewport(page, 360);
  await loginAs(page, "admin");
  // No view in the address: the width chooses the agenda.
  await openCalendar(page, `date=${w.monday}&technician=${w.jordan.id}`);
  await expect(page.getByTestId("agenda")).toBeVisible();

  const card = cards(page).filter({ hasText: w.plain.jobReference });
  await card.click();
  const panel = drawer(page, w.plain.jobReference);
  await expect(panel).toBeVisible();
  await expectInsideScreen(page, panel, "the drawer");
  await panel.getByRole("button", { name: "Reschedule" }).click();

  const dialog = await dialogReady(page, `Jordan Lee ${w.tag}`);
  const target = dayOfWeek(w.monday, 5);
  await fillSchedule(dialog, { date: target, time: "15:00", reason: "Moving it to Saturday." });
  await expect(dialog.getByTestId("move-summary")).toContainText(/^Move JOB-/);
  await expectInsideScreen(page, dialog, "the scheduling dialog");
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();

  await expect(scheduleDialog(page)).toHaveCount(0, { timeout: NAVIGATION_TIMEOUT });
  await expect(toast(page, `${w.plain.jobReference} moved`)).toBeVisible();
  // The card is now under Saturday's heading, and focus is on it.
  const moved = cards(page).filter({ hasText: w.plain.jobReference });
  await expect(moved).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(moved).toContainText("3:00 – 5:00 PM");
  await expect(moved).toBeFocused();
  expect((await workOrderById(w.plain.jobId)).scheduledStart).toEqual(instantAt(target, "15:00"));
  await expectNoHorizontalOverflow(page);
});

test("keeps the keyboard order day by day and time by time, and reaches every block with Tab", async ({
  page,
}) => {
  const w = await world();
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await openCalendar(page, `view=week&date=${w.monday}`);

  // The order of the blocks in the page is the reading order: Tuesday before Wednesday, early before late.
  const order = await blocks(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-visit-id")),
  );
  const expected = [
    w.plain.jobId,
    w.longVisit.jobId,
    w.early.jobId,
    w.late.jobId,
    w.underWay.jobId,
    w.done.jobId,
    ...w.crowd.map((job) => job.jobId),
  ];
  const mine = order.filter((id) => id !== null && expected.includes(id));
  // Same day: by start time, then the longer first; the three at 14:00 may come in any order.
  expect(mine.slice(0, 6)).toEqual(expected.slice(0, 6));
  expect(new Set(mine.slice(6))).toEqual(new Set(expected.slice(6)));

  // Tab from one block lands on the next one in that order.
  const first = visitOf(page, w.plain.jobReference);
  // (Retried as a whole: a development server that reloads the page in the middle drops focus, and
  // pressing Tab from nowhere starts at the top of the page.)
  await expect(async () => {
    await first.focus();
    await expect(first).toBeFocused({ timeout: 1_000 });
    await page.keyboard.press("Tab");
    await expect(visitOf(page, w.longVisit.jobReference)).toBeFocused({ timeout: 1_000 });
    await page.keyboard.press("Tab");
    await expect(visitOf(page, w.early.jobReference)).toBeFocused({ timeout: 1_000 });
    await page.keyboard.press("Shift+Tab");
    await expect(visitOf(page, w.longVisit.jobReference)).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  // Every block has a full name that says when, which job, for whom, with whom, and the status.
  for (const job of [w.plain, w.underWay, w.done]) {
    await expect(visitOf(page, job.jobReference)).toHaveAccessibleName(
      new RegExp(
        `^\\w+day \\d+:\\d{2}( [AP]M)? – \\d+:\\d{2} [AP]M ${job.jobReference} .+, assigned to .+, (Scheduled|In progress|Completed)$`,
      ),
    );
  }
  // The grid is one scroll region, named, that can take focus; the day lists are named by their day.
  await expect(page.getByRole("region", { name: /^Week of .*scrolls sideways/ })).toHaveAttribute(
    "tabindex",
    "0",
  );
  await expect(dayList(page, dayOfWeek(w.monday, 1))).toBeVisible();
});
