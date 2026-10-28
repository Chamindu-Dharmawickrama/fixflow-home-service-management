import type { NavGroup, NavItem } from "@/lib/navigation";

/**
 * Example navigation for the shell demos. The real application's navigation lives in
 * `config/navigation.ts` and lists only routes that exist; these items point at the demo pages.
 */

export const ADMIN_EXAMPLE_HOME = "/styleguide/shells/admin";

export const ADMIN_EXAMPLE_NAV: readonly NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Dashboard", href: ADMIN_EXAMPLE_HOME, icon: "layout-dashboard", match: "exact" },
      { label: "Requests", href: `${ADMIN_EXAMPLE_HOME}/requests`, icon: "inbox" },
      { label: "Quotations", href: `${ADMIN_EXAMPLE_HOME}/quotations`, icon: "file-text" },
      { label: "Jobs", href: `${ADMIN_EXAMPLE_HOME}/jobs`, icon: "briefcase" },
      { label: "Calendar", href: `${ADMIN_EXAMPLE_HOME}/calendar`, icon: "calendar" },
    ],
  },
  {
    label: "People and money",
    items: [
      { label: "Customers", href: `${ADMIN_EXAMPLE_HOME}/customers`, icon: "users" },
      { label: "Technicians", href: `${ADMIN_EXAMPLE_HOME}/technicians`, icon: "wrench" },
      { label: "Invoices", href: `${ADMIN_EXAMPLE_HOME}/invoices`, icon: "receipt" },
    ],
  },
  {
    label: "Business",
    items: [{ label: "Settings", href: `${ADMIN_EXAMPLE_HOME}/settings`, icon: "settings" }],
  },
];

/** The generic example sections, rendered by `shells/admin/[section]`. */
export const ADMIN_EXAMPLE_SECTIONS = [
  "quotations",
  "jobs",
  "calendar",
  "customers",
  "technicians",
  "invoices",
  "settings",
] as const;

export const PORTAL_EXAMPLE_HOME = "/styleguide/shells/portal";

export const PORTAL_EXAMPLE_NAV: readonly NavItem[] = [
  { label: "Overview", href: PORTAL_EXAMPLE_HOME, icon: "house", match: "exact" },
  { label: "My requests", href: `${PORTAL_EXAMPLE_HOME}/requests`, icon: "inbox" },
  { label: "Quotation", href: `${PORTAL_EXAMPLE_HOME}/quotation`, icon: "file-text" },
  { label: "Jobs", href: `${PORTAL_EXAMPLE_HOME}/jobs`, icon: "briefcase" },
  { label: "Invoice", href: `${PORTAL_EXAMPLE_HOME}/invoice`, icon: "receipt" },
];

export const PORTAL_EXAMPLE_SECTIONS = ["requests", "jobs"] as const;

export const PUBLIC_EXAMPLE_HOME = "/styleguide/shells/public";

export const PUBLIC_EXAMPLE_NAV: readonly NavItem[] = [
  { label: "Services", href: `${PUBLIC_EXAMPLE_HOME}/services`, icon: "layers" },
  { label: "How it works", href: `${PUBLIC_EXAMPLE_HOME}/how-it-works`, icon: "clipboard-list" },
];

export const AUTH_EXAMPLE_HOME = "/styleguide/shells/auth";
