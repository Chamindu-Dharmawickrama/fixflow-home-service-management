import { expect, type Locator, type Page } from "@playwright/test";

import { expectHydrated, NAVIGATION_TIMEOUT } from "./layout.js";

/** Shared steps of the job and scheduling specs (T17): each is something a person does or sees. */

export const JOB_PATH = /\/app\/jobs\/[0-9a-f-]{36}(\?schedule=1)?$/;

/** The scheduling dialog, for either a first booking or a move. */
export const scheduleDialog = (page: Page): Locator =>
  page.getByRole("dialog", { name: /^(Schedule|Reschedule) visit$/ });

/** The status badge in the header of the page in front. */
export const jobBadge = (page: Page): Locator =>
  page.locator("main header [data-status]").filter({ visible: true }).first();

export const toast = (page: Page, text: string): Locator =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

/**
 * Next keeps the page you came from mounted, hidden, after a navigation, so a card can match two
 * elements. A person only ever sees the visible one.
 */
export const card = (page: Page, heading: string): Locator =>
  page
    .getByRole("heading", { level: 2, name: heading })
    .filter({ visible: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");

/** The short name of the business's zone at an instant: "EST" in winter, "EDT" in summer. */
export function zoneAbbreviation(instant: Date, timeZone = "America/New_York"): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((candidate) => candidate.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Opens a job's page and waits for it to be drawn and its buttons to respond. */
export async function openJob(
  page: Page,
  job: { jobId: string; jobReference: string } | { id: string; reference: string },
  options: { expectButton?: string } = {},
): Promise<void> {
  const { id, reference } =
    "jobId" in job
      ? { id: job.jobId, reference: job.jobReference }
      : { id: job.id, reference: job.reference };
  await page.goto(`/app/jobs/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  if (options.expectButton !== undefined) {
    const button = page.getByRole("button", { name: options.expectButton, exact: true });
    await expect(button).toBeVisible();
    await expectHydrated(button);
  }
}

/** Waits until the dialog has loaded the technicians, so the form can be filled. */
export async function dialogReady(page: Page, technician: string): Promise<Locator> {
  const dialog = scheduleDialog(page);
  await expect(dialog).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expect(
    // The whole name: another test's technician may be called "Jordan Lee <tag>".
    dialog.getByLabel(/^Technician/).locator("option", { hasText: new RegExp(`^${technician}$`) }),
  ).toHaveCount(1, { timeout: NAVIGATION_TIMEOUT });
  return dialog;
}

export interface ScheduleValues {
  date?: string;
  time?: string;
  duration?: string;
  technician?: string;
  reason?: string;
}

/** Fills the scheduling dialog the way a person does. Only what is given is changed. */
export async function fillSchedule(dialog: Locator, values: ScheduleValues): Promise<void> {
  if (values.date !== undefined) await dialog.getByLabel(/^Date/).fill(values.date);
  if (values.time !== undefined) await dialog.getByLabel(/^Start time/).fill(values.time);
  if (values.duration !== undefined) {
    await dialog.getByLabel(/^How long/).selectOption({ label: values.duration });
  }
  if (values.technician !== undefined) {
    await dialog.getByLabel(/^Technician/).selectOption({ label: values.technician });
  }
  if (values.reason !== undefined)
    await dialog.getByLabel(/^Reason for moving it/).fill(values.reason);
}

/** The feedback line under the form about whether the exact time is free. */
export const conflictCheck = (dialog: Locator): Locator => dialog.getByTestId("conflict-check");
