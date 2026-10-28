import Link from "next/link";

import { NAV_ICONS } from "@/components/layout/nav-icons";
import { flattenGroups, type NavGroup, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export type NavVariant =
  /** The vertical list on the deep-navy admin sidebar and the mobile drawer. */
  | "sidebar"
  /** A horizontal row of links in a light header (portal and public site). */
  | "top"
  /** A vertical list on a light surface (the public mobile menu). */
  | "stacked";

const ITEM_BASE =
  "relative flex items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ease-standard";

const ITEM_STYLES: Record<NavVariant, { idle: string; active: string }> = {
  sidebar: {
    idle: "h-11 text-nav-text hover:bg-nav-hover hover:text-surface lg:h-10",
    active:
      "h-11 bg-nav-active text-surface before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent-fill lg:h-10",
  },
  top: {
    idle: "h-10 text-ink-secondary hover:bg-surface-muted hover:text-ink",
    active: "h-10 bg-brand-soft text-brand",
  },
  stacked: {
    idle: "h-11 text-ink hover:bg-surface-muted",
    active: "h-11 bg-brand-soft text-brand",
  },
};

export interface NavItemsProps {
  groups: readonly NavGroup[];
  variant: NavVariant;
  /** The href of the item to mark current. Computed from the URL by `NavList`; omitted in static fallbacks. */
  activeHref?: string | undefined;
  /** Called when a link is chosen, so a drawer can close itself. */
  onNavigate?: (() => void) | undefined;
  className?: string | undefined;
}

function NavLinkItem({
  item,
  variant,
  active,
  onNavigate,
}: {
  item: NavItem;
  variant: NavVariant;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  const Icon = NAV_ICONS[item.icon];
  const styles = ITEM_STYLES[variant];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className={cn(ITEM_BASE, active ? styles.active : styles.idle)}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Navigation links with icons, grouped under optional headings. It only draws what it is given;
 * which links exist comes from `config/navigation.ts`, and which one is current from `NavList`.
 */
export function NavItems({ groups, variant, activeHref, onNavigate, className }: NavItemsProps) {
  const visibleGroups = groups.filter((group) => group.items.length > 0);
  if (flattenGroups(visibleGroups).length === 0) {
    return null;
  }

  if (variant === "top") {
    return (
      <ul className={cn("flex items-center gap-1", className)}>
        {flattenGroups(visibleGroups).map((item) => (
          <li key={item.href}>
            <NavLinkItem
              item={item}
              variant={variant}
              active={item.href === activeHref}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {visibleGroups.map((group, index) => {
        const headingId = group.label ? `nav-group-${index}` : undefined;
        return (
          <div key={group.label ?? index} className="flex flex-col gap-1">
            {group.label ? (
              <p
                id={headingId}
                className={cn(
                  "px-3 pb-1 text-xs font-semibold",
                  variant === "sidebar" ? "text-nav-muted" : "text-ink-muted",
                )}
              >
                {group.label}
              </p>
            ) : null}
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLinkItem
                    item={item}
                    variant={variant}
                    active={item.href === activeHref}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
