import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { AdminServiceDto, PublicServiceDto, PublicSettingsDto } from "@fixflow/shared";
import { expect, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  deleteServicesNamed,
  E2E_SERVICE_PREFIX,
  restoreBusinessPhone,
  storedBusinessPhone,
} from "../fixtures/catalogue.js";
import { loginAs } from "../support/auth.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "./helpers/layout.js";

/**
 * Business settings and the service catalogue (T07, FR-100 to FR-102, FR-006, BR-04): the admin
 * edits the business phone and the public settings endpoint reflects it; the admin creates a
 * fixed-price service, publishes it and it appears in `GET /api/v1/services`; archives and
 * restores it; and the whole thing is reachable, understandable and accessible. Services are made
 * through the real screens and removed afterwards by their unique name, so runs do not pile up.
 */

test.describe.configure({ timeout: 120_000 });

const SETTINGS_PAGE = "/app/settings/business";
const SERVICES_PAGE = "/app/settings/services";

/** A name no other test or run shares. */
function uniqueName(label: string): string {
  return `${E2E_SERVICE_PREFIX}${label} ${randomUUID().slice(0, 8)}`;
}

const createdPrefixes: string[] = [];

test.afterEach(async () => {
  for (const prefix of createdPrefixes.splice(0)) {
    await deleteServicesNamed(prefix);
  }
});

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

async function openAs(page: Page, path: string, heading: string | RegExp): Promise<void> {
  await loginAs(page, "admin");
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
}

async function newServiceForm(page: Page) {
  await page.goto(`${SERVICES_PAGE}/new`);
  const form = page.getByRole("form", { name: "New service" });
  await expect(form).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
  await expectHydrated(form);
  return form;
}

/** Fills the whole new-service form with a fixed-price service, choosing the "Cleaning" picture. */
async function fillFixedService(page: Page, name: string): Promise<void> {
  await page.getByLabel(/^Service name/).fill(name);
  await page.getByLabel(/^Category/).fill("E2E testing");
  await page
    .getByLabel(/^Short description/)
    .fill("A service made by the end-to-end test to check publishing.");
  await page
    .getByLabel(/^Full description/)
    .fill("This service exists only while the automated tests run. It is removed afterwards.");
  await page.getByRole("radio", { name: /Fixed starting price/ }).click();
  await page.getByLabel(/^Starting price/).fill("149");
  await page.getByLabel(/^Usual time on site/).fill("120");
  await page.getByRole("button", { name: "Add inclusion" }).click();
  await page.getByLabel("Inclusion 1", { exact: true }).fill("Arrival and set-up");
  await page.getByRole("radio", { name: "One of the illustrations" }).click();
  await page.locator("label").filter({ hasText: "Cleaning" }).click();
}

async function publicServices(page: Page): Promise<PublicServiceDto[]> {
  const response = await page.request.get("/api/v1/services");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: PublicServiceDto[] }).data;
}

async function adminServiceBySlug(page: Page, slug: string): Promise<AdminServiceDto> {
  const response = await page.request.get(`/api/v1/admin/services?search=${slug}`);
  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: AdminServiceDto[] };
  const found = data.find((service) => service.slug === slug);
  expect(found, `no service with slug ${slug}`).toBeDefined();
  return found as AdminServiceDto;
}

// ---------------------------------------------------------------------------------------------

