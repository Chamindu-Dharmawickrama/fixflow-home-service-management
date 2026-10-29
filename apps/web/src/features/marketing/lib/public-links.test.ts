import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NAVIGATION } from "@/config/navigation";
import { validateNavigation } from "@/lib/navigation";

const APP_DIR = resolve(import.meta.dirname, "../../../app");

/** `/services/[slug]` for a link to `/services/ac-routine-maintenance`: the page file that serves a path. */
function pageFileFor(pathname: string): string | undefined {
  const candidates = [
    pathname === "/" ? "page.tsx" : `${pathname.slice(1)}/page.tsx`,
    pathname.startsWith("/services/") ? "services/[slug]/page.tsx" : "",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(resolve(APP_DIR, candidate)));
}

describe("the public navigation (no dead links, CLAUDE.md §10)", () => {
  it("passes the navigation checks", () => {
    expect(validateNavigation("public", NAVIGATION.public)).toEqual([]);
  });

  it("lists Home, Services, and the How it works and Contact anchors", () => {
    expect(NAVIGATION.public.map((item) => [item.label, item.href])).toEqual([
      ["Home", "/"],
      ["Services", "/services"],
      ["How it works", "/#how-it-works"],
      ["Contact", "/#contact"],
    ]);
  });

  it("points every entry at a page that exists", () => {
    for (const item of NAVIGATION.public) {
      const pathname = item.href.split("#")[0] ?? "";
      expect(pageFileFor(pathname === "" ? "/" : pathname), item.href).toBeDefined();
    }
  });

  it("keeps the other links of the public site pointing at real pages", () => {
    for (const href of [
      "/",
      "/services",
      "/services/any-slug",
      "/privacy",
      "/login",
      "/register",
    ]) {
      expect(pageFileFor(href), href).toBeDefined();
    }
  });

  it("serves the sitemap and robots.txt", () => {
    expect(existsSync(resolve(APP_DIR, "sitemap.ts"))).toBe(true);
    expect(existsSync(resolve(APP_DIR, "robots.ts"))).toBe(true);
  });
});
