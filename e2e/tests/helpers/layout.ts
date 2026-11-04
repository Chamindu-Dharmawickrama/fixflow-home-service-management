import { expect, type Locator, type Page } from "@playwright/test";

/** The four widths every screen must work at (spec §17.4). */
export const WIDTHS = [360, 768, 1024, 1440] as const;
export type Width = (typeof WIDTHS)[number];

/**
 * How long to wait for a link click to land on a new page. On a freshly started development server
 * the first visit to a route also waits for Next.js to compile it, which is slower than production.
 */
export const NAVIGATION_TIMEOUT = 30_000;

/** Heights are generous so full-page screenshots are not dominated by a short first screen. */
const HEIGHT = 900;

export async function useViewport(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: HEIGHT });
}

/**
 * Asserts the page does not scroll sideways. On failure the message names the elements that stick
 * out past the right edge, which is where the fix usually is.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders: string[] = [];
    if (scrollWidth > viewport) {
      for (const element of document.body.querySelectorAll("*")) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.right > viewport + 1) {
          const label = `${element.tagName.toLowerCase()}${
            element.id ? `#${element.id}` : ""
          }.${String(element.getAttribute("class") ?? "")
            .split(/\s+/)
            .slice(0, 3)
            .join(".")}`;
          offenders.push(`${label} (right edge ${Math.round(box.right)}px)`);
          if (offenders.length >= 8) {
            break;
          }
        }
      }
    }
    return { viewport, scrollWidth, offenders };
  });

  expect(
    result.scrollWidth,
    `Page scrolls sideways at ${result.viewport}px (scrollWidth ${result.scrollWidth}). Offenders: ${result.offenders.join("; ")}`,
  ).toBeLessThanOrEqual(result.viewport);
}

/**
 * Waits until React has attached to the element. A click, keypress or typed value before this
 * point is lost (or becomes a native form submit), which would make a test flaky for a reason the
 * product does not have: real people cannot interact faster than the page loads.
 */
export async function expectHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator
        .first()
        .evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$"))),
    )
    .toBe(true);
}

/** True when focus is on the container or on anything inside it. */
export async function isFocusWithin(container: Locator): Promise<boolean> {
  return container.evaluate((element) => element.contains(document.activeElement));
}

/**
 * The box of a dialog, sheet or menu lies inside the viewport, with nothing cut off at either side.
 * It waits for the animations that end first (a sheet slides in, a dialog fades in): measured
 * mid-way, its box is not where it will rest.
 */
export async function expectInsideScreen(
  page: Page,
  dialog: Locator,
  label: string,
): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} has a box`).not.toBeNull();
  expect(box?.x ?? -1, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0), `${label} ends inside the screen`).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 0.5,
  );
}
