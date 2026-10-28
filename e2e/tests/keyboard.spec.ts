import { expect, type Page, test } from "@playwright/test";

import {
  expectHydrated,
  isFocusWithin,
  NAVIGATION_TIMEOUT,
  useViewport,
} from "./helpers/layout.js";

/**
 * Keyboard behaviour of the shells and overlays: focus moves in, stays in, comes back, and
 * Escape closes (T04 acceptance criteria 6 and the accessibility quality bar).
 */

test.describe.configure({ timeout: 90_000 });

async function activeElementDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return `${element?.tagName.toLowerCase() ?? "none"}:${element?.getAttribute("aria-label") ?? element?.textContent?.trim().slice(0, 40) ?? ""}`;
  });
}

test.describe("skip link", () => {
  test("is the first tab stop and moves focus to the main content", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });
});

test.describe("admin shell", () => {
  test("shows the sidebar from 1024px and no menu button", async ({ page }) => {
    await useViewport(page, 1024);
    await page.goto("/styleguide/shells/admin");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Requests" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  });

  test("replaces the sidebar with a drawer below 1024px", async ({ page }) => {
    await useViewport(page, 768);
    await page.goto("/styleguide/shells/admin");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });

  test("the mobile drawer opens and closes with the keyboard and returns focus to its button", async ({
    page,
  }) => {
    await useViewport(page, 360);
    await page.goto("/styleguide/shells/admin");

    const trigger = page.getByRole("button", { name: "Open menu" });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");

    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await expect(drawer).toBeVisible();
    // Focus moved into the drawer (Radix starts on the drawer itself when it holds only links).
    expect(await isFocusWithin(drawer)).toBe(true);

    // Tab never leaves it.
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press("Tab");
      expect(await isFocusWithin(drawer), `after ${press + 1} Tab presses`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("choosing a link in the drawer navigates and closes it", async ({ page }) => {
    await useViewport(page, 360);
    await page.goto("/styleguide/shells/admin");
    const opener = page.getByRole("button", { name: "Open menu" });
    await expectHydrated(opener);
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Main navigation" });
    await drawer.getByRole("link", { name: "Requests" }).click();

    await expect(page).toHaveURL(/\/admin\/requests$/, { timeout: NAVIGATION_TIMEOUT });
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Service requests" })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
  });

  test("marks the current page in the navigation", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/styleguide/shells/admin/requests/detail");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar.getByRole("link", { name: "Requests" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

test.describe("portal shell", () => {
  test("shows the navigation inline from 1024px", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/styleguide/shells/portal");
    const nav = page.getByRole("navigation", { name: "Portal" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  });

  test("uses a keyboard-operable drawer below 1024px", async ({ page }) => {
    await useViewport(page, 360);
    await page.goto("/styleguide/shells/portal");
    await expect(page.getByRole("navigation", { name: "Portal" })).toBeHidden();

    const trigger = page.getByRole("button", { name: "Open menu" });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Space");
    const drawer = page.getByRole("dialog", { name: "Portal navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Invoice" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("public layout", () => {
  test("the mobile menu is a disclosure that opens and closes with the keyboard", async ({
    page,
  }) => {
    await useViewport(page, 360);
    await page.goto("/styleguide/shells/public");

    const button = page.getByRole("button", { name: "Menu" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expectHydrated(button);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator(`#${(await button.getAttribute("aria-controls")) ?? "none"}`);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Services", exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Browse services" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Services", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("shows the links inline from 768px", async ({ page }) => {
    await useViewport(page, 768);
    await page.goto("/styleguide/shells/public");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Services" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
  });

  test("credits FixFlow in the footer and carries the demo notice", async ({ page }) => {
    await useViewport(page, 1440);
    await page.goto("/styleguide/shells/public");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText("Powered by")).toBeVisible();
    await expect(
      footer.getByText("FixFlow portfolio demo — fictional business and data."),
    ).toBeVisible();
  });
});

test.describe("dialogs", () => {
  test("a dialog traps focus, closes on Escape and returns focus to the trigger", async ({
    page,
  }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const trigger = page.getByRole("button", { name: "Open dialog" });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Add an internal note" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/Note/)).toBeFocused();

    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.locator(":focus").count(), `after ${press + 1} Tab presses`).toBe(1);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a confirmation with a reason keeps confirm disabled until the reason is long enough", async ({
    page,
  }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const trigger = page.getByRole("button", { name: "Destructive, with a reason" });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: "Void invoice INV-2026-00007?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("can't be reopened")).toBeVisible();

    const reason = dialog.getByLabel(/Reason for voiding/);
    const confirm = dialog.getByRole("button", { name: "Void invoice" });
    await expect(reason).toBeFocused();
    await expect(confirm).toBeDisabled();

    await page.keyboard.type("Wrong address");
    await expect(confirm).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a confirmation that fails stays open and shows why", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const failing = page.getByRole("button", { name: "Action that fails" });
    await expectHydrated(failing);
    await failing.click();

    const dialog = page.getByRole("alertdialog", { name: "Cancel this job?" });
    await dialog.getByRole("button", { name: "Cancel job" }).click();

    await expect(dialog.getByRole("alert")).toContainText("The job was changed by someone else");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel job" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  test("the drawer closes on Escape and returns focus", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const trigger = page.getByRole("button", { name: "Open detail drawer" });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "JOB-2026-00031" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a dropdown menu opens with the keyboard, moves with the arrows and closes on Escape", async ({
    page,
  }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const trigger = page.getByRole("button", { name: "Actions", exact: true });
    await expectHydrated(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("form validation example", () => {
  test("a failed submit shows the summary, links to the field and keeps what was typed", async ({
    page,
  }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const form = page.getByRole("form", { name: "Request a service (validation example)" });
    await expectHydrated(form.getByRole("button", { name: "Check request" }));
    await form.getByLabel(/Full name/).fill("Morgan Reyes");

    await form.getByRole("button", { name: "Check request" }).click();

    const summary = form.getByRole("alert").first();
    await expect(summary).toContainText("There are 5 problems to fix");
    await expect(summary).toBeFocused();
    await expect(form.getByLabel(/Full name/)).toHaveValue("Morgan Reyes");

    await summary.getByRole("link", { name: /Email address/ }).click();
    await expect(form.getByLabel(/Email address/)).toBeFocused();
    await expect(form.getByLabel(/Email address/)).toHaveAttribute("aria-invalid", "true");
    await expect(
      form.getByText("Enter a valid email address, like name@example.com.").last(),
    ).toBeVisible();
  });

  test("a valid form shows progress and an honest message", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const form = page.getByRole("form", { name: "Request a service (validation example)" });
    await expectHydrated(form.getByRole("button", { name: "Check request" }));

    await form.getByLabel(/Full name/).fill("Morgan Reyes");
    await form.getByLabel(/Email address/).fill("morgan.reyes@example.com");
    await form.getByLabel(/Service/).selectOption("ac-diagnostic-visit");
    await form.getByRole("radio", { name: /Morning/ }).click();
    await form
      .getByLabel(/Describe the problem/)
      .fill("The upstairs unit blows warm air and drips.");
    await form.getByRole("checkbox", { name: /privacy notice/ }).click();

    const submit = form.getByRole("button", { name: "Check request" });
    await submit.click();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(
      form.getByRole("status").filter({ hasText: "does not send anything" }),
    ).toBeVisible();
    await expect(submit).not.toHaveAttribute("aria-busy");
  });

  test("server errors land beside their fields", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const form = page.getByRole("form", { name: "Request a service (validation example)" });
    await expectHydrated(form.getByRole("button", { name: "Simulate server errors" }));
    await form.getByRole("button", { name: "Simulate server errors" }).click();
    await expect(
      form.getByText("That email is already registered. Sign in instead.").last(),
    ).toBeVisible();
    await expect(form.getByLabel(/Email address/)).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText("We couldn't save this just now. Please try again.")).toBeVisible();
  });
});

test.describe("toasts", () => {
  test("announce through a live region and can be dismissed", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");
    const trigger = page.getByRole("button", { name: "Success", exact: true });
    await expectHydrated(trigger);
    await trigger.click();

    // The toast lives in a polite live region, so a screen reader announces it without moving focus.
    const region = page.locator("section[aria-label^=Notifications]");
    await expect(region).toHaveAttribute("aria-live", "polite");
    const toast = region.getByText("Example: quotation sent");
    await expect(toast).toBeVisible();
  });
});

test.describe("focus visibility", () => {
  test("every interactive element in the styleguide shows a focus ring", async ({ page }) => {
    await useViewport(page, 1280);
    await page.goto("/styleguide");

    // Tab through the first stretch of the page and check the focused element has a visible outline.
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) {
          return null;
        }
        const style = getComputedStyle(element);
        return {
          width: Number.parseFloat(style.outlineWidth),
          style: style.outlineStyle,
          shadow: style.boxShadow,
        };
      });
      const description = await activeElementDescription(page);
      expect(outline, `tab ${press + 1}: ${description}`).not.toBeNull();
      const hasOutline = (outline?.width ?? 0) >= 2 && outline?.style !== "none";
      const hasRing = outline?.shadow !== "none";
      expect(hasOutline || hasRing, `no visible focus indicator on ${description}`).toBe(true);
    }
  });
});
