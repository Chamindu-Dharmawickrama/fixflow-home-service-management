import { expect, type Locator, type Page } from "@playwright/test";

import { withDatabase } from "../../fixtures/accounts.js";
import { createRequestsFor, type InsertedRequest } from "../../fixtures/requests.js";
import { NAVIGATION_TIMEOUT } from "./layout.js";

/** Twenty years of minutes: older than anything another spec leaves in the shared database. */
export const ANCIENT_MINUTES = 20 * 365 * 24 * 60;
const ANCIENT = new Date("2001-01-01T12:00:00.000Z");

export const figures = (page: Page): Locator => page.getByRole("region", { name: "Key figures" });
export const queue = (page: Page): Locator => page.getByRole("region", { name: "Needs attention" });
export const schedule = (page: Page): Locator =>
  page.getByRole("region", { name: "Upcoming schedule" });
export const activity = (page: Page): Locator =>
  page.getByRole("region", { name: "Recent activity" });

/** One of the five cards, found by the name of the link that is its label. */
export const card = (page: Page, label: string): Locator =>
  figures(page)
    .locator("li")
    .filter({ has: page.getByRole("link", { name: label, exact: true }) });

/** The number a card shows, read from its text ("New requests 7 Last 7 days"). */
export async function valueOf(page: Page, label: string): Promise<number> {
  const text = await card(page, label).innerText();
  const match = new RegExp(`${label}\\s+(\\d+)`).exec(text.replace(/\s+/g, " "));
  if (match?.[1] === undefined) {
    throw new Error(`Could not read the figure "${label}" from "${text}".`);
  }
  return Number(match[1]);
}

/** Opens the admin dashboard and waits until its figures are on the page. */
export async function openDashboard(page: Page, query = ""): Promise<void> {
  await page.goto(`/app/dashboard${query}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening),/ }),
  ).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expect(figures(page)).toBeVisible();
}

/**
 * A request that has waited longer than any other, so it leads its kind in the needs-attention queue.
 * The queue is oldest first and holds fifteen items; the shared E2E database holds every other
 * spec's requests, so a request made now could sit past the cut. The first-in-line request is the one
 * whose place is certain.
 */
export async function ancientRequestFor(
  userId: string,
  options: { oldest?: boolean } = {},
): Promise<InsertedRequest> {
  // `oldest` makes it older than the ones other specs plant, so its place is certain even when two
  // specs run at once: the queue always keeps the first item of every kind.
  const [request] = await createRequestsFor(userId, 1, {
    firstAgeMinutes:
      options.oldest === true ? ANCIENT_MINUTES + 5 * 365 * 24 * 60 : ANCIENT_MINUTES,
  });
  if (request === undefined) {
    throw new Error("The request was not created.");
  }
  return request;
}

/** Makes an accepted request the oldest of its kind, in the same way. */
export async function makeAcceptedAncient(requestId: string, quotationId: string): Promise<void> {
  await withDatabase(async (prisma) => {
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { respondedAt: ANCIENT },
    });
    await prisma.serviceRequest.update({ where: { id: requestId }, data: { updatedAt: ANCIENT } });
  });
}
