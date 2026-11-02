import type { AssignableTechnicianDto } from "@fixflow/shared";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { createCustomerAccount } from "../fixtures/accounts.js";
import {
  assignJob,
  deleteTechniciansTagged,
  eventsAbout,
  inDays,
  insertTechnician,
  jobsOf,
  newTechnicianTag,
  technicianNamed,
} from "../fixtures/technicians.js";
import { loginAs } from "../support/auth.js";
import { WEB_URL } from "../support/env.js";
import { expectHydrated, NAVIGATION_TIMEOUT } from "./helpers/layout.js";

/**
 * Technician resources (T16, FR-060 to FR-062, IA-A10). The admin adds a technician, edits their
 * specialties, deactivates them (and is warned about their jobs) and reactivates them; the list
 * filters and searches; and the pages are closed to customers and visitors. Every technician here
 * carries a tag of its own in its name, so these tests find their own people on a database that the
 * other specs share, and clean up only those. The seeded technicians are only read.
 */

test.describe.configure({ timeout: 120_000 });

const tags: string[] = [];
function freshTag(): string {
  const tag = newTechnicianTag();
  tags.push(tag);
  return tag;
}

test.afterEach(async () => {
  for (const tag of tags.splice(0)) {
    await deleteTechniciansTagged(tag);
  }
});

const TECHNICIAN_PAGE = /\/app\/technicians\/[0-9a-f-]{36}$/;
const UNKNOWN_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const addButton = (page: Page): Locator => page.getByRole("button", { name: "Add technician" });
const sheet = (page: Page, name: string): Locator => page.getByRole("dialog", { name });
const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

