import { expect, type Locator, type Page } from "@playwright/test";

import { expectHydrated, NAVIGATION_TIMEOUT } from "./layout.js";

/** Shared steps of the calendar specs (T19): each is something a person does or sees. */

/** The calendar region (it is named "Calendar" and by the range it shows). */
export const calendarRegion = (page: Page): Locator =>
  page.getByRole("region", { name: /^Calendar / });

/** Opens the calendar at an address and waits until it is drawn and its buttons respond. */
export async function openCalendar(page: Page, query: string): Promise<void> {
  await page.goto(`/app/calendar${query === "" ? "" : `?${query}`}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(calendarRegion(page)).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(page.getByRole("button", { name: /^Needs scheduling/ }));
}

/** The visit blocks on the time grid (a visit that runs past midnight has one in each day). */
export const blocks = (page: Page): Locator => page.getByTestId("visit-block");

/** The cards of the agenda. */
export const cards = (page: Page): Locator => page.getByTestId("visit-card");

/** The block or card of a job, found the way a screen reader finds it: by its accessible name. */
export const visitOf = (page: Page, reference: string): Locator =>
  page.getByRole("button", { name: new RegExp(`${reference}`) });

/** The drawer that opens from a visit. */
export const drawer = (page: Page, reference: string): Locator =>
  page.getByRole("dialog", { name: reference });

/** The side panel of jobs waiting for a time. */
export const needsPanel = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Needs scheduling" });

/** The vertical position of a block's top edge relative to the top of the hour row it should be in. */
export async function topOffsetFromHourRow(
  page: Page,
  block: Locator,
  hour: number,
): Promise<number> {
  const row = page.locator(`[data-hour="${String(hour)}"]`).first();
  const [blockBox, rowBox] = await Promise.all([block.boundingBox(), row.boundingBox()]);
  expect(blockBox, "the block has a box").not.toBeNull();
  expect(rowBox, `the ${String(hour)}:00 row has a box`).not.toBeNull();
  return (blockBox?.y ?? 0) - (rowBox?.y ?? 0);
}

/** True when two boxes share any area. */
export function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

/** "Tuesday, January 6, 2032": how the calendar names a day to a screen reader (a date-only value, no zone). */
export function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The list of one day's visits on the grid, found by its heading. */
export const dayList = (page: Page, date: string): Locator =>
  page.getByRole("list", { name: longDate(date), exact: false });
