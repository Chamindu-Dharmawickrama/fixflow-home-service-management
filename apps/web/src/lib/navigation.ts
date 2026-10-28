/** Icon keys a navigation item may use; `components/layout/nav-icons.tsx` maps each to a Lucide icon. */
export const NAV_ICON_NAMES = [
  "layout-dashboard",
  "inbox",
  "file-text",
  "briefcase",
  "calendar",
  "users",
  "wrench",
  "receipt",
  "settings",
  "house",
  "user",
  "palette",
  "layers",
  "clipboard-list",
] as const;
export type NavIconName = (typeof NAV_ICON_NAMES)[number];

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
  /**
   * `prefix` (default) marks the item active for its own path and everything beneath it, so
   * `/app/requests` stays highlighted on `/app/requests/42`. `exact` is for index pages such as `/portal`.
   */
  match?: "exact" | "prefix" | undefined;
}

export interface NavGroup {
  /** A small heading above the group. Leave out for a single ungrouped list. */
  label?: string | undefined;
  items: readonly NavItem[];
}

/** True when `pathname` is the item's page or, for `prefix` items, any page beneath it. */
export function isActivePath(
  pathname: string,
  href: string,
  match: NavItem["match"] = "prefix",
): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const target = href.length > 1 ? href.replace(/\/+$/, "") : href;
  if (match === "exact") {
    return path === target;
  }
  return path === target || path.startsWith(`${target}/`);
}

/** The most specific active item's href: when two items match, the longer path wins. */
export function findActiveHref(pathname: string, items: readonly NavItem[]): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    if (
      isActivePath(pathname, item.href, item.match) &&
      (best === undefined || item.href.length > best.length)
    ) {
      best = item.href;
    }
  }
  return best;
}

export function flattenGroups(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => [...group.items]);
}

export type NavArea = "public" | "admin" | "portal";

const AREA_PREFIX: Record<Exclude<NavArea, "public">, string> = {
  admin: "/app",
  portal: "/portal",
};

/**
 * Problems with a navigation list, as readable sentences (empty when it is fine):
 * duplicate paths, a path outside the area's prefix (a customer must never be handed an `/app`
 * link, IA-X01), a path that is not an absolute app path, or an icon the registry does not know.
 */
export function validateNavigation(area: NavArea, items: readonly NavItem[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item.href.startsWith("/") || item.href.startsWith("//")) {
      problems.push(`"${item.label}" must link to an absolute app path, not "${item.href}".`);
    }
    if (seen.has(item.href)) {
      problems.push(`"${item.href}" appears more than once.`);
    }
    seen.add(item.href);

    if (area === "public") {
      for (const prefix of Object.values(AREA_PREFIX)) {
        if (item.href === prefix || item.href.startsWith(`${prefix}/`)) {
          problems.push(`Public navigation must not link into ${prefix} ("${item.label}").`);
        }
      }
    } else {
      const prefix = AREA_PREFIX[area];
      if (item.href !== prefix && !item.href.startsWith(`${prefix}/`)) {
        problems.push(`"${item.label}" ("${item.href}") is outside ${prefix}.`);
      }
    }
    if (!(NAV_ICON_NAMES as readonly string[]).includes(item.icon)) {
      problems.push(`"${item.label}" uses the unknown icon "${item.icon}".`);
    }
  }
  return problems;
}