async function openList(page: Page, query = ""): Promise<void> {
  await page.goto(`/app/technicians${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(addButton(page));
}

async function openTechnician(page: Page, id: string): Promise<void> {
  await page.goto(`/app/technicians/${id}`);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
    timeout: NAVIGATION_TIMEOUT,
  });
  await expectHydrated(page.getByRole("button", { name: "Edit", exact: true }));
}

/** The state badge beside a technician's name in the page heading. */
const statusBadge = (page: Page, name: string): Locator =>
  page.getByRole("heading", { level: 1, name }).locator("xpath=..").locator("[data-status]");

async function assignable(page: Page): Promise<string[]> {
  const response = await page.request.get("/api/v1/admin/technicians/assignable");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: AssignableTechnicianDto[] }).data.map(
    (technician) => technician.name,
  );
}

/** Types in the search box and presses Search, then waits for the address to carry the search. */
async function searchFor(page: Page, text: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Search" }).fill(text);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("q") === text, {
    timeout: NAVIGATION_TIMEOUT,
  });
}

// ---------------------------------------------------------------------------------------------

test.describe("adding, editing, deactivating and reactivating", () => {
  test("an admin adds a technician, edits their specialties, deactivates them and sees the warning, then reactivates them", async ({
    page,
  }) => {
    const tag = freshTag();
    const name = `Casey Brooks ${tag}`;
    const customer = await createCustomerAccount({ name: `Pat Customer ${tag}` });
    await loginAs(page, "admin");

    await test.step("opens Technicians from the business navigation", async () => {
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Technicians" })).toHaveAttribute(
        "href",
        "/app/technicians",
      );
      await nav.getByRole("link", { name: "Technicians" }).click();
      await page.waitForURL(/\/app\/technicians$/, { timeout: NAVIGATION_TIMEOUT });
      await expect(nav.getByRole("link", { name: "Technicians" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
      // The seeded team is there, active, with its status in words.
      const table = page.getByRole("table", { name: "Technicians" });
      await expect(table.getByRole("row").filter({ hasText: "Jordan Lee" })).toContainText(
        "Active",
      );
      await expectHydrated(addButton(page));
    });

    await test.step("adds a technician from the sheet, with validation first", async () => {
      await addButton(page).click();
      const dialog = sheet(page, "Add technician");
      await expect(dialog).toBeVisible();
      // Focus moves into the sheet.
      await expect(dialog.getByLabel(/^Name/)).toBeFocused();

      // Nothing entered: the name is asked for beside its field, and nothing is sent.
      await dialog.getByRole("button", { name: "Add technician" }).click();
      await expect(dialog.getByText("Enter the name.", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel(/^Name/)).toHaveAttribute("aria-invalid", "true");
      await expect(dialog).toBeVisible();

      await dialog.getByLabel(/^Name/).fill(name);
      await dialog.getByLabel("Phone number").fill("12345");
      await dialog.getByLabel("Phone number").blur();
      // Beside the field (the same message is in the summary above the form, as a link to it).
      await expect(dialog.locator("#technician-field-phone-error")).toContainText(
        "Enter a phone number with 7 to 15 digits",
      );
      await dialog.getByLabel("Phone number").fill("(212) 555-0187");
      await dialog.getByLabel("Email address").fill(`casey.${tag}@coolbreeze.test`);

      const specialty = dialog.getByLabel("Add a specialty");
      await specialty.fill("Heat pumps");
      await specialty.press("Enter");
      await specialty.fill("Diagnostics");
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await expect(dialog.getByText("2 of 8")).toBeVisible();
      await dialog.getByRole("radio", { name: "Teal" }).check();
      await dialog.getByLabel("Notes").fill("Added by the end-to-end test.");

      await dialog.getByRole("button", { name: "Add technician" }).click();

      await page.waitForURL(TECHNICIAN_PAGE, { timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(toast(page, `“${name}” was added`)).toBeVisible();
    });

    const created = await technicianNamed(name);
    expect(created).toMatchObject({
      isActive: true,
      calendarColor: "teal",
      phone: "(212) 555-0187",
      specialties: ["Heat pumps", "Diagnostics"],
      notes: "Added by the end-to-end test.",
    });
    const id = created?.id ?? "";

    await test.step("shows the new technician's page: active, nothing coming up", async () => {
      // After a client-side navigation Next keeps the list mounted but hidden, so its text would
      // match too: read the page fresh, and find the state through the heading it sits beside.
      await openTechnician(page, id);
      await expect(statusBadge(page, name)).toHaveAttribute("data-status", "ACTIVE");
      await expect(statusBadge(page, name)).toHaveText("Active");
      await expect(page.getByText("Heat pumps")).toBeVisible();
      await expect(page.getByText("Teal")).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "No upcoming jobs" })).toBeVisible();
      await expect(page.getByRole("link", { name: "(212) 555-0187" })).toHaveAttribute(
        "href",
        "tel:2125550187",
      );
      await expect(page.getByText("Free", { exact: true })).toHaveCount(7);
    });

    await test.step("edits their specialties and saves only that", async () => {
      await expectHydrated(page.getByRole("button", { name: "Edit", exact: true }));
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const dialog = sheet(page, `Edit ${name}`);
      await expect(dialog).toBeVisible();

      // Nothing changed yet, so there is nothing to save.
      const save = dialog.getByRole("button", { name: "Save changes" });
      await expect(save).toBeDisabled();

      await dialog.getByRole("button", { name: "Remove Heat pumps" }).click();
      await dialog.getByLabel("Add a specialty").fill("Dryers");
      await dialog.getByLabel("Add a specialty").press("Enter");
      await expect(save).toBeEnabled();
      await save.click();

      await expect(dialog).toBeHidden();
      await expect(toast(page, "Changes saved")).toBeVisible();
      // The page now shows the new list, and the old tag is gone.
      await expect(page.getByText("Dryers")).toBeVisible();
      await expect(page.getByText("Diagnostics")).toBeVisible();
      await expect(page.getByText("Heat pumps")).toHaveCount(0);
    });
    expect((await technicianNamed(name))?.specialties).toEqual(["Diagnostics", "Dryers"]);
    expect((await technicianNamed(name))?.phone).toBe("(212) 555-0187");
    expect((await eventsAbout(id)).map((event) => event.action)).toEqual([
      "technician.created",
      "technician.updated",
    ]);

    await test.step("with two jobs coming up, shows them and the hours booked", async () => {
      await assignJob(id, customer.id, inDays(1));
      await assignJob(id, customer.id, inDays(3));
      await page.reload();
      await expectHydrated(page.getByRole("button", { name: "Edit", exact: true }));

      const jobs = page.getByRole("table", { name: `Upcoming jobs for ${name}` });
      await expect(jobs.getByRole("row")).toHaveCount(3);
      await expect(jobs.getByText(`Pat Customer ${tag}`)).toHaveCount(2);
      await expect(jobs.getByText("Scheduled", { exact: true })).toHaveCount(2);
      // Two of the seven days carry two hours; the other five are free.
      await expect(page.getByText("2 h", { exact: true })).toHaveCount(2);
      await expect(page.getByText("Free", { exact: true })).toHaveCount(5);
    });

    const jobsBefore = await jobsOf(id);
    expect(jobsBefore).toHaveLength(2);

    await test.step("deactivates them after reading what happens to their jobs", async () => {
      await page.getByRole("button", { name: "Deactivate" }).click();
      const dialog = page.getByRole("alertdialog", { name: `Deactivate ${name}?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(
        `${name} has 2 upcoming jobs. They stay assigned; you can reassign them from each job. Casey won't be available for new assignments.`,
      );
      // Nothing has happened yet.
      expect((await technicianNamed(name))?.isActive).toBe(true);

      await dialog.getByRole("button", { name: "Deactivate" }).click();

      await expect(dialog).toBeHidden();
      await expect(toast(page, `“${name}” is now inactive`)).toContainText(
        "2 upcoming jobs stay assigned.",
      );
      await expect(statusBadge(page, name)).toHaveAttribute("data-status", "INACTIVE");
      await expect(statusBadge(page, name)).toHaveText("Inactive");
      await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
      await expect(
        page.getByText(/is inactive, so they are not offered for new jobs/),
      ).toBeVisible();
      await expect(
        page.getByText("2 upcoming jobs stay assigned until you reassign them."),
      ).toBeVisible();
      // The jobs are still listed.
      await expect(
        page.getByRole("table", { name: `Upcoming jobs for ${name}` }).getByRole("row"),
      ).toHaveCount(3);
    });

    await test.step("left the jobs exactly as they were, and is no longer offered for new ones", async () => {
      expect(await jobsOf(id)).toEqual(jobsBefore);
      expect((await technicianNamed(name))?.isActive).toBe(false);
      expect(await assignable(page)).not.toContain(name);
      const events = await eventsAbout(id);
      expect(events.at(-1)).toMatchObject({
        action: "technician.deactivated",
        publicSummary: null,
      });
      expect(events.at(-1)?.summary).toContain("(2 upcoming jobs stay assigned)");
    });

    await test.step("shows them on the Inactive tab and not on the Active one", async () => {
      await openList(page, `?q=${tag}`);
      await expect(
        page.getByRole("heading", { level: 2, name: "No technicians match" }),
      ).toBeVisible();
      await page.getByRole("link", { name: /^Inactive/ }).click();
      await page.waitForURL((url) => url.searchParams.get("active") === "false", {
        timeout: NAVIGATION_TIMEOUT,
      });
      const row = page
        .getByRole("table", { name: "Technicians" })
        .getByRole("row")
        .filter({ hasText: name });
      await expect(row).toContainText("Inactive");
      await expect(row).toContainText("2");
    });

    await test.step("reactivates them", async () => {
      await openTechnician(page, id);
      await page.getByRole("button", { name: "Reactivate" }).click();
      await expect(toast(page, `“${name}” is active again`)).toBeVisible();
      await expect(statusBadge(page, name)).toHaveAttribute("data-status", "ACTIVE");
      await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0);

      expect((await technicianNamed(name))?.isActive).toBe(true);
      expect(await assignable(page)).toContain(name);
      expect((await eventsAbout(id)).map((event) => event.action)).toEqual([
        "technician.created",
        "technician.updated",
        "technician.deactivated",
        "technician.activated",
      ]);
      expect(await jobsOf(id)).toEqual(jobsBefore);
    });
  });

  test("deactivating a technician with nothing coming up says so", async ({ page }) => {
    const tag = freshTag();
    const technician = await insertTechnician(tag);
    await loginAs(page, "admin");
    await openTechnician(page, technician.id);

    await page.getByRole("button", { name: "Deactivate" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Deactivate ${technician.name}?` });
    await expect(dialog).toContainText(
      `${technician.name} has no upcoming jobs. Casey won't be available for new assignments.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await technicianNamed(technician.name))?.isActive).toBe(true);
    // Focus is back on the button that opened the dialog.
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeFocused();
  });

  test("deactivating twice at once from two tabs leaves one record of it", async ({ page }) => {
    const tag = freshTag();
    const technician = await insertTechnician(tag);
    await loginAs(page, "admin");
    await openTechnician(page, technician.id);
    // A second view of the same page, opened before either action.
    const other = await page.context().newPage();
    await openTechnician(other, technician.id);

    const deactivate = (from: Page) =>
      from.request.post(`/api/v1/admin/technicians/${technician.id}/deactivate`, {
        headers: { Origin: WEB_URL },
      });
    const [first, second] = await Promise.all([deactivate(page), deactivate(other)]);

    expect([first.status(), second.status()]).toEqual([200, 200]);
    const events = await eventsAbout(technician.id);
    expect(events.filter((event) => event.action === "technician.deactivated")).toHaveLength(1);
    // The other tab, still showing "Deactivate", gets the truth when it acts: nothing breaks.
    await other.getByRole("button", { name: "Deactivate" }).click();
    await other.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(other.getByRole("button", { name: "Reactivate" })).toBeVisible();
    expect(
      (await eventsAbout(technician.id)).filter(
        (event) => event.action === "technician.deactivated",
      ),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("the list", () => {
  test("filters by tab, searches, and keeps both in the address", async ({ page }) => {
    const tag = freshTag();
    const active = await insertTechnician(tag, {
      name: `Riley Active ${tag}`,
      specialties: [`Gutter-${tag}`],
      phone: "(646) 555-0148",
    });
    const inactive = await insertTechnician(tag, {
      name: `Riley Inactive ${tag}`,
      isActive: false,
      calendarColor: "orange",
    });
    await loginAs(page, "admin");
    await openList(page);

    const table = page.getByRole("table", { name: "Technicians" });
    const rows = (text: string) => table.getByRole("row").filter({ hasText: text });

    await test.step("starts on the active tab, where the seeded team is", async () => {
      await expect(page.getByRole("link", { name: /^Active/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(rows("Jordan Lee")).toContainText("Active");
    });

    await test.step("finds a technician by a specialty, ignoring case", async () => {
      // The specialty is stored as "Gutter-…"; the search is typed in lower case.
      await searchFor(page, `gutter-${tag}`);
      await expect(rows(active.name)).toHaveCount(1);
      await expect(rows(active.name)).toContainText(`Gutter-${tag}`);
      await expect(rows(inactive.name)).toHaveCount(0);
    });

    await test.step("finds a technician by the digits of a phone number", async () => {
      await searchFor(page, "646-555-0148");
      await expect(rows(active.name)).toHaveCount(1);
    });

    await test.step("moves between tabs keeping the search", async () => {
      await searchFor(page, tag);
      await expect(rows(active.name)).toHaveCount(1);
      await expect(rows(inactive.name)).toHaveCount(0);

      await page.getByRole("link", { name: /^Inactive/ }).click();
      await page.waitForURL((url) => url.searchParams.get("active") === "false", {
        timeout: NAVIGATION_TIMEOUT,
      });
      expect(new URL(page.url()).searchParams.get("q")).toBe(tag);
      await expect(rows(inactive.name)).toHaveCount(1);
      await expect(rows(inactive.name)).toContainText("Inactive");
      await expect(rows(active.name)).toHaveCount(0);

      await page.getByRole("link", { name: /^All/ }).click();
      await page.waitForURL((url) => url.searchParams.get("active") === "all", {
        timeout: NAVIGATION_TIMEOUT,
      });
      await expect(rows(active.name)).toHaveCount(1);
      await expect(rows(inactive.name)).toHaveCount(1);
    });

    await test.step("sorts Z to A from the column header", async () => {
      await page.getByRole("link", { name: "Technician", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("order") === "desc", {
        timeout: NAVIGATION_TIMEOUT,
      });
      const names = await table.getByRole("link").allTextContents();
      expect(names.filter((n) => n.includes(tag))).toEqual([
        `Riley Inactive ${tag}`,
        `Riley Active ${tag}`,
      ]);
    });

    await test.step("opens a technician from the name", async () => {
      await table.getByRole("link", { name: active.name }).click();
      await page.waitForURL(TECHNICIAN_PAGE, { timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("heading", { level: 1, name: active.name })).toBeVisible();
    });
  });

  test("says when nobody matches, and clears the search keeping the tab", async ({ page }) => {
    await loginAs(page, "admin");
    await openList(page, "?active=all");
    await searchFor(page, "zzz-nobody-has-this");

    await expect(
      page.getByRole("heading", { level: 2, name: "No technicians match" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Clear search" }).first().click();
    await page.waitForURL((url) => !url.searchParams.has("q"), { timeout: NAVIGATION_TIMEOUT });
    expect(new URL(page.url()).searchParams.get("active")).toBe("all");
    await expect(page.getByRole("table", { name: "Technicians" })).toBeVisible();
  });

  test("takes a % in the search as a plain character", async ({ page }) => {
    await loginAs(page, "admin");
    await openList(page, "?active=all");
    await searchFor(page, "%");
    await expect(
      page.getByRole("heading", { level: 2, name: "No technicians match" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("when something goes wrong", () => {
  test("a technician that does not exist, or an address that is not an id, says so", async ({
    page,
  }) => {
    await loginAs(page, "admin");

    for (const id of [UNKNOWN_ID, "not-an-id"]) {
      await page.goto(`/app/technicians/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "We couldn't find that technician" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await page.getByRole("link", { name: "Back to the technicians" }).click();
      await page.waitForURL(/\/app\/technicians$/, { timeout: NAVIGATION_TIMEOUT });
    }
  });

  test("a failed save keeps the sheet open with what was typed, and a refused field is shown beside it", async ({
    page,
  }) => {
    const tag = freshTag();
    await loginAs(page, "admin");
    await openList(page);
    await addButton(page).click();
    const dialog = sheet(page, "Add technician");
    await dialog.getByLabel(/^Name/).fill(`Casey Brooks ${tag}`);
    await dialog.getByLabel("Phone number").fill("(212) 555-0187");

    // The server is unreachable for the first try, and then refuses the email.
    let attempt = 0;
    await page.route("**/api/v1/admin/technicians", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      attempt += 1;
      if (attempt === 1) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId: "r-1" },
          }),
        });
      }
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the highlighted fields.",
            fieldErrors: { email: "Enter a valid email address, like name@example.com." },
            requestId: "r-2",
          },
        }),
      });
    });

    await dialog.getByRole("button", { name: "Add technician" }).click();
    await expect(
      dialog.getByRole("alert").filter({ hasText: "Something went wrong." }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Name/)).toHaveValue(`Casey Brooks ${tag}`);
    await expect(dialog.getByLabel("Phone number")).toHaveValue("(212) 555-0187");
    // No success is claimed and nothing was made.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    expect(await technicianNamed(`Casey Brooks ${tag}`)).toBeNull();

    await dialog.getByRole("button", { name: "Add technician" }).click();
    await expect(
      dialog.getByText("Enter a valid email address, like name@example.com.", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Phone number")).toHaveValue("(212) 555-0187");
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("keyboard", () => {
  test("opens the sheet from the keyboard, closes it with Escape and gives focus back", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await openList(page);

    await addButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = sheet(page, "Add technician");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Name/)).toBeFocused();

    // Tab stays inside the sheet.
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(addButton(page)).toBeFocused();
  });

  test("adds a specialty with Enter without sending the form, and removes it from the keyboard", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await openList(page);
    await addButton(page).click();
    const dialog = sheet(page, "Add technician");

    await dialog.getByLabel(/^Name/).fill("Casey Keyboard");
    const specialty = dialog.getByLabel("Add a specialty");
    await specialty.fill("Heat pumps");
    await specialty.press("Enter");
    // Still on the list with the sheet open: Enter added the tag and did not save.
    await expect(dialog).toBeVisible();
    expect(page.url()).toMatch(/\/app\/technicians$/);
    await expect(dialog.getByText("1 of 8")).toBeVisible();

    await dialog.getByRole("button", { name: "Remove Heat pumps" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("0 of 8")).toBeVisible();
    // Focus went back to the box rather than being lost.
    await expect(specialty).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------

test.describe("who may use the technician pages", () => {
  test("sends a visitor to sign in, and turns a customer away from the pages and the API", async ({
    page,
  }) => {
    const tag = freshTag();
    const technician = await insertTechnician(tag);
    const account = await createCustomerAccount({ name: `Reese Fixture ${tag}` });

    await page.goto("/app/technicians");
    await page.waitForURL(/\/login\?returnTo=%2Fapp%2Ftechnicians/, {
      timeout: NAVIGATION_TIMEOUT,
    });

    await loginAs(page, account);
    for (const path of ["/app/technicians", `/app/technicians/${technician.id}`]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "This area is for the business team" }),
      ).toBeVisible({ timeout: NAVIGATION_TIMEOUT });
      await expect(page.getByRole("table", { name: "Technicians" })).toHaveCount(0);
      expect(await page.content(), path).not.toContain(technician.name);
    }
    for (const path of [
      "/api/v1/admin/technicians",
      "/api/v1/admin/technicians/assignable",
      `/api/v1/admin/technicians/${technician.id}`,
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
    // Nor can they change one.
    expect(
      (
        await page.request.post(`/api/v1/admin/technicians/${technician.id}/deactivate`, {
          headers: { Origin: WEB_URL },
        })
      ).status(),
    ).toBe(403);
    expect((await technicianNamed(technician.name))?.isActive).toBe(true);
  });

  test("has a Technicians entry in the business navigation, and none in the customer's", async ({
    page,
  }) => {
    const account = await createCustomerAccount({ name: "Sasha Fixture" });
    await loginAs(page, account);
    await expect(page.getByRole("link", { name: "Technicians" })).toHaveCount(0);
  });
});
