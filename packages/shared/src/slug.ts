/**
 * Slugs for public service pages (`/services/ac-repair`, D-50). The server is the authority, but the
 * admin form previews the same slug while a name is typed, so the rule lives here once.
 */

/** Lower-case words joined by single hyphens: `ac-routine-maintenance`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MAX_LENGTH = 80;

/** What an unusable name (only symbols, or only a script with no Latin letters) becomes. */
const FALLBACK_SLUG = "service";

/**
 * Turns a name into a kebab-case slug: accents are removed (`Café` → `cafe`), everything that is not
 * a letter or digit becomes one hyphen, and the result is cut at {@link SLUG_MAX_LENGTH} without
 * leaving a trailing hyphen. A name with no usable characters gives `service`.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return slug === "" ? FALLBACK_SLUG : slug;
}

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}
