import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { createJobFor } from "../fixtures/customers.js";
import {
  createAcceptedQuotationFor,
  instantAt,
  ownTechnician,
  uniqueFutureDay,
  workOrderById,
  workOrderOf,
} from "../fixtures/jobs.js";
import {
  assignJob,
  deleteTechniciansTagged,
  inDays,
  insertTechnician,
  newTechnicianTag,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import {
  dialogReady,
  fillSchedule,
  JOB_PATH,
  jobBadge,
  toast,
  zoneAbbreviation,
} from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * The jobs list (T17, FR-052): the tabs and their counts, the filters, the order, the pages and the
 * screens that say there is nothing to show. Every test makes customers and a technician of its own
 * whose names carry a unique tag and narrows the list to it, because the specs run in parallel on one
 * database and the list is the whole business's.
 */

test.describe.configure({ timeout: 180_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const JOBS_TABLE = "Jobs";

/** One job in each status, for customers and a technician named with a tag no other test has. */
async function jobsWorld() {
  const tag = newTechnicianTag();
  tags.push(tag);
  const day = uniqueFutureDay();
  const technician = await insertTechnician(tag, { name: `Casey Brooks ${tag}` });
  const [waiting, booked, underWay, done, cancelled] = await Promise.all(
    ["Waiting", "Booked", "Underway", "Finished", "Dropped"].map((word) =>
      createCustomerAccount({ name: `${word} Customer ${tag}` }),
    ),
  );
  if (!waiting || !booked || !underWay || !done || !cancelled) throw new Error("setup");

  const pending = await createJobFor(waiting.id, { status: "PENDING_SCHEDULING" });
  const scheduled = await assignJob(technician.id, booked.id, instantAt(day, "10:00"));
  const inProgress = await assignJob(
    technician.id,
    underWay.id,
    new Date(Date.now() - 3_600_000),
    "IN_PROGRESS",
  );
  const completed = await assignJob(
    technician.id,
    done.id,
    new Date(Date.now() - 5 * 86_400_000),
    "COMPLETED",
  );
  const dropped = await createJobFor(cancelled.id, { status: "CANCELLED" });
  return { tag, day, technician, pending, scheduled, inProgress, completed, dropped };
}

const rowsOf = (page: Page) => page.getByRole("table", { name: JOBS_TABLE }).getByRole("row");

async function openList(page: Page, query: string): Promise<void> {
  await page.goto(`/app/jobs?${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("search", { name: "Search and filter jobs" }));
}

const tab = (page: Page, name: string | RegExp) =>
  page.getByRole("navigation", { name: "Filter jobs by stage" }).getByRole("link", { name });

test("each tab holds its own jobs, with counts, and the tab lives in the address", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { tag, pending, scheduled, inProgress, completed, dropped } = await jobsWorld();
  await loginAs(page, "admin");

  // It opens on what is waiting for a time.
  await openList(page, `q=${tag}`);
  await expect(tab(page, /^Needs scheduling/)).toHaveAttribute("aria-current", "page");
  await expect(tab(page, /^Needs scheduling/)).toContainText("1");
  await expect(tab(page, /^Upcoming/)).toContainText("1");
  await expect(tab(page, /^In progress/)).toContainText("1");
  await expect(tab(page, /^Completed/)).toContainText("1");
  await expect(tab(page, /^All/)).toContainText("5");
  await expect(rowsOf(page)).toHaveCount(2); // the header row and the one job
  await expect(rowsOf(page).nth(1)).toContainText(pending.jobReference);
  await expect(rowsOf(page).nth(1)).toContainText("Not scheduled yet");
  await expect(rowsOf(page).nth(1)).toContainText("Unassigned");

  // Each tab is a real link: the address changes, and the search is kept.
  await tab(page, /^Upcoming/).click();
  await expect(page).toHaveURL(new RegExp(`view=upcoming.*q=${tag}|q=${tag}.*view=upcoming`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(rowsOf(page).nth(1)).toContainText(scheduled.jobReference, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(rowsOf(page).nth(1)).toContainText(`Casey Brooks ${tag}`);
  await expect(rowsOf(page)).toHaveCount(2);

  await tab(page, /^In progress/).click();
  await expect(rowsOf(page).nth(1)).toContainText(inProgress.jobReference, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await tab(page, /^Completed/).click();
  await expect(rowsOf(page).nth(1)).toContainText(completed.jobReference, {
    timeout: NAVIGATION_TIMEOUT,
  });
  await tab(page, /^All/).click();
  await expect(rowsOf(page)).toHaveCount(6, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("table", { name: JOBS_TABLE })).toContainText(dropped.jobReference);

  // Opening the address by hand lands on the same tab.
  await openList(page, `view=in-progress&q=${tag}`);
  await expect(tab(page, /^In progress/)).toHaveAttribute("aria-current", "page");
});

test("filters by technician, by the day of the visit and by a word, and clears them", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { tag, day, technician, scheduled, inProgress, completed } = await jobsWorld();
  await loginAs(page, "admin");
  await openList(page, `view=all&q=${tag}`);
  await expect(rowsOf(page)).toHaveCount(6);

  // The technician.
  await page.getByLabel("Technician").selectOption({ label: `Casey Brooks ${tag}` });
  await expect(page).toHaveURL(new RegExp(`technicianId=${technician.id}`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(rowsOf(page)).toHaveCount(4, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("table", { name: JOBS_TABLE })).not.toContainText("Waiting Customer");

  // The day a visit starts: only the one booked for that day.
  await page.getByLabel("Scheduled from").fill(day);
  await page.getByLabel("Scheduled to").fill(day);
  await expect(rowsOf(page)).toHaveCount(2, { timeout: NAVIGATION_TIMEOUT });
  await expect(rowsOf(page).nth(1)).toContainText(scheduled.jobReference);
  await expect(page).toHaveURL(new RegExp(`scheduledFrom=${day}`));
  await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();

  // Clearing them clears the search too, and keeps the tab.
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?view=all$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  await expect(page.getByLabel("Technician")).toHaveValue("");
  await expect(page.getByLabel("Scheduled from")).toHaveValue("");
  await expect(tab(page, /^All/)).toHaveAttribute("aria-current", "page");

  // A reference.
  await page.getByRole("searchbox", { name: "Search" }).fill(completed.jobReference);
  await expect(rowsOf(page)).toHaveCount(2, { timeout: NAVIGATION_TIMEOUT });
  await expect(rowsOf(page).nth(1)).toContainText(completed.jobReference);
  await page.getByRole("searchbox", { name: "Search" }).fill(inProgress.jobReference.toLowerCase());
  await expect(rowsOf(page).nth(1)).toContainText(inProgress.jobReference, {
    timeout: NAVIGATION_TIMEOUT,
  });
});

test("sorts by the day of the visit, and flips the order from the column header", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { tag, scheduled, inProgress, completed, pending } = await jobsWorld();
  await loginAs(page, "admin");

  await openList(page, `view=all&q=${tag}&sort=scheduledStart&order=asc`);
  const references = async () =>
    (await rowsOf(page).allTextContents())
      .slice(1)
      .map((text) => /JOB-\d{4}-\d{5}/.exec(text)?.[0]);
  // The oldest visit first; a job with no appointment sorts after those that have one.
  const ascending = await references();
  expect(ascending.slice(0, 3)).toEqual([
    completed.jobReference,
    inProgress.jobReference,
    scheduled.jobReference,
  ]);
  expect(ascending).toContain(pending.jobReference);
  expect(ascending.indexOf(pending.jobReference)).toBeGreaterThan(2);

  await page
    .getByRole("link", { name: /Scheduled/ })
    .first()
    .click();
  await expect(page).toHaveURL(/order=desc/, { timeout: NAVIGATION_TIMEOUT });
  await expect
    .poll(async () => (await references()).slice(0, 3), { timeout: 15_000 })
    .toEqual([scheduled.jobReference, inProgress.jobReference, completed.jobReference]);
});

test("a row opens the job", async ({ page }) => {
  await useViewport(page, 1440);
  const { tag, pending } = await jobsWorld();
  await loginAs(page, "admin");
  await openList(page, `q=${tag}`);

  await rowsOf(page).nth(1).getByRole("link", { name: pending.jobReference }).click();

  await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: pending.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(jobBadge(page)).toHaveAttribute("data-status", "PENDING_SCHEDULING");
});

test("a technician's page and the technician list link to their jobs", async ({ page }) => {
  await useViewport(page, 1440);
  const tag = newTechnicianTag();
  tags.push(tag);
  const technician = await insertTechnician(tag, { name: `Casey Brooks ${tag}` });
  const customer = await createCustomerAccount({ name: `Link Customer ${tag}` });
  const job = await assignJob(technician.id, customer.id, inDays(2));
  await loginAs(page, "admin");

  // The technician's own page: the reference under "Upcoming jobs" opens the job.
  await page.goto(`/app/technicians/${technician.id}`);
  const upcoming = page.getByRole("table", { name: `Upcoming jobs for ${technician.name}` });
  await expect(upcoming).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await upcoming.getByRole("link", { name: job.jobReference }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.jobId}$`), {
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // The list: "Next job" is a second link inside a row that is itself a link to the technician,
  // and it goes to the job, not to the technician.
  await page.goto(`/app/technicians?active=all&q=${tag}`);
  const list = page.getByRole("table", { name: "Technicians" });
  await expect(list).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await list.getByRole("link", { name: job.jobReference }).click();
  await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.jobId}$`), {
    timeout: NAVIGATION_TIMEOUT,
  });
});

test("says what is empty and why: no match, a page past the end, a tab with nothing in it", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const { tag } = await jobsWorld();
  await loginAs(page, "admin");

  await openList(page, `q=${tag}zzz`);
  await expect(page.getByRole("heading", { level: 2, name: "No jobs match" })).toBeVisible();
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(/\/app\/jobs$/, { timeout: NAVIGATION_TIMEOUT });

  await openList(page, `view=all&q=${tag}&page=9`);
  await expect(
    page.getByRole("heading", { level: 2, name: "There is nothing on this page" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to the first page" }).click();
  await expect(rowsOf(page)).toHaveCount(6, { timeout: NAVIGATION_TIMEOUT });

  // A tab with nothing for this search, and no filter: it is a tab saying "none yet".
  await openList(page, "view=in-progress&technicianId=0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
  await expect(page.getByRole("heading", { level: 2, name: "No jobs match" })).toBeVisible();
});

test("pages a long list twenty at a time without losing or repeating a job", async ({ page }) => {
  await useViewport(page, 1440);
  const tag = newTechnicianTag();
  tags.push(tag);
  const technician = await insertTechnician(tag, { name: `Casey Brooks ${tag}` });
  const customer = await createCustomerAccount({ name: `Many Jobs ${tag}` });
  for (let index = 0; index < 22; index += 1) {
    await assignJob(technician.id, customer.id, new Date(Date.now() + (index + 1) * 3_600_000 * 3));
  }
  await loginAs(page, "admin");

  await openList(page, `view=upcoming&q=${tag}&sort=scheduledStart&order=asc`);
  const first = (await rowsOf(page).allTextContents()).slice(1);
  expect(first).toHaveLength(20);
  await expect(page.getByText("Showing 1–20 of 22 jobs")).toBeVisible();

  await page.getByRole("link", { name: "Go to next page" }).first().click();
  await expect(page.getByText("Showing 21–22 of 22 jobs")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const second = (await rowsOf(page).allTextContents()).slice(1);
  expect(second).toHaveLength(2);
  const seen = [...first, ...second].map((text) => /JOB-\d{4}-\d{5}/.exec(text)?.[0]);
  expect(new Set(seen).size).toBe(22);
});

// ---- A browser whose clocks are not the business's (D-104) -------------------------------------

test.describe("a browser in another time zone", () => {
  test.use({ timezoneId: "Pacific/Kiritimati", locale: "en-US" });

  test("books and shows the business's times, whatever time zone this device is set to", async ({
    page,
  }) => {
    await useViewport(page, 1440);
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    // Guard: the browser really is 14 hours ahead of UTC and a day away from New York.
    expect(zone).toBe("Pacific/Kiritimati");

    const customer = await createCustomerAccount({ name: "Tori Timezone" });
    const { request } = await createAcceptedQuotationFor(customer.id);
    const tag = newTechnicianTag();
    tags.push(tag);
    const jordan = await ownTechnician(tag);
    const day = uniqueFutureDay();
    await loginAs(page, "admin");
    await page.goto(`/app/requests/${request.id}`);
    const create = page.getByRole("button", { name: "Create job", exact: true });
    await expect(create).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expectHydrated(create);
    await create.click();
    await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
    const job = await workOrderOf(request.id);
    if (job === null) throw new Error("The job was not made.");

    const dialog = await dialogReady(page, jordan.name);
    // The dialog says whose clocks it means, and which short name they have on that day.
    await expect(dialog.getByText(/^Times in America\/New_York/)).toBeVisible();
    await fillSchedule(dialog, { date: day, time: "22:30", technician: jordan.name });
    await expect(dialog.getByText(/^Times in America\/New_York \(E[SD]T\)/)).toBeVisible();
    await expect(dialog.getByText("Ends at 12:30 AM on")).toBeVisible();
    await dialog.getByRole("button", { name: "Schedule visit" }).click();
    await expect(toast(page, `${job.reference} is scheduled`)).toBeVisible();
    await expect(jobBadge(page)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });

    // What was stored is 22:30 New York time, not 22:30 in the browser's zone.
    const stored = await workOrderById(job.id);
    const start = instantAt(day, "22:30");
    expect(stored.scheduledStart?.toISOString()).toBe(start.toISOString());
    // Two hours later, across the business's midnight.
    expect(stored.scheduledEnd?.toISOString()).toBe(
      new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    );

    // And the page still reads it on the business's clocks: the day the visit starts in New York
    // (which is another day in Kiritimati), the two times and the short name of the zone.
    const startDay = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(start);
    await expect(page.getByRole("heading", { level: 2, name: "Appointment" })).toBeVisible();
    const appointment = page
      .getByRole("heading", { level: 2, name: "Appointment" })
      .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await expect(appointment).toContainText(startDay);
    await expect(appointment).toContainText("10:30 PM");
    await expect(appointment).toContainText("12:30 AM");
    await expect(appointment).toContainText(zoneAbbreviation(start));

    // The list too: the visit is on the business's day, not the browser's.
    await openList(page, `view=upcoming&q=${encodeURIComponent(customer.name)}`);
    await expect(rowsOf(page).nth(1)).toContainText(job.reference);
    await expect(rowsOf(page).nth(1)).toContainText(startDay);
    await expect(rowsOf(page).nth(1)).toContainText("10:30 PM");
  });
});
