import { Role } from "@fixflow/shared";

import type { NavGroup, NavItem } from "@/lib/navigation";

/**
 * The application's navigation, in one place and typed by role (IA-X01).
 *
 * Only routes that exist are listed, so no link is ever dead (CLAUDE.md §10). Each later task adds
 * the entries for the screens it builds, in the order they should appear:
 *
 * - `public`: the public website header (Home, Services and the How it works and Contact anchors, T08).
 * - `admin`: the business dashboard sidebar, in groups (T05 has the dashboard; T12 adds Requests,
 *   T13 Customers, T14 Quotations, …). The admin's "Account" page lives in the user menu, not here.
 * - `portal`: the customer portal top bar (T05 has the overview; T10 adds Profile, T11 Requests, …).
 *
 * The shells take their items from here by default. The dev-only `/styleguide` passes its own
 * example items to the shells so they can be shown with realistic content.
 * `navigation.test.ts` fails if an entry leaves its area (a customer link into `/app`), repeats a
 * path or uses an unknown icon.
 */
export const NAVIGATION = {
  public: [
    { label: "Home", href: "/", icon: "house", match: "exact" },
    { label: "Services", href: "/services", icon: "layers" },
    // Anchors on the home page: they work from every public page.
    { label: "How it works", href: "/#how-it-works", icon: "clipboard-list" },
    { label: "Contact", href: "/#contact", icon: "mail" },
  ] as readonly NavItem[],
  admin: [
    {
      items: [
        { label: "Dashboard", href: "/app/dashboard", icon: "layout-dashboard" },
        { label: "Requests", href: "/app/requests", icon: "inbox" },
        { label: "Customers", href: "/app/customers", icon: "users" },
      ],
    },
    {
      // Admin only: this list is the admin sidebar, and a customer is never handed it.
      label: "Settings",
      items: [
        { label: "Business", href: "/app/settings/business", icon: "settings" },
        { label: "Services", href: "/app/settings/services", icon: "layers" },
      ],
    },
  ] as readonly NavGroup[],
  portal: [
    { label: "Overview", href: "/portal", icon: "house", match: "exact" },
    { label: "Requests", href: "/portal/requests", icon: "clipboard-list" },
    { label: "Profile", href: "/portal/profile", icon: "user" },
  ] as readonly NavItem[],
} as const;

/** The navigation a signed-in role may be shown. The server still enforces access to every route. */
export function navigationForRole(role: Role): readonly NavGroup[] | readonly NavItem[] {
  return role === Role.BUSINESS_ADMIN ? NAVIGATION.admin : NAVIGATION.portal;
}
