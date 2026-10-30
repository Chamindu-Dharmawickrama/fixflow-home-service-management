import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount, type FixtureAccount } from "../fixtures/accounts.js";
import { createAddressesFor, readAddressesOf, readProfileOf } from "../fixtures/addresses.js";
import { loginAs } from "../support/auth.js";
import {
  expectHydrated,
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";
import { expectOrderedHeadings, seriousViolations } from "./helpers/public.js";

/**
 * The customer's profile (T10, FR-013, IA-C06): contact details, service addresses and sign-in.
 * Every flow that changes data runs on a customer created for that test, never on the shared demo
 * customers, because the specs run in parallel and read the demo accounts' data. The demo customer
 * is only read. Addresses are inserted straight into the E2E database and read back from it.
 */

test.describe.configure({ timeout: 90_000 });

const PROFILE = "/portal/profile";

async function expectAccessible(page: Page): Promise<void> {
  expect(await seriousViolations(page), "serious axe violations").toBe("");
}

/** Opens the profile as a fresh customer with the given addresses, waiting for it to be usable. */
async function openProfile(
  page: Page,
  options: {
    addresses?: Parameters<typeof createAddressesFor>[1];
    name?: string;
  } = {},
): Promise<FixtureAccount> {
  const account = await createCustomerAccount({ name: options.name ?? "Jordan Fixture" });
  if (options.addresses !== undefined && options.addresses.length > 0) {
    await createAddressesFor(account.id, options.addresses);
  }
  await loginAs(page, account);
  await page.goto(PROFILE);
  await expectProfileReady(page);
  return account;
}

async function expectProfileReady(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(contactForm(page));
}

const contactForm = (page: Page) => page.getByRole("form", { name: "Contact details" });

/** One address card, found by its label heading. */
const card = (page: Page, label: string): Locator =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: label }) });

const toast = (page: Page, text: string | RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

const NEW_ADDRESS = {
  label: "Rental unit",
  street: "73 Millrace Court",
  city: "Harbor City",
  postalCode: "10998",
};

async function fillAddress(
  scope: Locator,
  values: Partial<typeof NEW_ADDRESS> & { notes?: string },
): Promise<void> {
  if (values.label !== undefined) await scope.getByLabel(/^Label/).fill(values.label);
  if (values.street !== undefined) await scope.getByLabel(/^Street address/).fill(values.street);
  if (values.city !== undefined) await scope.getByLabel(/^City/).fill(values.city);
  if (values.postalCode !== undefined)
    await scope.getByLabel(/^Postal code/).fill(values.postalCode);
  if (values.notes !== undefined) await scope.getByLabel(/^Access notes/).fill(values.notes);
}

test.describe("contact details", () => {
  test("shows the saved details, the email as read-only, and nothing to save yet", async ({
    page,
  }) => {
    await openProfile(page, { name: "Jordan Fixture" });
    const form = contactForm(page);

    await expect(form.getByLabel(/^Name/)).toHaveValue("Jordan Fixture");
    await expect(form.getByLabel(/^Phone number/)).toHaveValue("(212) 555-0100");
    const email = form.getByLabel("Email address");
    await expect(email).toHaveAttribute("readonly", "");
    await expect(email).toHaveValue(/@example\.test$/);
    await expect(form.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "/#contact",
    );
    await expect(form.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  test("edits the phone number, confirms after the server saved it, and keeps it after a reload", async ({
    page,
  }) => {
    const account = await openProfile(page);
    const form = contactForm(page);

    await form.getByLabel(/^Phone number/).fill("  (212)   555-0142 ");
    await form.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page, "Contact details saved")).toBeVisible();
    await expect(form.getByRole("button", { name: "Save changes" })).toBeDisabled();
    // The change is real, and tidied for storage: the database and a fresh page load agree.
    await expect.poll(async () => (await readProfileOf(account.id)).phone).toBe("(212) 555-0142");
    await page.reload();
    await expectProfileReady(page);
    await expect(contactForm(page).getByLabel(/^Phone number/)).toHaveValue("(212) 555-0142");
  });

  test("explains an invalid phone number beside the field and saves nothing", async ({ page }) => {
    const account = await openProfile(page);
    const form = contactForm(page);

    await form.getByLabel(/^Phone number/).fill("call me maybe");
    await form.getByRole("button", { name: "Save changes" }).click();

    const phone = form.getByLabel(/^Phone number/);
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText(/Enter a phone number with 7 to 15 digits/)).toBeVisible();
    await expect(toast(page, "Contact details saved")).toHaveCount(0);
    expect((await readProfileOf(account.id)).phone).toBe("(212) 555-0100");
  });

  test("clears the phone number", async ({ page }) => {
    const account = await openProfile(page);
    const form = contactForm(page);

    await form.getByLabel(/^Phone number/).fill("");
    await form.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page, "Contact details saved")).toBeVisible();
    await expect.poll(async () => (await readProfileOf(account.id)).phone).toBeNull();
  });

  test("changes the name everywhere it is shown", async ({ page }) => {
    const account = await openProfile(page, { name: "Jordan Fixture" });
    const form = contactForm(page);

    await form.getByLabel(/^Name/).fill("Jordan Renamed");
    await form.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page, "Contact details saved")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Account menu for Jordan Renamed" }),
    ).toBeVisible();
    expect((await readProfileOf(account.id)).name).toBe("Jordan Renamed");
    await page.goto("/portal");
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Jordan Renamed" }),
    ).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });
});

