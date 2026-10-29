import { describe, expect, it } from "vitest";

import {
  BUNDLED_LOGOS,
  BUNDLED_SERVICE_IMAGES,
  isBundledLogoKey,
  isBundledServiceImageKey,
} from "./bundled-assets.js";
import * as shared from "./index.js";
import { isValidSlug } from "./slug.js";

describe("bundled assets", () => {
  it("use unique kebab-case keys and a label for each", () => {
    for (const registry of [BUNDLED_LOGOS, BUNDLED_SERVICE_IMAGES]) {
      const keys = registry.map(({ key }) => key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const { key, label } of registry) {
        expect(isValidSlug(key), key).toBe(true);
        expect(label.length).toBeGreaterThan(1);
      }
    }
  });

  it("accepts a listed logo key and not a service image key, a path or a URL", () => {
    expect(isBundledLogoKey("breeze")).toBe(true);
    expect(isBundledLogoKey("air-conditioning")).toBe(false);
    expect(isBundledLogoKey("/images/logo.png")).toBe(false);
    expect(isBundledLogoKey("https://example.test/logo.png")).toBe(false);
    expect(isBundledLogoKey("Breeze")).toBe(false);
    expect(isBundledLogoKey("")).toBe(false);
    expect(isBundledLogoKey(null)).toBe(false);
  });

  it("accepts a listed service image key and not a logo key, a path or a URL", () => {
    expect(isBundledServiceImageKey("air-conditioning")).toBe(true);
    expect(isBundledServiceImageKey("breeze")).toBe(false);
    expect(isBundledServiceImageKey("../secret")).toBe(false);
    expect(isBundledServiceImageKey("https://example.test/a.png")).toBe(false);
    expect(isBundledServiceImageKey(undefined)).toBe(false);
  });

  it("are re-exported from the package entry point", () => {
    expect(shared.BUNDLED_LOGOS).toBe(BUNDLED_LOGOS);
    expect(shared.isBundledServiceImageKey).toBe(isBundledServiceImageKey);
  });
});
