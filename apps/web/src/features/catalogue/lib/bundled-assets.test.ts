import { BUNDLED_LOGOS, BUNDLED_SERVICE_IMAGES } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  ASSET_TONE_CLASSES,
  FALLBACK_SERVICE_IMAGE,
  LOGO_ASSETS,
  logoAsset,
  SERVICE_IMAGE_ASSETS,
  serviceImageAsset,
} from "./bundled-assets";

describe("bundled asset registry", () => {
  it("draws exactly the logos and pictures the API accepts, no more and no fewer", () => {
    expect(Object.keys(LOGO_ASSETS).sort()).toEqual(BUNDLED_LOGOS.map(({ key }) => key).sort());
    expect(Object.keys(SERVICE_IMAGE_ASSETS).sort()).toEqual(
      BUNDLED_SERVICE_IMAGES.map(({ key }) => key).sort(),
    );
  });

  it("gives every drawing an icon and a tone from the design tokens", () => {
    for (const asset of [...Object.values(LOGO_ASSETS), ...Object.values(SERVICE_IMAGE_ASSETS)]) {
      expect(asset.icon).toBeTruthy();
      expect(Object.keys(ASSET_TONE_CLASSES)).toContain(asset.tone);
    }
    for (const classes of Object.values(ASSET_TONE_CLASSES)) {
      expect(classes).toMatch(/^bg-[a-z]+-soft text-[a-z]+$/);
    }
  });

  it("looks a stored key up, and knows nothing about a key it was not built with", () => {
    expect(logoAsset("breeze")).toBe(LOGO_ASSETS.breeze);
    expect(serviceImageAsset("cleaning")).toBe(SERVICE_IMAGE_ASSETS.cleaning);
    expect(logoAsset("cleaning")).toBeUndefined();
    expect(serviceImageAsset("breeze")).toBeUndefined();
    expect(logoAsset(null)).toBeUndefined();
    expect(serviceImageAsset("https://example.test/a.png")).toBeUndefined();
  });

  it("has a picture to fall back on", () => {
    expect(FALLBACK_SERVICE_IMAGE).toBe(SERVICE_IMAGE_ASSETS["general-repair"]);
  });
});
