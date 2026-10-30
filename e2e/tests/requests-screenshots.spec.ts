import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { addDaysToDateOnly, preferredDateRange } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import { createAddressesFor } from "../fixtures/addresses.js";
import { userIdFor } from "../fixtures/notifications.js";
import {
  createEventOn,
  createNoteOn,
  createRequestsFor,
  readRequestsOf,
} from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT, useViewport } from "./helpers/layout.js";

/**
 * Screenshots of the T11 screens at the narrowest and widest required widths, for the visual review
 * recorded in docs/IMPLEMENTATION_PROGRESS.md: the request form (empty, with errors, with a new
 * address, filled), the confirmation, a request, the list, the overview and the empty list. They are
 * written to the git-ignored artifacts folder; the tests fail only if a page does not render.
 */

test.describe.configure({ timeout: 120_000 });

const SCREENSHOT_DIR = resolve(import.meta.dirname, "../../artifacts/screenshots/t11");
const ADDRESSES = [
  {
    label: "Home",
    line1: "214 Larkspur Lane",
    line2: "Apt 2B",
    city: "Harbor City",
    postalCode: "10999",
    accessNotes:
      "Buzz apartment 2B. There is a friendly dog in the flat, so please keep the door closed.",
  },
  { label: "Rental unit", line1: "73 Millrace Court", city: "Harbor City", postalCode: "10998" },
];
const DESCRIPTION =
  "The AC unit stopped cooling overnight and rattles loudly whenever it starts up. It began two days ago and the outdoor fan seems to be running very slowly.";

async function shoot(page: Page, width: number, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const dir = resolve(SCREENSHOT_DIR, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

async function signedIn(page: Page, withAddresses = true): Promise<FixtureAccount> {
  const account = await createCustomerAccount({ name: "Alex Morgan" });
  if (withAddresses) await createAddressesFor(account.id, ADDRESSES);
  await loginAs(page, account);
  return account;
}

async function openForm(page: Page, query = ""): Promise<void> {
  await page.goto(`/request-service${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Request a service" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("form", { name: "Request a service" }));
  await expectHydrated(page.getByLabel(/^Preferred date/));
}

for (const width of [360, 1440]) {
  test.describe(`at ${width} px`, () => {
    test("the request form: empty, with errors, with a new address, and filled in", async ({
      page,
    }) => {
      await useViewport(page, width);
      await signedIn(page);
      await openForm(page, "?service=ac-routine-maintenance");
      const form = page.getByRole("form", { name: "Request a service" });
      await shoot(page, width, "form-empty");

      await form.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "problems to fix" })).toBeVisible();
      await shoot(page, width, "form-errors");

      await form.getByRole("button", { name: "Add a new address" }).click();
      await form.getByRole("switch", { name: "Save this address to my profile" }).click();
      await shoot(page, width, "form-new-address");

      await form.getByRole("button", { name: "Use a saved address instead" }).click();
      await form.getByLabel(/^What needs fixing/).fill(DESCRIPTION);
      const { min } = preferredDateRange(new Date(), "America/New_York");
      await form.getByLabel(/^Preferred date/).fill(addDaysToDateOnly(min, 3));
      await form.getByRole("radio", { name: /Afternoon/ }).click();
      await shoot(page, width, "form-filled");
    });

    test("the confirmation, a request with a note and history, the list and the overview", async ({
      page,
    }) => {
      await useViewport(page, width);
      const account = await signedIn(page);
      const created = await createRequestsFor(account.id, 5);
      const [stored] = await readRequestsOf(account.id);
      const target = created.at(-1);
      const adminId = await userIdFor("admin@demo.fixflow.test");
      await createNoteOn(
        target?.id ?? "",
        adminId,
        "We will bring a replacement capacitor with us, so the visit should take about an hour.",
        "CUSTOMER_VISIBLE",
      );
      await createEventOn(
        { id: target?.id ?? "", customerId: stored?.customerId ?? "" },
        adminId,
        "Reviewed.",
        "We reviewed your request.",
      );

      await page.goto(`/portal/requests/${target?.id}?submitted=1`);
      await expect(page.getByRole("heading", { name: "Your request has been sent" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "confirmation");

      await page.goto(`/portal/requests/${target?.id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: target?.reference ?? "" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "request-detail");

      await page.goto("/portal/requests");
      await expect(page.getByRole("heading", { level: 1, name: "Your requests" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "list");

      await page.goto("/portal");
      await expect(page.getByRole("region", { name: "Your requests" })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "overview");
    });

    test("the empty list and the 'not found' state", async ({ page }) => {
      await useViewport(page, width);
      await signedIn(page, false);

      await page.goto("/portal/requests");
      await expect(
        page.getByRole("heading", { name: "You haven't sent a request yet" }),
      ).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await shoot(page, width, "list-empty");

      await page.goto("/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11");
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that request" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await shoot(page, width, "not-found");
    });
  });
}
