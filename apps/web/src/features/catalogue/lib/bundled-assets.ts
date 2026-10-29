import {
  type BundledLogoKey,
  type BundledServiceImageKey,
  isBundledLogoKey,
  isBundledServiceImageKey,
} from "@fixflow/shared";
import {
  AirVent,
  Droplets,
  Flame,
  Hammer,
  House,
  type LucideIcon,
  Snowflake,
  Sparkles,
  SprayCan,
  WashingMachine,
  Wind,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * How each bundled logo and picture is drawn (D-30, Q-05). There are no photographs yet, so every
 * key is an illustrative composition: a Lucide icon on a tinted tile from the design tokens. The
 * keys themselves come from `@fixflow/shared`, where the API validates them; the `Record` types
 * make a key without a drawing, or a drawing without a key, a compile error.
 */

export type AssetTone = "brand" | "accent" | "info" | "success" | "attention";

export interface BundledAsset {
  icon: LucideIcon;
  tone: AssetTone;
}

/** Full class names, so Tailwind sees them: a tinted tile with an icon in the matching strong colour. */
export const ASSET_TONE_CLASSES: Record<AssetTone, string> = {
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  attention: "bg-attention-soft text-attention",
};

export const LOGO_ASSETS: Record<BundledLogoKey, BundledAsset> = {
  breeze: { icon: Wind, tone: "accent" },
  snowflake: { icon: Snowflake, tone: "info" },
  wrench: { icon: Wrench, tone: "brand" },
  house: { icon: House, tone: "success" },
  spark: { icon: Sparkles, tone: "attention" },
};

export const SERVICE_IMAGE_ASSETS: Record<BundledServiceImageKey, BundledAsset> = {
  "air-conditioning": { icon: AirVent, tone: "info" },
  "appliance-repair": { icon: WashingMachine, tone: "brand" },
  electrical: { icon: Zap, tone: "attention" },
  cleaning: { icon: SprayCan, tone: "accent" },
  plumbing: { icon: Droplets, tone: "info" },
  heating: { icon: Flame, tone: "attention" },
  "general-repair": { icon: Hammer, tone: "success" },
};

/** What a service shows when it has no picture, or its web address does not load. */
export const FALLBACK_SERVICE_IMAGE: BundledAsset = SERVICE_IMAGE_ASSETS["general-repair"];

/** The drawing for a stored logo key; `undefined` for a key this build does not know. */
export function logoAsset(key: string | null): BundledAsset | undefined {
  return isBundledLogoKey(key) ? LOGO_ASSETS[key] : undefined;
}

/** The drawing for a stored picture key; `undefined` for a key this build does not know. */
export function serviceImageAsset(key: string | null): BundledAsset | undefined {
  return isBundledServiceImageKey(key) ? SERVICE_IMAGE_ASSETS[key] : undefined;
}
