/**
 * Bundled logos and service images (D-30). The MVP has no file uploads, so an admin picks a logo or
 * a service picture from this fixed set by key (or enters an `https://` address, which is only ever
 * shown on web pages and never fetched by the server). The API accepts these keys and nothing else;
 * the web app draws each logo as a tile from the design tokens and each service picture as a
 * royalty-free photograph shipped with the app (D-90), so there is no image file to hot-link and
 * none that a user can supply.
 */

/** Logo marks the business can choose. The text of the business name is always shown beside them. */
export const BUNDLED_LOGOS = [
  { key: "breeze", label: "Breeze" },
  { key: "snowflake", label: "Snowflake" },
  { key: "wrench", label: "Wrench" },
  { key: "house", label: "House" },
  { key: "spark", label: "Spark" },
] as const;

export type BundledLogoKey = (typeof BUNDLED_LOGOS)[number]["key"];

/** Pictures for service cards and pages, chosen by what the service is about. */
export const BUNDLED_SERVICE_IMAGES = [
  { key: "air-conditioning", label: "Air conditioning" },
  { key: "indoor-unit", label: "Indoor air conditioner" },
  { key: "appliance-repair", label: "Appliance repair" },
  { key: "electrical", label: "Electrical" },
  { key: "cleaning", label: "Cleaning" },
  { key: "plumbing", label: "Plumbing" },
  { key: "heating", label: "Heating" },
  { key: "general-repair", label: "General repair" },
] as const;

export type BundledServiceImageKey = (typeof BUNDLED_SERVICE_IMAGES)[number]["key"];

const LOGO_KEYS: ReadonlySet<string> = new Set(BUNDLED_LOGOS.map(({ key }) => key));
const SERVICE_IMAGE_KEYS: ReadonlySet<string> = new Set(
  BUNDLED_SERVICE_IMAGES.map(({ key }) => key),
);

export function isBundledLogoKey(value: unknown): value is BundledLogoKey {
  return typeof value === "string" && LOGO_KEYS.has(value);
}

export function isBundledServiceImageKey(value: unknown): value is BundledServiceImageKey {
  return typeof value === "string" && SERVICE_IMAGE_KEYS.has(value);
}
