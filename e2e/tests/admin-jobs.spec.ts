import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import { profileIdOf } from "../fixtures/customers.js";
import {
  countWorkOrdersOf,
  createAcceptedQuotationFor,
  createBookedJobFor,
  instantAt,
  jobEventsOf,
  jobNotificationsFor,
  ownTechnician,
  requestStatusOf,
  seededTechnician,
  uniqueFutureDay,
  workOrderById,
  workOrderOf,
} from "../fixtures/jobs.js";
import { deleteTechniciansTagged, newTechnicianTag } from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { WEB_URL } from "../support/env.js";
import { readOutbox, waitForEmailTo } from "../support/outbox.js";
import {
  card,
  conflictCheck,
  dialogReady,
  fillSchedule,
  JOB_PATH,
  jobBadge,
  openJob,
  scheduleDialog,
  toast,
  zoneAbbreviation,
} from "./helpers/jobs.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Turning an accepted quotation into a job and scheduling it (T17, workflow 7.4, FR-050 to FR-054,
 * FR-057). Every test runs on customers made for it, and every test but the first books a technician
 * made for it, because the specs run in parallel on one database and one shared team (a day picked
 * at random is not enough: two specs can draw the same one). The admin signs in
 * through the real form and uses the real screens; what happened is checked against what was stored.
 */

test.describe.configure({ timeout: 180_000 });

// The tests that book a technician make their own and remove it afterwards. Only the first test
// uses the seeded Jordan Lee, the one the task names, and no other spec books that diary.
const tags: string[] = [];
test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