test.describe("business settings", () => {
  test("the admin edits the business phone and the public endpoint shows it", async ({ page }) => {
    const original = await storedBusinessPhone();
    const newPhone = "(212) 555-0188";
    try {
      await openAs(page, SETTINGS_PAGE, "Business settings");
      const form = page.getByRole("form", { name: "Business settings" });
      await expectHydrated(form);
      await expect(page.getByLabel(/^Phone number/)).toHaveValue(original);
      await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

      await page.getByLabel(/^Phone number/).fill(newPhone);
      await expect(page.getByText("You have unsaved changes.")).toBeVisible();
      await page.getByRole("button", { name: "Save changes" }).click();

      // Confirmed by the server: a toast, a clean form, and the public endpoint agrees.
      await expect(page.getByText("Settings saved")).toBeVisible();
      await expect(page.getByText("All changes are saved.")).toBeVisible();
      const response = await page.request.get("/api/v1/settings/public");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("public, max-age=60");
      const { data } = (await response.json()) as { data: PublicSettingsDto };
      expect(data.phone).toBe(newPhone);
      expect(Object.keys(data)).not.toContain("defaultTaxRate");

      // …and it survives a reload.
      await page.reload();
      await expect(page.getByLabel(/^Phone number/)).toHaveValue(newPhone);
    } finally {
      await restoreBusinessPhone(original);
    }
  });

  test("explains that region and tax changes apply to new documents only", async ({ page }) => {
    await openAs(page, SETTINGS_PAGE, "Business settings");

    const notice = page.getByTestId("new-documents-notice");
    await expect(notice).toContainText("apply to new quotations and invoices only");
    await expect(notice).toContainText("keep the currency, tax rate and terms they were made with");
  });

  test("shows a problem beside the field and keeps what was typed", async ({ page }) => {
    await openAs(page, SETTINGS_PAGE, "Business settings");
    await expectHydrated(page.getByRole("form", { name: "Business settings" }));

    await page.getByLabel(/^Default tax rate/).fill("100.5");
    await page.getByLabel(/^Phone number/).fill("call us");
    await page.getByRole("button", { name: "Save changes" }).click();

    const summary = page.getByRole("alert").filter({ hasText: "problems to fix" });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("The tax rate must be between 0 and 100.");
    await expect(summary).toContainText("Enter a phone number with 7 to 15 digits");
    await expect(page.getByLabel(/^Default tax rate/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(/^Default tax rate/)).toHaveValue("100.5");
    await expect(page.getByLabel(/^Phone number/)).toHaveValue("call us");
  });

  test("warns before unsaved changes are lost, and lets the person keep editing or leave", async ({
    page,
  }) => {
    await openAs(page, SETTINGS_PAGE, "Business settings");
    await expectHydrated(page.getByRole("form", { name: "Business settings" }));
    await page.getByLabel(/^Tagline/).fill("A tagline nobody saved");

    await page.getByRole("link", { name: "Services", exact: true }).first().click();

    const dialog = page.getByRole("alertdialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("they will be lost");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${SETTINGS_PAGE}$`));
    await expect(page.getByLabel(/^Tagline/)).toHaveValue("A tagline nobody saved");

    await page.getByRole("link", { name: "Services", exact: true }).first().click();
    await page
      .getByRole("alertdialog", { name: "Leave without saving?" })
      .getByRole("button", { name: "Leave without saving" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${SERVICES_PAGE}$`), { timeout: NAVIGATION_TIMEOUT });
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("the service catalogue", () => {
  test("the admin creates a fixed-price service, publishes it, and it appears on GET /api/v1/services", async ({
    page,
  }) => {
    const name = uniqueName("Fixed price");
    createdPrefixes.push(name);
    await openAs(page, SERVICES_PAGE, "Services");
    await expect(page.getByRole("link", { name: "New service" }).first()).toBeVisible();

    const form = await newServiceForm(page);
    await fillFixedService(page, name);

    // The preview shows what a visitor will see, before anything is saved.
    const preview = page.getByTestId("service-preview");
    await expect(preview).toContainText(name);
    await expect(preview).toContainText("From $149.00");
    await expect(preview).toContainText("2 hr");

    await form.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    // New services start unpublished, and are not on the website.
    await expect(page.getByText("Unpublished").first()).toBeVisible();
    const idInUrl = new URL(page.url()).pathname.split("/").pop();
    const created = await adminServiceBySlug(
      page,
      await page.getByLabel(/^Web address/).inputValue(),
    );
    expect(created).toMatchObject({
      name,
      pricingMode: "FIXED",
      startingPrice: "149.00",
      currencyCode: "USD",
      status: "UNPUBLISHED",
      imageKey: "cleaning",
      inclusions: ["Arrival and set-up"],
    });
    expect(idInUrl).toBe(created.id);
    expect((await publicServices(page)).map((service) => service.name)).not.toContain(name);

    // Publish with the switch.
    const published = page.getByRole("switch", { name: "Published on the website" });
    await expectHydrated(published);
    await published.click();
    await expect(page.getByText(`“${name}” is published`)).toBeVisible();
    await expect(published).toBeChecked();
    await expect.poll(async () => (await publicServices(page)).map((s) => s.name)).toContain(name);
    const live = (await publicServices(page)).find((service) => service.name === name);
    expect(live).toMatchObject({
      pricingMode: "FIXED",
      startingPrice: "149.00",
      currencyCode: "USD",
      slug: created.slug,
    });
    expect(Object.keys(live ?? {})).not.toContain("isPublished");

    // The public detail route works for it, by address and by id.
    expect((await page.request.get(`/api/v1/services/slug/${created.slug}`)).status()).toBe(200);
    expect((await page.request.get(`/api/v1/services/${created.id}`)).status()).toBe(200);

    // Unpublish: gone from the website at once, and 404 by address.
    await published.click();
    await expect(page.getByText(`“${name}” is unpublished`)).toBeVisible();
    await expect(published).not.toBeChecked();
    expect((await publicServices(page)).map((service) => service.name)).not.toContain(name);
    expect((await page.request.get(`/api/v1/services/slug/${created.slug}`)).status()).toBe(404);
  });

  test("archiving explains its effect, hides the service, and restoring brings it back unpublished", async ({
    page,
  }) => {
    const name = uniqueName("Archive");
    createdPrefixes.push(name);
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await fillFixedService(page, name);
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    const switchControl = page.getByRole("switch", { name: "Published on the website" });
    await expectHydrated(switchControl);
    await switchControl.click();
    await expect(switchControl).toBeChecked();
    const slug = await page.getByLabel(/^Web address/).inputValue();
    await expect.poll(async () => (await publicServices(page)).map((s) => s.slug)).toContain(slug);

    // Archive: the dialog says what happens, and cancelling changes nothing.
    await page.getByRole("button", { name: "Archive service" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Archive “${name}”?` });
    await expect(dialog).toContainText(
      "Archived services are hidden from the website and can't be requested. Existing requests are unaffected.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await publicServices(page)).map((s) => s.slug)).toContain(slug);

    await page.getByRole("button", { name: "Archive service" }).click();
    await page
      .getByRole("alertdialog", { name: `Archive “${name}”?` })
      .getByRole("button", { name: "Archive service" })
      .click();
    await expect(page.getByText(`“${name}” is archived`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore service" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Published on the website" })).toHaveCount(0);
    expect((await publicServices(page)).map((s) => s.slug)).not.toContain(slug);
    expect((await page.request.get(`/api/v1/services/slug/${slug}`)).status()).toBe(404);

    // Restore: back as unpublished, still off the website.
    await page.getByRole("button", { name: "Restore service" }).click();
    await page
      .getByRole("alertdialog", { name: `Restore “${name}”?` })
      .getByRole("button", { name: "Restore service" })
      .click();
    await expect(page.getByText(`“${name}” is restored`)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Published on the website" })).not.toBeChecked();
    expect((await publicServices(page)).map((s) => s.slug)).not.toContain(slug);
  });

  test("a web address that another service uses is refused beside its field, and nothing typed is lost", async ({
    page,
  }) => {
    const first = uniqueName("Taken");
    createdPrefixes.push(first);
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await fillFixedService(page, first);
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    const takenSlug = await page.getByLabel(/^Web address/).inputValue();

    const second = uniqueName("Second");
    createdPrefixes.push(second);
    await newServiceForm(page);
    await fillFixedService(page, second);
    await page.getByLabel(/^Web address/).fill(takenSlug);
    await page.getByRole("button", { name: "Create service" }).click();

    const slugField = page.getByLabel(/^Web address/);
    await expect(slugField).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByText("Another service already uses this web address").first(),
    ).toBeVisible();
    await expect(page.getByLabel(/^Service name/)).toHaveValue(second);
    await expect(page.getByLabel(/^Starting price/)).toHaveValue("149");
    await expect(page).toHaveURL(/\/services\/new$/);
  });

  test("editing an existing service changes only what was edited, and warns that a new address breaks links", async ({
    page,
  }) => {
    const name = uniqueName("Edit");
    createdPrefixes.push(name);
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await fillFixedService(page, name);
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    const form = page.getByRole("form", { name: "Edit service" });
    await expectHydrated(form);
    const originalSlug = await page.getByLabel(/^Web address/).inputValue();

    await page.getByLabel(/^Starting price/).fill("179.50");
    await page.getByLabel(/^Web address/).fill(`${originalSlug}-v2`);
    await expect(page.getByText(/breaks existing links/)).toBeVisible();
    await form.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Changes saved")).toBeVisible();
    await expect(page.getByText(/breaks existing links/)).toBeHidden();
    const updated = await adminServiceBySlug(page, `${originalSlug}-v2`);
    expect(updated).toMatchObject({ name, startingPrice: "179.50", category: "E2E testing" });
  });

  test("the list filters by tab and search, and shows guidance when nothing matches", async ({
    page,
  }) => {
    const name = uniqueName("Listed");
    createdPrefixes.push(name);
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await fillFixedService(page, name);
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });

    // Search by the unique name: one row, with its status as text.
    await page.goto(`${SERVICES_PAGE}?search=${encodeURIComponent(name)}`);
    const table = page.getByRole("table", { name: "Services" });
    await expect(table.getByRole("row", { name: new RegExp(name) })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(table).toContainText("Unpublished");
    await expect(table).toContainText("From $149.00");

    // The tabs are links that keep the search; the unpublished tab has it, the published one does not.
    await page.getByRole("link", { name: /^Published \d+$/ }).click();
    await expect(page).toHaveURL(/status=published/);
    await expect(page).toHaveURL(/search=/);
    await expect(page.getByRole("heading", { name: "No services match" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Published \d+$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("link", { name: "Show all services" }).click();
    await expect(page).toHaveURL(new RegExp(`${SERVICES_PAGE}$`));
    await expect(page.getByRole("table", { name: "Services" })).toBeVisible();

    // Clicking a row opens the service.
    await page.goto(`${SERVICES_PAGE}?search=${encodeURIComponent(name)}`);
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("the seeded services are listed, published, and sortable", async ({ page }) => {
    await openAs(page, `${SERVICES_PAGE}?status=published`, "Services");

    const table = page.getByRole("table", { name: "Services" });
    await expect(table).toContainText("AC Routine Maintenance");
    await expect(table).toContainText("Home Deep Cleaning");

    await page.getByRole("link", { name: "Service", exact: true }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByRole("columnheader", { name: "Service" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("who can reach the settings", () => {
  test("the admin sees the Settings group in the sidebar", async ({ page }) => {
    await openAs(page, "/app/dashboard", /^Good (morning|afternoon|evening),/);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByText("Settings", { exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Business" })).toHaveAttribute(
      "href",
      SETTINGS_PAGE,
    );
    await expect(nav.getByRole("link", { name: "Services" })).toHaveAttribute(
      "href",
      SERVICES_PAGE,
    );
  });

  test("the nav marks the current settings page", async ({ page }) => {
    await openAs(page, SERVICES_PAGE, "Services");

    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Services" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a customer is not shown the settings and cannot open them", async ({ page }) => {
    const account = await createCustomerAccount({ name: "Curious Customer" });
    await loginAs(page, account);

    await expect(page.getByRole("link", { name: /Business|Services/ })).toHaveCount(0);

    for (const path of [SETTINGS_PAGE, SERVICES_PAGE, `${SERVICES_PAGE}/new`]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("form")).toHaveCount(0);
    }
    // The API agrees: the same session is refused the admin endpoints.
    expect((await page.request.get("/api/v1/admin/settings")).status()).toBe(403);
    expect((await page.request.get("/api/v1/admin/services")).status()).toBe(403);
  });

  test("a visitor without a session is sent to sign in", async ({ page }) => {
    await page.goto(SETTINGS_PAGE);

    await expect(page).toHaveURL(/\/login\?returnTo=/, { timeout: NAVIGATION_TIMEOUT });
    expect((await page.request.get("/api/v1/admin/settings")).status()).toBe(401);
    // The public endpoints need no session.
    expect((await page.request.get("/api/v1/settings/public")).status()).toBe(200);
    expect((await page.request.get("/api/v1/services")).status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("accessibility", () => {
  test("the business settings page has no serious or critical violations", async ({ page }) => {
    await openAs(page, SETTINGS_PAGE, "Business settings");
    await expectHydrated(page.getByRole("form", { name: "Business settings" }));
    await expectAccessible(page);
  });

  test("the business settings page with errors, with the other logo choices, and with the leave dialog", async ({
    page,
  }) => {
    await openAs(page, SETTINGS_PAGE, "Business settings");
    await expectHydrated(page.getByRole("form", { name: "Business settings" }));

    await page.getByLabel(/^Default tax rate/).fill("101");
    await page.getByRole("radio", { name: /A web address/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "problems to fix" })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("link", { name: "Services", exact: true }).first().click();
    const dialog = page.getByRole("alertdialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expectAccessible(page);
  });

  test("the service list, in all its states, has no serious or critical violations", async ({
    page,
  }) => {
    await openAs(page, SERVICES_PAGE, "Services");
    await expect(page.getByRole("table", { name: "Services" })).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${SERVICES_PAGE}?search=no-such-service-anywhere`);
    await expect(page.getByRole("heading", { name: "No services match" })).toBeVisible();
    await expectAccessible(page);
  });

  test("the new-service form, filled in and with errors, has no serious or critical violations", async ({
    page,
  }) => {
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await expectAccessible(page);

    await page.getByRole("radio", { name: /Fixed starting price/ }).click();
    await page.getByRole("radio", { name: "One of the illustrations" }).click();
    await page.getByRole("button", { name: "Add inclusion" }).click();
    await page.getByLabel(/^Service name/).fill("AC");
    await page.getByRole("button", { name: "Create service" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "problems to fix" })).toBeVisible();
    await expectAccessible(page);
  });

  test("the edit page and its archive dialog have no serious or critical violations", async ({
    page,
  }) => {
    const name = uniqueName("Axe");
    createdPrefixes.push(name);
    await openAs(page, SERVICES_PAGE, "Services");
    await newServiceForm(page);
    await fillFixedService(page, name);
    await page.getByRole("button", { name: "Create service" }).click();
    await page.waitForURL(/\/app\/settings\/services\/[0-9a-f-]{36}$/, {
      timeout: NAVIGATION_TIMEOUT,
    });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectHydrated(page.getByRole("form", { name: "Edit service" }));
    await expectAccessible(page);

    await page.getByRole("button", { name: "Archive service" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expectAccessible(page);
  });
});
