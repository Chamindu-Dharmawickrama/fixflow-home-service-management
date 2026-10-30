import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { BUNDLED_SERVICE_IMAGES } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { HOME_HERO_PHOTO, SERVICE_PHOTOS } from "./bundled-assets";

const PUBLIC_DIR = resolve(import.meta.dirname, "../../../../public");
const CREDITS = readFileSync(resolve(PUBLIC_DIR, "images/CREDITS.md"), "utf8");

/** Every photograph the website can show: one per bundled service picture, and the homepage's. */
const PHOTOS = [...Object.entries(SERVICE_PHOTOS), ["home hero", HOME_HERO_PHOTO] as const];

describe("the photographs shipped with the app (D-90)", () => {
  it("has a photograph for every picture an admin can choose", () => {
    expect(Object.keys(SERVICE_PHOTOS).sort()).toEqual(
      BUNDLED_SERVICE_IMAGES.map(({ key }) => key).sort(),
    );
  });

  it.each(PHOTOS)(
    "%s: the file exists, is a JPEG and is small enough for a card",
    (_name, photo) => {
      const file = resolve(PUBLIC_DIR, photo.src.slice(1));
      expect(existsSync(file), file).toBe(true);
      const bytes = readFileSync(file);
      // The first bytes of a JPEG: not a renamed page or script.
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(statSync(file).size).toBeLessThan(250 * 1024);
    },
  );

  it.each(PHOTOS)("%s: is served from this app, not from another site", (_name, photo) => {
    expect(photo.src).toMatch(/^\/images\/[a-z-]+\/[a-z-]+\.jpg$/);
  });

  it("states the size of each photograph, 16:9 for services and 4:3 for the hero", () => {
    for (const photo of Object.values(SERVICE_PHOTOS)) {
      expect(photo.width / photo.height).toBeCloseTo(16 / 9, 2);
    }
    expect(HOME_HERO_PHOTO.width / HOME_HERO_PHOTO.height).toBeCloseTo(4 / 3, 2);
  });

  it.each(PHOTOS)("%s: is credited in CREDITS.md", (_name, photo) => {
    expect(CREDITS).toContain(`\`${photo.src.replace("/images/", "")}\``);
  });

  it("credits each photograph to a Pexels page and says they are stock images", () => {
    expect(CREDITS).toContain("Pexels License");
    expect(CREDITS.match(/https:\/\/www\.pexels\.com\/photo\//g)?.length).toBeGreaterThanOrEqual(
      PHOTOS.length,
    );
    expect(CREDITS).toMatch(/not the staff, customers or work/);
  });
});