async function openAcceptedRequest(page: Page, request: { id: string; reference: string }) {
  await page.goto(`/app/requests/${request.id}`);
  await expect(page.getByRole("heading", { level: 1, name: request.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  const create = page.getByRole("button", { name: "Create job", exact: true });
  await expect(create).toBeVisible();
  await expectHydrated(create);
  return create;
}

test("an admin creates a job from an accepted quotation, schedules it with Jordan Lee, and the customer is told", async ({
  browser,
  page,
}) => {
  await useViewport(page, 1440);
  const jordan = await seededTechnician("Jordan Lee");
  const customer = await createCustomerAccount({ name: "Quinn Quotable" });
  const { request, quotation } = await createAcceptedQuotationFor(customer.id, {
    accessNotes: "Side gate code is 4471.",
  });
  const day = uniqueFutureDay();
  await loginAs(page, "admin");

  // ---- "Create job" is the main action of an accepted request -------------------------------
  const create = await openAcceptedRequest(page, request);
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
  await create.click();

  // ---- It lands on the new job, with the scheduling dialog already open ---------------------
  await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const job = await workOrderOf(request.id);
  expect(job).not.toBeNull();
  if (job === null) return;
  expect(job.reference).toMatch(/^JOB-\d{4}-\d{5}$/);
  // The dialog is modal, so everything behind it is hidden from assistive technology (and from
  // `getByRole`) while it is open: look at the page itself.
  await expect(page.locator("main h1").filter({ hasText: job.reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(jobBadge(page)).toHaveAttribute("data-status", "PENDING_SCHEDULING");
  const dialog = await dialogReady(page, "Jordan Lee");
  await expect(dialog.getByText(/^Times in America\/New_York/)).toBeVisible();

  // Nothing was typed twice: the job carries the customer, the address and the agreed work.
  const stored = await workOrderById(job.id);
  expect(stored).toMatchObject({
    customerId: await profileIdOf(customer.id),
    serviceNameSnapshot: "AC Routine Maintenance",
    accessNotesSnapshot: "Side gate code is 4471.",
    status: "PENDING_SCHEDULING",
    quotationId: quotation.id,
  });
  expect(await requestStatusOf(request.id)).toBe("CONVERTED_TO_JOB");

  // ---- Schedule it: the date and time are the business's clocks ------------------------------
  await fillSchedule(dialog, { date: day, time: "10:00", technician: "Jordan Lee" });
  await expect(conflictCheck(dialog)).toContainText("Jordan Lee is free at that time.");
  await expect(dialog.getByText("Ends at 12:00 PM.")).toBeVisible();
  await dialog.getByRole("button", { name: "Schedule visit" }).click();

  await expect(toast(page, `${job.reference} is scheduled`)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });
  // The dialog closes and the primary action is now to move it, with focus back on that button.
  const reschedule = page.getByRole("button", { name: "Reschedule", exact: true });
  await expect(reschedule).toBeVisible();

  // ---- The job shows the appointment on the business's clocks, and everything it is about ----
  const start = instantAt(day, "10:00");
  const appointment = card(page, "Appointment");
  await expect(appointment).toContainText(`10:00 AM – 12:00 PM ${zoneAbbreviation(start)}`);
  await expect(appointment).toContainText("2 hours");
  await expect(appointment).toContainText("Jordan Lee");
  await expect(card(page, "Scope of work")).toContainText("Diagnostic visit");
  await expect(card(page, "Scope of work")).toContainText("$255.64");
  await expect(card(page, "Service address")).toContainText("Side gate code is 4471.");
  await expect(card(page, "Customer")).toContainText("Quinn Quotable");
  await expect(card(page, "History")).toContainText(`created job ${job.reference}`);
  await expect(card(page, "History")).toContainText("with Jordan Lee");

  // ---- What was stored ------------------------------------------------------------------------
  const booked = await workOrderById(job.id);
  expect(booked.status).toBe("SCHEDULED");
  expect(booked.technicianId).toBe(jordan.id);
  expect(booked.scheduledStart?.toISOString()).toBe(start.toISOString());
  expect(booked.scheduledEnd?.toISOString()).toBe(instantAt(day, "12:00").toISOString());
  const events = await jobEventsOf(job.id);
  expect(events.map((event) => event.action)).toEqual([
    "work_order.created",
    "work_order.scheduled",
  ]);
  expect(events[1]?.publicSummary).toMatch(/^We scheduled your visit for .+10:00 AM – 12:00 PM/);
  expect(events[1]?.publicSummary).not.toContain("Jordan");
  expect(events[1]?.metadata).toMatchObject({
    scheduledStart: start.toISOString(),
    technicianId: jordan.id,
  });

  // ---- The customer is told: in the app and by email, with no technician in either ----------
  const [notice] = await jobNotificationsFor(customer.id);
  expect(notice).toMatchObject({
    type: "JOB_SCHEDULED",
    title: `Visit for ${job.reference} scheduled`,
    linkPath: `/portal/requests/${request.id}`,
  });
  expect(notice?.message).toContain("10:00 AM – 12:00 PM");
  const email = await waitForEmailTo(customer.email);
  expect(email.subject).toBe("Your AC Routine Maintenance visit is scheduled");
  expect(email.text).toContain("10:00 AM – 12:00 PM");
  expect(email.text).toContain(job.reference);
  for (const secret of ["Jordan", "555-0151"]) {
    expect(email.text).not.toContain(secret);
  }

  // ---- The customer's own pages show it, and nothing of the technician -----------------------
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await useViewport(customerPage, 1440);
  await loginAs(customerPage, customer);
  const bell = customerPage.getByRole("button", { name: "1 unread notification", exact: true });
  await expect(bell).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(bell);
  await bell.click();
  const notifications = customerPage.getByRole("dialog", { name: "Notifications" });
  await expect(notifications).toContainText(`Visit for ${job.reference} scheduled`);
  await expect(notifications).not.toContainText("Jordan");
  await customerPage.goto(`/portal/requests/${request.id}`);
  await expect(
    customerPage.getByText(/We scheduled your visit for .+10:00 AM – 12:00 PM/),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(customerPage.getByText("Jordan")).toHaveCount(0);
  await customerContext.close();
});

test("pressing 'Create job' twice makes one job, and the same job opens", async ({ page }) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Dana Doublepress" });
  const { request, quotation } = await createAcceptedQuotationFor(customer.id);
  await loginAs(page, "admin");

  // A second tab already holds the request page, from before the job existed.
  const second = await page.context().newPage();
  await useViewport(second, 1440);
  const firstButton = await openAcceptedRequest(page, request);
  const secondButton = await openAcceptedRequest(second, request);

  await firstButton.click();
  await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const job = await workOrderOf(request.id);
  expect(job).not.toBeNull();

  // The other tab's button is stale: pressing it opens the same job instead of making another.
  await secondButton.click();
  await expect(second).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  expect(second.url()).toContain(job?.id ?? "missing");
  expect(await countWorkOrdersOf(request.id)).toBe(1);
  const events = await jobEventsOf(job?.id ?? "");
  expect(events.filter((event) => event.action === "work_order.created")).toHaveLength(1);
  expect(quotation.id).toBeTruthy();
});

test("a conflicting time is shown before saving and refused on saving; a back-to-back time goes through", async ({
  page,
}) => {
  await useViewport(page, 1440);
  // This test's own technician: no other spec books their diary, so the clash is exactly one job.
  const tag = newTechnicianTag();
  tags.push(tag);
  const jordan = await ownTechnician(tag);
  const owner = await createCustomerAccount({ name: "Olive Owner" });
  const newcomer = await createCustomerAccount({ name: "Nico Newcomer" });
  const day = uniqueFutureDay();
  // Another customer's job is already booked with Jordan from 10:00 to 12:00.
  const existing = await createBookedJobFor(owner.id, jordan.id, day, "10:00", "12:00");
  const { request } = await createAcceptedQuotationFor(newcomer.id);
  await loginAs(page, "admin");
  await (await openAcceptedRequest(page, request)).click();
  await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const job = await workOrderOf(request.id);
  if (job === null) throw new Error("The job was not made.");
  const dialog = await dialogReady(page, jordan.name);

  // ---- Choosing an overlapping time: the dialog says so before anything is saved -------------
  await fillSchedule(dialog, { date: day, time: "11:00", technician: jordan.name });
  await expect(
    dialog.getByRole("region", { name: `${jordan.name}'s other jobs that day` }),
  ).toContainText(`${existing.jobReference}, 10:00 AM – 12:00 PM`);
  await expect(conflictCheck(dialog)).toContainText(
    `Conflicts with ${existing.jobReference}, 10:00 AM – 12:00 PM.`,
  );

  // ---- Saving it anyway: the server refuses, with the job it collided with, and nothing is lost --
  await dialog.getByRole("button", { name: "Schedule visit" }).click();
  const refusal = dialog.getByRole("alert");
  await expect(refusal).toContainText(
    `${jordan.name} is already booked for ${existing.jobReference}`,
  );
  await expect(refusal).toContainText("Your entries are kept");
  await expect(dialog.getByLabel(/^Date/)).toHaveValue(day);
  await expect(dialog.getByLabel(/^Start time/)).toHaveValue("11:00");
  await expect(dialog.getByLabel(/^Technician/)).toHaveValue(jordan.id);
  await expect(dialog.getByRole("button", { name: "Schedule visit" })).toBeEnabled();
  const untouched = await workOrderById(job.id);
  expect(untouched).toMatchObject({ status: "PENDING_SCHEDULING", technicianId: null });
  expect(untouched.scheduledStart).toBeNull();
  expect((await jobNotificationsFor(newcomer.id)).length).toBe(0);

  // ---- A back-to-back time (it starts the moment the other one ends) succeeds ----------------
  await fillSchedule(dialog, { time: "12:00" });
  await expect(refusal).toBeHidden();
  await expect(conflictCheck(dialog)).toContainText(`${jordan.name} is free at that time.`);
  await dialog.getByRole("button", { name: "Schedule visit" }).click();
  await expect(toast(page, `${job.reference} is scheduled`)).toBeVisible();
  await expect(jobBadge(page)).toHaveAttribute("data-status", "SCHEDULED", { timeout: 20_000 });

  const booked = await workOrderById(job.id);
  expect(booked.scheduledStart?.toISOString()).toBe(instantAt(day, "12:00").toISOString());
  expect(booked.technicianId).toBe(jordan.id);
  // The other job did not move.
  const other = await workOrderById(existing.jobId);
  expect(other.scheduledStart?.toISOString()).toBe(instantAt(day, "10:00").toISOString());
});

test("moving a scheduled job needs a reason, shows the old time, and tells the customer the new one", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const tag = newTechnicianTag();
  tags.push(tag);
  const jordan = await ownTechnician(tag);
  const customer = await createCustomerAccount({ name: "Remy Reschedule" });
  const day = uniqueFutureDay();
  const booked = await createBookedJobFor(customer.id, jordan.id, day, "10:00", "12:00");
  await loginAs(page, "admin");
  await openJob(page, booked, { expectButton: "Reschedule" });
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();

  // ---- The form starts from the appointment, on the business's clocks ------------------------
  const dialog = await dialogReady(page, jordan.name);
  await expect(dialog).toHaveAccessibleName("Reschedule visit");
  await expect(dialog.getByLabel(/^Date/)).toHaveValue(day);
  await expect(dialog.getByLabel(/^Start time/)).toHaveValue("10:00");
  await expect(dialog.getByLabel(/^How long/)).toHaveValue("120");
  await expect(dialog.getByLabel(/^Technician/)).toHaveValue(jordan.id);

  // ---- No reason, no move ---------------------------------------------------------------------
  await fillSchedule(dialog, { time: "14:00" });
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();
  await expect(dialog.getByText(/Enter a reason of 5 to 200 characters/)).toBeVisible();
  await expect(dialog.getByLabel(/^Reason for moving it/)).toBeFocused();
  expect((await workOrderById(booked.jobId)).scheduledStart?.toISOString()).toBe(
    instantAt(day, "10:00").toISOString(),
  );

  // ---- With one, it moves, and the customer reads the new time and not the reason ------------
  const reason = "The replacement capacitor arrives a day late.";
  await fillSchedule(dialog, { reason });
  await dialog.getByRole("button", { name: "Reschedule visit" }).click();
  await expect(toast(page, `${booked.jobReference} was rescheduled`)).toBeVisible();
  await expect(card(page, "Appointment")).toContainText("2:00 – 4:00 PM", { timeout: 20_000 });

  const events = await jobEventsOf(booked.jobId);
  const moved = events.find((event) => event.action === "work_order.rescheduled");
  expect(moved?.summary).toContain(`Reason: ${reason}`);
  expect(moved?.summary).toContain("10:00 AM – 12:00 PM");
  expect(moved?.publicSummary).toMatch(/^We moved your visit to .+2:00 – 4:00 PM/);
  expect(moved?.publicSummary).not.toContain("capacitor");
  expect(moved?.metadata).toMatchObject({
    previousScheduledStart: instantAt(day, "10:00").toISOString(),
    scheduledStart: instantAt(day, "14:00").toISOString(),
  });
  const [notice] = await jobNotificationsFor(customer.id);
  expect(notice?.type).toBe("JOB_RESCHEDULED");
  expect(notice?.message).toContain("2:00 – 4:00 PM");
  expect(notice?.message).not.toContain("capacitor");
  const email = await waitForEmailTo(customer.email);
  expect(email.subject).toBe("Your AC Routine Maintenance visit has moved");
  expect(email.text).toContain("2:00 – 4:00 PM");
  expect(email.text).toContain("10:00 AM – 12:00 PM");
  expect(email.text).not.toContain("capacitor");
  expect(readOutbox().length).toBeGreaterThan(0);
});

test("a job nobody has scheduled yet says so, and the dialog can be closed with the keyboard", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Kit Keyboard" });
  const { request } = await createAcceptedQuotationFor(customer.id);
  await loginAs(page, "admin");
  await (await openAcceptedRequest(page, request)).click();
  await expect(page).toHaveURL(JOB_PATH, { timeout: NAVIGATION_TIMEOUT });
  const dialog = scheduleDialog(page);
  await expect(dialog).toBeVisible({ timeout: NAVIGATION_TIMEOUT });

  // Escape closes the dialog and leaves the page as it was, with focus on the button that opens it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const schedule = page.getByRole("button", { name: "Schedule", exact: true });
  await expect(schedule).toBeFocused();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(card(page, "Appointment")).toContainText("Not scheduled yet");
  await expect(jobBadge(page)).toHaveAttribute("data-status", "PENDING_SCHEDULING");

  // And it opens again from the button, fresh.
  await schedule.press("Enter");
  await expect(scheduleDialog(page)).toBeVisible();
  await expect(scheduleDialog(page).getByLabel(/^Date/)).toHaveValue("");
});

test("sends a visitor to sign in, turns a customer away from the pages and the API, and lists Jobs only for the business", async ({
  page,
}) => {
  await useViewport(page, 1440);
  const customer = await createCustomerAccount({ name: "Cleo Customer" });
  const { request } = await createAcceptedQuotationFor(customer.id);

  await page.goto("/app/jobs");
  await page.waitForURL(/\/login\?returnTo=%2Fapp%2Fjobs/, { timeout: NAVIGATION_TIMEOUT });

  await loginAs(page, customer);
  await expect(page.getByRole("link", { name: "Jobs", exact: true })).toHaveCount(0);
  await page.goto("/app/jobs");
  await expect(
    page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("table", { name: "Jobs" })).toHaveCount(0);

  for (const path of ["/api/v1/admin/work-orders", "/api/v1/admin/work-orders/conflicts"]) {
    expect((await page.request.get(path)).status(), path).toBe(403);
  }
  // Nor can they make a job, even from their own accepted quotation.
  const created = await page.request.post(`/api/v1/admin/quotations/${request.id}/work-order`, {
    headers: { Origin: WEB_URL },
  });
  expect(created.status()).toBe(403);
  expect(await countWorkOrdersOf(request.id)).toBe(0);
});

test("the business navigation lists Jobs, and it opens the list", async ({ page }) => {
  await useViewport(page, 1440);
  await loginAs(page, "admin");
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/jobs$/, { timeout: NAVIGATION_TIMEOUT });
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
});
