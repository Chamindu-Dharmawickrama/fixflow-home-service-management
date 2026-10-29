import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  createNotificationsFor,
  readAtOf,
  SAMPLE_NOTIFICATIONS,
  userIdFor,
} from "../fixtures/notifications.js";
import { loginAs } from "../support/auth.js";
import { DEMO_ADMIN_EMAIL } from "../support/env.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
} from "./helpers/layout.js";

/**
 * The notification bell (T06, FR-091, UX-INT-06): a signed-in customer and the admin see how many
 * notifications are unread, open the list, choose one (which marks it read and goes to its page),
 * mark all read, and use all of it with the keyboard. Notifications are inserted straight into the
 * E2E database, because no workflow creates them until T11.
 */

test.describe.configure({ timeout: 90_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

async function expectAccessible(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const violations = await seriousViolations(page);
  const report = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary ?? ""}`)
          .join("\n"),
    )
    .join("\n");
  expect(violations, report).toEqual([]);
}

/** The bell by its accessible name, once the page has hydrated so a click is not lost. */
async function bellNamed(page: Page, name: string) {
  const bell = page.getByRole("button", { name, exact: true });
  await expect(bell).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(bell);
  return bell;
}

async function signedInCustomerWithNotifications(page: Page) {
  const account = await createCustomerAccount({ name: "Bell Tester" });
  const created = await createNotificationsFor(account.id, SAMPLE_NOTIFICATIONS);
  await loginAs(page, account);
  return { account, created };
}

test.describe("the notification bell (customer)", () => {
  test("shows the unread count, lists the notifications, and marks one read when it is chosen", async ({
    page,
  }) => {
    const { created } = await signedInCustomerWithNotifications(page);
    const [quotation, request, invoice] = created;

    const bell = await bellNamed(page, "2 unread notifications");
    await bell.click();
    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByRole("link")).toHaveCount(3);

    // Newest first, each with its message and how long ago it arrived; the unread ones say so.
    const rows = popover.getByRole("link");
    await expect(rows.nth(0)).toContainText("Quotation QT-2026-00004 is ready");
    // A few minutes, however long the first compile of the page took.
    await expect(rows.nth(0)).toContainText(/\d+ minutes? ago/);
    await expect(rows.nth(0)).toContainText("Unread:");
    await expect(rows.nth(1)).toContainText("Request FF-2026-00012 received");
    await expect(rows.nth(2)).toContainText("Invoice INV-2026-00007 is ready");
    await expect(rows.nth(2)).not.toContainText("Unread:");

    // Choosing the first one goes to its page and marks it read.
    await rows.nth(0).click();
    await expect(page).toHaveURL(/\/portal\?from=quotation$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(
      page.getByRole("button", { name: "1 unread notification", exact: true }),
    ).toBeVisible();
    await expect(popover).toBeHidden();

    // The change is real: the database and a fresh page load agree.
    await expect
      .poll(async () => (await readAtOf(quotation?.id ?? ""))?.toISOString() ?? null)
      .not.toBeNull();
    expect(await readAtOf(request?.id ?? "")).toBeNull();
    expect(await readAtOf(invoice?.id ?? "")).not.toBeNull();
    await page.reload();
    await bellNamed(page, "1 unread notification");
  });

  test("marks everything read with 'Mark all as read'", async ({ page }) => {
    const { created } = await signedInCustomerWithNotifications(page);

    await (await bellNamed(page, "2 unread notifications")).click();
    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByRole("link")).toHaveCount(3);
    await popover.getByRole("button", { name: "Mark all as read" }).click();

    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    await expect(popover.getByText("Unread:")).toHaveCount(0);
    await expect(popover.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    for (const notification of created) {
      await expect
        .poll(async () => (await readAtOf(notification.id))?.toISOString() ?? null)
        .not.toBeNull();
    }
  });

  test("says 'You're all caught up' when there is nothing to show", async ({ page }) => {
    const account = await createCustomerAccount({ name: "Quiet Customer" });
    await loginAs(page, account);

    await (await bellNamed(page, "Notifications")).click();

    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByText("You're all caught up")).toBeVisible();
    await expect(popover.getByRole("link")).toHaveCount(0);
  });

  test("shows a person only their own notifications", async ({ page }) => {
    const other = await createCustomerAccount({ name: "Someone Else" });
    await createNotificationsFor(other.id, [
      {
        title: "Someone else's private notification",
        message: "This must never appear for another customer.",
        linkPath: "/portal?from=other",
      },
    ]);
    await signedInCustomerWithNotifications(page);

    await (await bellNamed(page, "2 unread notifications")).click();

    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByRole("link")).toHaveCount(3);
    await expect(popover).not.toContainText("Someone else's private notification");
  });

  test("never claims that an email was sent or delivered", async ({ page }) => {
    await signedInCustomerWithNotifications(page);

    await (await bellNamed(page, "2 unread notifications")).click();

    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByRole("link")).toHaveCount(3);
    const text = (await popover.innerText()).toLowerCase();
    expect(text).not.toMatch(/e-?mail|delivered|inbox/);
  });

  test("works with the keyboard alone, and Escape returns focus to the bell", async ({ page }) => {
    await signedInCustomerWithNotifications(page);

    const bell = await bellNamed(page, "2 unread notifications");
    await bell.focus();
    await page.keyboard.press("Enter");

    const popover = page.getByRole("dialog", { name: "Notifications" });
    await expect(popover.getByRole("link")).toHaveCount(3);
    // Tab reaches the button and the rows inside the popover.
    const reached = new Set<string>();
    for (let step = 0; step < 5; step += 1) {
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (await popover.evaluate((element) => element.contains(document.activeElement))) {
        reached.add(label);
      }
      await page.keyboard.press("Tab");
    }
    expect([...reached].some((label) => label.includes("Mark all as read"))).toBe(true);
    expect([...reached].some((label) => label.includes("Quotation QT-2026-00004"))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(bell).toBeFocused();
  });

  for (const width of [360, 1440]) {
    test(`is accessible and fits the screen at ${width}px with the list open`, async ({ page }) => {
      await useViewport(page, width);
      await signedInCustomerWithNotifications(page);

      await (await bellNamed(page, "2 unread notifications")).click();
      const popover = page.getByRole("dialog", { name: "Notifications" });
      await expect(popover.getByRole("link")).toHaveCount(3);
      // The popover fades in; contrast is only meaningful once it is fully opaque.
      await expect(popover).toHaveCSS("opacity", "1");

      await expectNoHorizontalOverflow(page);
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      await expectAccessible(page);
    });
  }
});

test.describe("the notification bell (admin)", () => {
  test("opens a notification on a page of the admin area and marks it read", async ({ page }) => {
    // The demo admin is shared by every test that signs in as admin, so look for this
    // notification by a title nobody else uses, never by "the only one".
    const title = `New request FF-2026-${randomUUID().slice(0, 8)}`;
    const adminId = await userIdFor(DEMO_ADMIN_EMAIL);
    const [created] = await createNotificationsFor(adminId, [
      {
        title,
        message: "Alex Morgan asked for AC Repair.",
        linkPath: "/app/account",
        type: "REQUEST_RECEIVED",
        ageMinutes: 1,
      },
    ]);
    await loginAs(page, "admin");
    await expect(page).toHaveURL(/\/app\/dashboard$/);

    const bell = page.getByRole("button", { name: /unread notifications?$/ });
    await expect(bell).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
    await expectHydrated(bell);
    await bell.click();
    const popover = page.getByRole("dialog", { name: "Notifications" });
    const link = popover.getByRole("link", { name: new RegExp(title) });
    await expect(link).toBeVisible();
    await expect(popover).toHaveCSS("opacity", "1");
    await expectAccessible(page);
    await link.click();

    await expect(page).toHaveURL(/\/app\/account$/, { timeout: NAVIGATION_TIMEOUT });
    await expect
      .poll(async () => (await readAtOf(created?.id ?? ""))?.toISOString() ?? null)
      .not.toBeNull();
  });
});
