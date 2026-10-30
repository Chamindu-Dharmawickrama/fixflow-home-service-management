import {
  type BundledLogoKey,
  type BundledServiceImageKey,
  isBundledLogoKey,
  isBundledServiceImageKey,
} from "@fixflow/shared";
import {
  AirVent,
  Droplets,
  Fan,
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
 * How each bundled logo and picture is drawn (D-30, D-85, D-90). A logo is a Lucide icon on a tinted
 * tile from the design tokens. A service picture is a royalty-free photograph served from this app
 * (`public/images/services`, credited in `public/images/CREDITS.md`), with the same tile kept for
 * the picker's fallback and for a service whose picture is missing. The keys themselves come from
 * `@fixflow/shared`, where the API validates them; the `Record` types make a key without a drawing,
 * or a drawing without a key, a compile error.
 */

export type AssetTone = "brand" | "accent" | "info" | "success" | "attention";

/** A photograph shipped with the app: its public path and its pixel size (for `next/image`). */
export interface BundledPhoto {
  src: string;
  width: number;
  height: number;
}

export interface BundledAsset {
  icon: LucideIcon;
  tone: AssetTone;
  /** Present for the service pictures, absent for logos. */
  photo?: BundledPhoto;
}

const SERVICE_PHOTO_SIZE = { width: 1200, height: 675 } as const;

/** One photograph per bundled service picture key; `public-photos.test.ts` checks each file exists. */
export const SERVICE_PHOTOS: Record<BundledServiceImageKey, BundledPhoto> = {
  "air-conditioning": { src: "/images/services/air-conditioning.jpg", ...SERVICE_PHOTO_SIZE },
  "indoor-unit": { src: "/images/services/indoor-unit.jpg", ...SERVICE_PHOTO_SIZE },
  "appliance-repair": { src: "/images/services/appliance-repair.jpg", ...SERVICE_PHOTO_SIZE },
  electrical: { src: "/images/services/electrical.jpg", ...SERVICE_PHOTO_SIZE },
  cleaning: { src: "/images/services/cleaning.jpg", ...SERVICE_PHOTO_SIZE },
  plumbing: { src: "/images/services/plumbing.jpg", ...SERVICE_PHOTO_SIZE },
  heating: { src: "/images/services/heating.jpg", ...SERVICE_PHOTO_SIZE },
  "general-repair": { src: "/images/services/general-repair.jpg", ...SERVICE_PHOTO_SIZE },
};

/** The hero photograph of the homepage. */
export const HOME_HERO_PHOTO: BundledPhoto = {
  src: "/images/home/living-room.jpg",
  width: 1400,
  height: 1050,
};

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
  "air-conditioning": { icon: AirVent, tone: "info", photo: SERVICE_PHOTOS["air-conditioning"] },
  "indoor-unit": { icon: Fan, tone: "info", photo: SERVICE_PHOTOS["indoor-unit"] },
  "appliance-repair": {
    icon: WashingMachine,
    tone: "brand",
    photo: SERVICE_PHOTOS["appliance-repair"],
  },
  electrical: { icon: Zap, tone: "attention", photo: SERVICE_PHOTOS.electrical },
  cleaning: { icon: SprayCan, tone: "accent", photo: SERVICE_PHOTOS.cleaning },
  plumbing: { icon: Droplets, tone: "info", photo: SERVICE_PHOTOS.plumbing },
  heating: { icon: Flame, tone: "attention", photo: SERVICE_PHOTOS.heating },
  "general-repair": { icon: Hammer, tone: "success", photo: SERVICE_PHOTOS["general-repair"] },
};

/** What a service shows when it has no picture, or its web address does not load: a tile, never a photograph. */
export const FALLBACK_SERVICE_IMAGE: BundledAsset = { icon: Hammer, tone: "success" };

/** The drawing for a stored logo key; `undefined` for a key this build does not know. */
export function logoAsset(key: string | null): BundledAsset | undefined {
  return isBundledLogoKey(key) ? LOGO_ASSETS[key] : undefined;
}

/** The drawing for a stored picture key; `undefined` for a key this build does not know. */
export function serviceImageAsset(key: string | null): BundledAsset | undefined {
  return isBundledServiceImageKey(key) ? SERVICE_IMAGE_ASSETS[key] : undefined;
}
