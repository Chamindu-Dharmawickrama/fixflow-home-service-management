import { Role } from "@fixflow/shared";

import type { NavGroup, NavItem } from "@/lib/navigation";

/**
 * The application's navigation, in one place and typed by role (IA-X01).
 *
 * Only routes that exist are listed, so no link is ever dead (CLAUDE.md §10). Each later task adds
 * the entries for the screens it builds, in the order they should appear:
 *
 * - `public`: the public website header (T08 adds Services, How it works, Contact).
 * - `admin`: the business dashboard sidebar, in groups (T12 adds Requests, T14 Quotations, …).
 * - `portal`: the customer portal top bar (T10 adds Profile, T11 My requests, …).
 *
 * The shells take their items from here by default. The dev-only `/styleguide` passes its own
 * example items to the shells so they can be shown with realistic content.
 * `navigation.test.ts` fails if an entry leaves its area (a customer link into `/app`), repeats a
 * path or uses an unknown icon.
 */
export const NAVIGATION = {
  public: [] as readonly NavItem[],
  admin: [] as readonly NavGroup[],
  portal: [] as readonly NavItem[],
} as const;

/** The navigation a signed-in role may be shown. The server still enforces access to every route. */
export function navigationForRole(role: Role): readonly NavGroup[] | readonly NavItem[] {
  return role === Role.BUSINESS_ADMIN ? NAVIGATION.admin : NAVIGATION.portal;
}
