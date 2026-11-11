import { type Browser, expect, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import {
  createBookedJobFor,
  instantAt,
  jobEventsOf,
  jobNotificationsFor,
  ownTechnician,
  uniqueFutureDay,
  withDatabaseQuery,
  workOrderById,
} from "../fixtures/jobs.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { readOutbox } from "../support/outbox.js";
import { card, dialogReady, fillSchedule, jobBadge, openJob, toast } from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * A job's life, after it has been scheduled (T18, workflow 7.5, FR-055, FR-056): the admin starts it,
 * completes it with a note for the customer and one for the team, marks one as needing a new time and
 * books it again, and cancels another; the customer follows each of them on their own job pages and
 * never reads the internal note or a reason. The admin signs in through the real form and uses the
 * real screens; what happened is checked against what was stored. Every test makes customers and a
 * technician of its own, because the specs run in parallel on one database and one shared team.
 */

test.describe.configure({ timeout: 180_000 });

const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const SUMMARY =
  "Replaced the run capacitor and re-gassed the system. The unit now cools to 68 degrees.";
const INTERNAL_NOTE = "INTERNAL-NOTE: offer a surge protector; the customer pays slowly.";
const INTERNAL_REASON = "INTERNAL-REASON: the part is backordered and the supplier is unreliable.";
const CUSTOMER_MESSAGE = "We are sorry for the trouble. We will phone you this week.";
const SECRETS = ["INTERNAL-NOTE", "INTERNAL-REASON", "surge protector", "backordered"];

/** The newest email to `to` whose subject contains `subject`. Emails are sent a moment after the page answers. */
async function emailWithSubject(to: string, subject: string) {
  let found: ReturnType<typeof readOutbox>[number] | undefined;
  await expect
    .poll(
      () => {
        found = readOutbox()
          .filter(
            (email) =>
              email.to.toLowerCase() === to.toLowerCase() && email.subject.includes(subject),
          )
          .at(-1);
        return found !== undefined;
      },
      { message: `No email "${subject}" to ${to} reached the outbox`, timeout: 20_000 },
    )
    .toBe(true);
  if (found === undefined) throw new Error("No email found.");
  return found;
}

/** A scheduled job for a customer made for the test, with the technician made for it. */
async function bookedJob(name: string) {
  const tag = newTechnicianTag();
  tags.push(tag);
  const created = await ownTechnician(tag);
  // Contact details that must never reach the customer: the leak checks look for exactly these.
  const contact = { phone: "(212) 555-0177", email: `jordan.${tag}@coolbreeze.test` };
  const jordan = await withDatabaseQuery((prisma) =>
    prisma.technician.update({ where: { id: created.id }, data: contact }),
  );
  const customer = await createCustomerAccount({ name });
  const day = uniqueFutureDay();
  const job = await createBookedJobFor(customer.id, jordan.id, day, "10:00", "12:00");
  return { tag, jordan, customer, day, job };
}

async function customerPage(
  browser: Browser,
  customer: FixtureAccount,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useViewport(page, 1440);
  await loginAs(page, customer);
  return { page, close: () => context.close() };
}

/** The customer's page for a job, once it is drawn. */
async function openPortalJob(page: Page, job: { jobId: string; jobReference: string }) {
  await page.goto(`/portal/jobs/${job.jobId}`);
  await expect(page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function pageText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

test("an admin starts and completes a scheduled job with two notes, and the customer reads the summary and not the internal note", async ({
  browser,
  page,
}) => {
  await useViewport(page, 1440);
  const { tag, jordan, customer, job } = await bookedJob("Casey Completed");
  await loginAs(page, "admin");

  // ---- Start job: asks first, warns that the booked time has not come, then records the start ---
  await openJob(page, job, { expectButton: "Start job" });
  await page.getByRole("button", { name: "Start job", exact: true }).click();
  const start = page.getByRole("alertdialog", { name: `Start ${job.jobReference}?` });
  await expect(start).toBeVisible();
  await expect(start.getByRole("note")).toContainText("later than now");
  expect((await workOrderById(job.jobId)).status).toBe("SCHEDULED");
  await start.getByRole("button", { name: "Start job" }).click();

  await expect(toast(page, `${job.jobReference} was started before its booked time`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "IN_PROGRESS", { timeout: 20_000 });
  await expect(page.getByRole("navigation", { name: "Job progress" })).toContainText(
    "current step",
  );
  const started = await workOrderById(job.jobId);
  expect(started.status).toBe("IN_PROGRESS");
  expect(started.startedAt).not.toBeNull();
  // Starting tells the customer nothing by notification or email.
  expect(
    await jobNotificationsFor(customer.id, ["JOB_COMPLETED", "JOB_NEEDS_RESCHEDULING"]),
  ).toEqual([]);

  // ---- Complete job: a summary for the customer (required) and an internal note (optional) --------
  const complete = page.getByRole("button", { name: "Complete job", exact: true });
  await expect(complete).toBeVisible();
  await expectHydrated(complete);
  await complete.click();
  const dialog = page.getByRole("alertdialog", { name: `Complete ${job.jobReference}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("The customer reads this on their job page.")).toBeVisible();
  await expect(dialog.getByText(/Only your team sees this/)).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Complete job" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Completion summary for the customer/).fill("Done.");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Completion summary for the customer/).fill(SUMMARY);
  await dialog.getByLabel(/Internal note/).fill(INTERNAL_NOTE);
  await confirm.click();

  await expect(toast(page, `${job.jobReference} is complete`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "COMPLETED", { timeout: 20_000 });
  const outcome = card(page, "Completion details");
  await expect(outcome.getByRole("region", { name: "Completion summary" })).toContainText(
    "Shown to the customer",
  );
  await expect(outcome.getByRole("region", { name: "Completion summary" })).toContainText(SUMMARY);
  await expect(outcome.getByRole("region", { name: "Internal note" })).toContainText("Team only");
  await expect(outcome.getByRole("region", { name: "Internal note" })).toContainText(INTERNAL_NOTE);
  await expect(
    page.locator("main").getByRole("button", { name: /Start|Complete|Cancel/ }),
  ).toHaveCount(0);

  // ---- What was stored, and what the customer was told --------------------------------------------
  const done = await workOrderById(job.jobId);
  expect(done).toMatchObject({
    status: "COMPLETED",
    completionNote: SUMMARY,
    internalCompletionNote: INTERNAL_NOTE,
  });
  expect(done.completedAt).not.toBeNull();
  const events = await jobEventsOf(job.jobId);
  expect(events.map((event) => event.action)).toEqual([
    "work_order.started",
    "work_order.completed",
  ]);
  expect(events[1]?.publicSummary).toBe("We marked your job as complete.");
  for (const event of events) {
    expect(`${event.publicSummary ?? ""}${JSON.stringify(event.metadata)}`).not.toContain(
      "INTERNAL",
    );
  }
  const [notice] = await jobNotificationsFor(customer.id, ["JOB_COMPLETED"]);
  expect(notice).toMatchObject({
    type: "JOB_COMPLETED",
    title: `Job ${job.jobReference} is complete`,
    linkPath: `/portal/jobs/${job.jobId}`,
  });
  const email = await emailWithSubject(customer.email, "job is complete");
  expect(email.text).toContain(`/portal/jobs/${job.jobId}`);
  for (const secret of SECRETS) {
    expect(email.text).not.toContain(secret);
  }

  // ---- The job is ready to invoice, and its row offers Create invoice (T20) ------------------------
  await page.goto(`/app/jobs?view=ready-to-invoice&q=${job.jobReference}`);
  const row = page.getByRole("table", { name: "Jobs" }).getByRole("row", {
    name: new RegExp(job.jobReference),
  });
  await expect(row).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("link", { name: /Ready to invoice/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    row.getByRole("button", { name: `Create invoice for ${job.jobReference}` }),
  ).toBeVisible();

  // ---- The customer: the summary, never the internal note; the first name, never the contact ----
  const portal = await customerPage(browser, customer);
  const mine = portal.page;
  const bell = mine.getByRole("button", { name: "1 unread notification", exact: true });
  await expect(bell).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(bell);
  await bell.click();
  await expect(mine.getByRole("dialog", { name: "Notifications" })).toContainText(
    `Job ${job.jobReference} is complete`,
  );
  await mine.keyboard.press("Escape");

  await mine.goto("/portal/jobs");
  const past = mine.getByRole("list", { name: "Past jobs" });
  await expect(past).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(past).toContainText(job.jobReference);
  await expect(past).toContainText("Completed");
  await expect(mine.getByRole("list", { name: "Upcoming jobs" })).toHaveCount(0);
  await past.getByRole("link", { name: new RegExp(job.jobReference) }).click();
  await expect(mine.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  await expect(card(mine, "What we did")).toContainText(SUMMARY);
  await expect(card(mine, "Where things stand")).toContainText("The work is finished");
  await expect(card(mine, "Your visit")).toContainText("Jordan");
  await expect(card(mine, "History")).toContainText("We started work on your job.");
  await expect(card(mine, "History")).toContainText("We marked your job as complete.");
  const seen = await pageText(mine);
  for (const secret of [...SECRETS, "Lee", "555-0177", `jordan.${tag}@`, jordan.id]) {
    expect(seen, secret).not.toContain(secret);
  }
  await portal.close();
});

test("an admin marks a job as needing a new time and books it again with the same dialog", async ({
  browser,
  page,
}) => {
  await useViewport(page, 1440);
  const { jordan, customer, day, job } = await bookedJob("Remy Rebook");
  await loginAs(page, "admin");

  // ---- More actions > Needs rescheduling: an internal reason (required) and a message ------------
  await openJob(page, job, { expectButton: "Start job" });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Needs rescheduling" }).click();
  const dialog = page.getByRole("alertdialog", { name: `${job.jobReference} needs a new time?` });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Mark as needing a new time" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Reason \(internal\)/).fill(INTERNAL_REASON.slice(0, 120));
  await dialog.getByLabel(/Message to the customer/).fill(CUSTOMER_MESSAGE);
  await confirm.click();

  await expect(toast(page, `${job.jobReference} needs a new time`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "NEEDS_RESCHEDULING", {
    timeout: 20_000,
  });
  // The old time is shown as history, never as a booking.
  const schedule = card(page, "Appointment");
  await expect(schedule).toContainText("Needs a new time");
  await expect(schedule).toContainText("Previously scheduled");
  await expect(schedule.getByText("Length")).toHaveCount(0);
  const stopped = await workOrderById(job.jobId);
  expect(stopped).toMatchObject({ status: "NEEDS_RESCHEDULING", technicianId: jordan.id });
  expect(stopped.scheduledStart?.toISOString()).toBe(instantAt(day, "10:00").toISOString());

  // ---- What the customer was told: the message, never the reason ---------------------------------
  const [notice] = await jobNotificationsFor(customer.id, ["JOB_NEEDS_RESCHEDULING"]);
  expect(notice?.title).toBe(`Visit for ${job.jobReference} needs a new time`);
  const mail = await emailWithSubject(customer.email, "We need to find a new time");
  expect(mail.text).toContain(CUSTOMER_MESSAGE);
  expect(mail.text).not.toContain("INTERNAL-REASON");
  const events = await jobEventsOf(job.jobId);
  const stoppedEvent = events.find((event) => event.action === "work_order.needs_rescheduling");
  expect(stoppedEvent?.summary).toContain("INTERNAL-REASON");
  expect(stoppedEvent?.publicSummary).toBe("We need to find a new time for your visit.");
  expect(stoppedEvent?.metadata).toMatchObject({
    previousScheduledStart: instantAt(day, "10:00").toISOString(),
  });

  const portal = await customerPage(browser, customer);
  await openPortalJob(portal.page, job);
  await expect(card(portal.page, "Where things stand")).toContainText(
    "We need to find a new time for your visit",
  );
  await expect(card(portal.page, "Where things stand")).toContainText("Previously booked");
  await expect(card(portal.page, "Your visit")).toContainText("No time is booked yet.");
  await expect(card(portal.page, "Your visit")).not.toContainText("Jordan");
  expect(await pageText(portal.page)).not.toContain("INTERNAL-REASON");

  // ---- Schedule: the very dialog of T17, for a new day --------------------------------------------
  const newDay = uniqueFutureDay();
  const book = page.getByRole("button", { name: "Schedule", exact: true });
  await expect(book).toBeVisible();
  await expectHydrated(book);
  await book.click();
  const scheduler = await dialogReady(page, jordan.name);
  await expect(scheduler).toHaveAccessibleName("Schedule visit");
  await fillSchedule(scheduler, { date: newDay, time: "14:00", technician: jordan.name });
  await scheduler.getByRole("button", { name: "Schedule visit" }).click();

  await expect(toast(page, `${job.jobReference} is scheduled`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });
  const rebooked = await workOrderById(job.jobId);
  expect(rebooked.scheduledStart?.toISOString()).toBe(instantAt(newDay, "14:00").toISOString());
  expect(rebooked.startedAt).toBeNull();
  expect((await jobNotificationsFor(customer.id)).map((n) => n.type)).toEqual(["JOB_SCHEDULED"]);

  // The customer sees the new visit as a booking again.
  await portal.page.reload();
  await expect(card(portal.page, "Where things stand")).toContainText("Your visit is booked");
  await expect(card(portal.page, "Your visit")).toContainText("Jordan");
  await portal.close();
});

test("an admin cancels a job with a reason, and the customer is told without it", async ({
  browser,
  page,
}) => {
  await useViewport(page, 1440);
  const { customer, job } = await bookedJob("Cass Cancelled");
  await loginAs(page, "admin");

  await openJob(page, job, { expectButton: "Start job" });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Cancel job" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Cancel ${job.jobReference}?` });
  await expect(dialog).toContainText("cannot be reopened");
  await expect(dialog).toContainText("Any booked time is released");
  const confirm = dialog.getByRole("button", { name: "Cancel job" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Reason \(internal\)/).fill(INTERNAL_REASON);
  await dialog.getByLabel(/Message to the customer/).fill(CUSTOMER_MESSAGE);
  await confirm.click();

  await expect(toast(page, `${job.jobReference} was cancelled`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "CANCELLED", { timeout: 20_000 });
  const outcome = card(page, "Cancellation");
  await expect(outcome).toContainText("Team only");
  await expect(outcome).toContainText(INTERNAL_REASON);
  await expect(
    page.locator("main").getByRole("button", { name: /Start|Complete|More actions/ }),
  ).toHaveCount(0);

  const cancelled = await workOrderById(job.jobId);
  expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: INTERNAL_REASON });
  expect(cancelled.cancelledAt).not.toBeNull();
  const mail = await emailWithSubject(customer.email, "job was cancelled");
  expect(mail.text).toContain(CUSTOMER_MESSAGE);
  expect(mail.text).not.toContain("INTERNAL-REASON");

  const portal = await customerPage(browser, customer);
  await openPortalJob(portal.page, job);
  await expect(card(portal.page, "Where things stand")).toContainText(
    "This job was cancelled, so no visit will take place.",
  );
  await expect(card(portal.page, "History")).toContainText("We cancelled your job.");
  expect(await pageText(portal.page)).not.toContain("INTERNAL-REASON");
  await portal.page.goto("/portal/jobs");
  await expect(portal.page.getByRole("list", { name: "Past jobs" })).toContainText("Cancelled", {
    timeout: NAVIGATION_TIMEOUT,
  });
  await portal.close();
});

test("a button that someone else has made stale is refused, and the page catches up", async ({
  browser,
  page,
}) => {
  await useViewport(page, 1440);
  const { job } = await bookedJob("Stan Stale");
  await loginAs(page, "admin");
  await openJob(page, job, { expectButton: "Start job" });

  // A second admin session already holds the job as scheduled, and starts it first.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await useViewport(other, 1440);
  await loginAs(other, "admin");
  await openJob(other, job, { expectButton: "Start job" });
  await other.getByRole("button", { name: "Start job", exact: true }).click();
  await other
    .getByRole("alertdialog", { name: `Start ${job.jobReference}?` })
    .getByRole("button", { name: "Start job" })
    .click();
  await expect(jobBadge(other)).toHaveAttribute("data-status", "IN_PROGRESS", { timeout: 20_000 });

  // The first page still shows SCHEDULED. Confirming there is refused, with nothing written twice.
  await page.getByRole("button", { name: "Start job", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `Start ${job.jobReference}?` });
  await dialog.getByRole("button", { name: "Start job" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Someone else changed this job, so the page has been reloaded.",
    { timeout: 20_000 },
  );
  expect((await jobEventsOf(job.jobId)).map((event) => event.action)).toEqual([
    "work_order.started",
  ]);

  // The page caught up behind the dialog: closing it shows a job under way, offering Complete.
  await dialog.getByRole("button", { name: "Not yet" }).click();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "IN_PROGRESS", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Complete job", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start job", exact: true })).toHaveCount(0);
  await otherContext.close();
});

test("the customer finds a job from their overview and from its request, and no one else can open it", async ({
  browser,
}) => {
  const { customer, job } = await bookedJob("Vera Visible");
  const stranger = await createCustomerAccount({ name: "Sid Stranger" });
  const mine = await customerPage(browser, customer);

  // ---- The overview lists the booked visit under "Upcoming visits" ---------------------------------
  await mine.page.goto("/portal");
  const visits = mine.page.getByRole("region", { name: "Upcoming visits" });
  await expect(visits).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(visits).toContainText(job.jobReference);
  await expect(visits).toContainText("Scheduled");
  await expect(visits).toContainText("With Jordan");
  await visits.getByRole("link", { name: new RegExp(job.jobReference) }).click();
  await expect(mine.page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // ---- The navigation has Jobs, and the request page links to its job -------------------------------
  await expect(
    mine.page.getByRole("navigation").getByRole("link", { name: "Jobs", exact: true }).first(),
  ).toBeVisible();
  await mine.page.goto(`/portal/requests/${job.requestId}`);
  const yourJob = card(mine.page, "Your job");
  await expect(yourJob).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(yourJob).toContainText(job.jobReference);
  await yourJob.getByRole("link", { name: /See when it is booked/ }).click();
  await expect(mine.page.getByRole("heading", { level: 1, name: job.jobReference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });

  // ---- Someone else's id looks exactly like an id that does not exist --------------------------------
  const other = await customerPage(browser, stranger);
  await other.page.goto(`/portal/jobs/${job.jobId}`);
  await expect(
    other.page.getByRole("heading", { level: 1, name: "We couldn't find that job" }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  expect(await pageText(other.page)).not.toContain(job.jobReference);
  await other.page.goto("/portal/jobs");
  await expect(
    other.page.getByRole("heading", { level: 2, name: "You don't have a job yet" }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await other.page.goto("/portal");
  // The other customer has nothing: welcomed (T23), and shown none of the first customer's visits.
  await expect(other.page.getByRole("heading", { name: /Welcome/ })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(other.page.getByRole("region", { name: "Upcoming visits" })).toHaveCount(0);

  await mine.close();
  await other.close();
});