test.describe("service addresses", () => {
  test("guides a customer with no address to add one, and the first becomes the default", async ({
    page,
  }) => {
    const account = await openProfile(page);

    await expect(
      page.getByRole("heading", { level: 3, name: "No saved addresses yet" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add your first address" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an address" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Label/)).toBeFocused();

    // Empty: every required field is named, and nothing is sent.
    await dialog.getByRole("button", { name: "Save address" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Enter the label." })).toBeVisible();
    await expect(dialog.getByText("Enter the street address.").first()).toBeVisible();
    expect(await readAddressesOf(account.id)).toHaveLength(0);

    await fillAddress(dialog, { ...NEW_ADDRESS, notes: "Gate code 4471. Park on the street." });
    await dialog.getByRole("button", { name: "Save address" }).click();

    await expect(toast(page, /Rental unit.*saved/)).toBeVisible();
    await expect(dialog).toBeHidden();
    const item = card(page, "Rental unit");
    await expect(item).toBeVisible();
    await expect(item.getByText("Default", { exact: true })).toBeVisible();
    await expect(item.getByText("73 Millrace Court")).toBeVisible();
    await expect(item.getByText("Harbor City 10998")).toBeVisible();
    await expect(item.getByText(/Gate code 4471/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "No saved addresses yet" })).toHaveCount(0);

    const stored = await readAddressesOf(account.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      label: "Rental unit",
      line1: "73 Millrace Court",
      line2: null,
      region: null,
      postalCode: "10998",
      accessNotes: "Gate code 4471. Park on the street.",
      isDefault: true,
    });
  });

  test("adds a second address, makes it the default, then deletes it after a confirmation", async ({
    page,
  }) => {
    const account = await openProfile(page, {
      addresses: [{ label: "Home", line1: "214 Larkspur Lane", accessNotes: "Buzz 2B." }],
    });
    await expect(card(page, "Home").getByText("Default", { exact: true })).toBeVisible();

    // Add a second one: it is not the default.
    await page.getByRole("button", { name: "Add address" }).click();
    const dialog = page.getByRole("dialog", { name: "Add an address" });
    await fillAddress(dialog, {
      label: "Office",
      street: "9 Dock Street",
      city: "Harbor City",
      postalCode: "10001",
    });
    await dialog.getByRole("button", { name: "Save address" }).click();
    await expect(toast(page, /Office.*saved/)).toBeVisible();
    await expect(card(page, "Office")).toBeVisible();
    await expect(card(page, "Office").getByText("Default", { exact: true })).toHaveCount(0);
    await expect(card(page, "Home").getByText("Default", { exact: true })).toBeVisible();

    // Make it the default: the badge moves, and there is still exactly one.
    await card(page, "Office").getByRole("button", { name: "Set as default Office" }).click();
    await expect(toast(page, /Office.*now your default/)).toBeVisible();
    await expect(card(page, "Office").getByText("Default", { exact: true })).toBeVisible();
    await expect(card(page, "Home").getByText("Default", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Default", { exact: true })).toHaveCount(1);
    expect(
      (await readAddressesOf(account.id)).filter((row) => row.isDefault).map((row) => row.label),
    ).toEqual(["Office"]);

    // Delete the default: it asks first, and says what happens.
    await card(page, "Office").getByRole("button", { name: "Delete Office" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete “Office”?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      "Requests you have already made keep the address they were made with",
    );
    await expect(confirm).toContainText("This is your default address");
    expect(await readAddressesOf(account.id)).toHaveLength(2);

    await confirm.getByRole("button", { name: "Delete address" }).click();
    await expect(toast(page, /Office.*deleted/)).toBeVisible();
    await expect(card(page, "Office")).toHaveCount(0);
    // The remaining address took over as the default.
    await expect(card(page, "Home").getByText("Default", { exact: true })).toBeVisible();
    const stored = await readAddressesOf(account.id);
    expect(stored.map((row) => [row.label, row.isDefault])).toEqual([["Home", true]]);
  });

  test("cancelling the confirmation keeps the address", async ({ page }) => {
    const account = await openProfile(page, {
      addresses: [{ label: "Home" }, { label: "Office" }],
    });

    await card(page, "Office").getByRole("button", { name: "Delete Office" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();

    await expect(confirm).toBeHidden();
    await expect(card(page, "Office")).toBeVisible();
    expect(await readAddressesOf(account.id)).toHaveLength(2);
  });

  test("edits an address and sends only what changed", async ({ page }) => {
    const account = await openProfile(page, {
      addresses: [
        { label: "Home", line1: "214 Larkspur Lane", city: "Harbor City", accessNotes: "Buzz 2B." },
      ],
    });

    await card(page, "Home").getByRole("button", { name: "Edit Home" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit “Home”" });
    await expect(dialog.getByLabel(/^Street address/)).toHaveValue("214 Larkspur Lane");
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await dialog.getByLabel(/^City/).fill("Port Alder");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(toast(page, /Home.*updated/)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(card(page, "Home").getByText(/Port Alder/)).toBeVisible();
    const [stored] = await readAddressesOf(account.id);
    expect(stored).toMatchObject({
      city: "Port Alder",
      line1: "214 Larkspur Lane",
      accessNotes: "Buzz 2B.",
      isDefault: true,
    });
  });

  test("stops offering 'Add address' at ten and says why", async ({ page }) => {
    await openProfile(page, {
      addresses: Array.from({ length: 10 }, (_, n) => ({ label: `Place ${n + 1}` })),
    });

    await expect(page.getByRole("button", { name: "Add address" })).toBeDisabled();
    await expect(page.getByText(/maximum of 10 addresses/)).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) }),
    ).toHaveCount(10);
  });

  test("shows long access notes clipped, and the whole text in the edit form", async ({ page }) => {
    const notes = "Gate code 4471. Park on the street, not the drive. ".repeat(8).trim();
    await openProfile(page, { addresses: [{ label: "Home", accessNotes: notes }] });

    const clipped = card(page, "Home").getByText(/Access notes:/);
    const height = await clipped.evaluate((element) => element.getBoundingClientRect().height);
    const lineHeight = await clipped.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(height).toBeLessThanOrEqual(lineHeight * 2 + 2);

    await card(page, "Home").getByRole("button", { name: "Edit Home" }).click();
    await expect(page.getByRole("dialog").getByLabel(/^Access notes/)).toHaveValue(notes);
  });
});

test.describe("sign-in and security", () => {
  test("a customer who signs in with a password can change it", async ({ page }) => {
    await openProfile(page);

    await expect(page.getByRole("heading", { level: 2, name: "Sign-in & security" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
    await expect(page.getByText(/turned off in the demo/)).toHaveCount(0);
  });

  test("the shared demo customer sees their details and that password changes are turned off", async ({
    page,
  }) => {
    await loginAs(page, "customer");
    await page.goto(PROFILE);
    await expectProfileReady(page);

    await expect(contactForm(page).getByLabel(/^Name/)).toHaveValue("Alex Morgan");
    await expect(contactForm(page).getByLabel(/^Phone number/)).toHaveValue("(212) 555-0171");
    const home = card(page, "Home");
    await expect(home.getByText("Default", { exact: true })).toBeVisible();
    await expect(home.getByText("214 Larkspur Lane")).toBeVisible();
    await expect(home.getByText("Apt 2B")).toBeVisible();
    await expect(home.getByText(/Buzz apartment 2B/)).toBeVisible();
    await expect(page.getByText(/Password changes are turned off in the demo/)).toBeVisible();
    await expect(page.getByRole("form", { name: "Change password" })).toHaveCount(0);
  });
});

test.describe("getting to the profile", () => {
  test("the portal home summarises the profile, and the navigation and the account menu lead to it", async ({
    page,
  }) => {
    const account = await createCustomerAccount({ name: "Jordan Fixture" });
    await createAddressesFor(account.id, [
      { label: "Home", line1: "214 Larkspur Lane", city: "Harbor City" },
    ]);
    await loginAs(page, account);

    await expect(page.getByRole("heading", { level: 2, name: "Your profile" })).toBeVisible();
    await expect(page.getByText("(212) 555-0100")).toBeVisible();
    await expect(page.getByText("214 Larkspur Lane")).toBeVisible();

    await page.getByRole("link", { name: "View and edit your profile" }).click();
    await page.waitForURL("**/portal/profile", { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("aria-current", "page");

    await page
      .getByRole("navigation", { name: "Portal" })
      .getByRole("link", { name: "Overview" })
      .click();
    await page.waitForURL((url) => url.pathname === "/portal", { timeout: NAVIGATION_TIMEOUT });
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.waitForURL("**/portal/profile", { timeout: NAVIGATION_TIMEOUT });
  });

  test("the portal home says plainly that there is no address yet", async ({ page }) => {
    const account = await createCustomerAccount();
    await loginAs(page, account);

    await expect(page.getByText("No saved address yet")).toBeVisible();
  });

  test("a visitor who is signed out is sent to sign in and returns to the profile", async ({
    page,
  }) => {
    await page.goto(PROFILE);
    await page.waitForURL(/\/login\?returnTo=%2Fportal%2Fprofile/, { timeout: NAVIGATION_TIMEOUT });
  });

  test("an admin has no customer profile and is sent to the dashboard", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto(PROFILE);

    await page.waitForURL("**/app/dashboard", { timeout: NAVIGATION_TIMEOUT });
  });
});

test.describe("layout and accessibility", () => {
  const ADDRESSES = [
    {
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: "Apt 2B",
      accessNotes:
        "Buzz apartment 2B and wait. There is a friendly dog in the flat, so please keep the door closed behind you.",
    },
    { label: "Rental unit with a rather long label", line1: "73 Millrace Court" },
    { label: "Office", line1: "9 Dock Street" },
  ];

  for (const width of WIDTHS) {
    test(`works at ${width}px without sideways scrolling, with its dialogs`, async ({ page }) => {
      await useViewport(page, width);
      await openProfile(page, { addresses: ADDRESSES });
      await expect(card(page, "Home")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectOrderedHeadings(page);

      await page.getByRole("button", { name: "Add address" }).click();
      const dialog = page.getByRole("dialog", { name: "Add an address" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS("opacity", "1");
      await expectNoHorizontalOverflow(page);
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      // The delete confirmation has the same frame and must fit as well.
      await card(page, "Office").getByRole("button", { name: "Delete Office" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toHaveCSS("opacity", "1");
      const confirmBox = await confirm.boundingBox();
      expect(confirmBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((confirmBox?.x ?? 0) + (confirmBox?.width ?? 0)).toBeLessThanOrEqual(width);
    });
  }

  for (const width of [360, 1440]) {
    test(`has no serious accessibility violations at ${width}px: page, empty state and every dialog`, async ({
      page,
    }) => {
      await useViewport(page, width);
      const account = await openProfile(page, { addresses: ADDRESSES });
      await expectAccessible(page);

      // Add dialog, with its error summary showing.
      await page.getByRole("button", { name: "Add address" }).click();
      const add = page.getByRole("dialog", { name: "Add an address" });
      await expect(add).toHaveCSS("opacity", "1");
      await add.getByRole("button", { name: "Save address" }).click();
      await expect(add.getByRole("alert").filter({ hasText: "Enter the label." })).toBeVisible();
      await expectAccessible(page);
      await page.keyboard.press("Escape");
      await expect(add).toBeHidden();

      // Edit dialog.
      await card(page, "Home").getByRole("button", { name: "Edit Home" }).click();
      const edit = page.getByRole("dialog", { name: "Edit “Home”" });
      await expect(edit).toHaveCSS("opacity", "1");
      await expectAccessible(page);
      await page.keyboard.press("Escape");
      await expect(edit).toBeHidden();

      // Delete confirmation.
      await card(page, "Office").getByRole("button", { name: "Delete Office" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toHaveCSS("opacity", "1");
      await expectAccessible(page);
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toBeHidden();

      // Empty state: remove the addresses behind the page's back and reload.
      for (const row of await readAddressesOf(account.id)) {
        await page.evaluate(async (id) => {
          await fetch(`/api/v1/customers/me/addresses/${id}`, { method: "DELETE" });
        }, row.id);
      }
      await page.reload();
      await expectProfileReady(page);
      await expect(
        page.getByRole("heading", { level: 3, name: "No saved addresses yet" }),
      ).toBeVisible();
      await expectAccessible(page);
    });
  }

  test("can be used with the keyboard alone: add an address, set it as default, delete it", async ({
    page,
  }) => {
    const account = await openProfile(page, { addresses: [{ label: "Home" }] });

    await page.getByRole("button", { name: "Add address" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add an address" });
    await expect(dialog.getByLabel(/^Label/)).toBeFocused();
    await page.keyboard.type("Cabin");
    await page.keyboard.press("Tab");
    await page.keyboard.type("5 Pine Track");
    await page.keyboard.press("Tab"); // address line 2
    await page.keyboard.press("Tab");
    await page.keyboard.type("Harbor City");
    await page.keyboard.press("Tab"); // region
    await page.keyboard.press("Tab");
    await page.keyboard.type("10002");
    await page.keyboard.press("Enter");
    await expect(toast(page, /Cabin.*saved/)).toBeVisible();
    await expect(dialog).toBeHidden();
    // Focus returns to the control that opened the dialog.
    await expect(page.getByRole("button", { name: "Add address" })).toBeFocused();

    await card(page, "Cabin").getByRole("button", { name: "Set as default Cabin" }).focus();
    await page.keyboard.press("Enter");
    await expect(card(page, "Cabin").getByText("Default", { exact: true })).toBeVisible();

    await card(page, "Cabin").getByRole("button", { name: "Delete Cabin" }).focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm.getByRole("button", { name: "Delete address" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card(page, "Cabin")).toHaveCount(0);

    expect((await readAddressesOf(account.id)).map((row) => [row.label, row.isDefault])).toEqual([
      ["Home", true],
    ]);
  });
});
