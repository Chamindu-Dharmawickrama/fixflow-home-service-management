/**
 * The documented demo accounts shown on the sign-in page in demo mode (D-09). Only their emails
 * live in source: the demo passwords come from `NEXT_PUBLIC_DEMO_*_PASSWORD`, which are public on
 * purpose (they are printed on the login page and in the README) and are different on every
 * deployment. They are fictional accounts on a public portfolio demo, never real people.
 */
export interface DemoAccountOption {
  id: "admin" | "customer";
  name: string;
  roleLabel: string;
  email: string;
  password: string;
  description: string;
  /** What this account can do in the demo, as short phrases. */
  abilities: readonly string[];
  /** What the demo does not let it do. */
  limits: string;
}

export interface DemoAccountSettings {
  /** `NEXT_PUBLIC_DEMO_MODE`. */
  mode: string | undefined;
  /** `NEXT_PUBLIC_DEMO_ADMIN_PASSWORD`. */
  adminPassword: string | undefined;
  /** `NEXT_PUBLIC_DEMO_CUSTOMER_PASSWORD`. */
  customerPassword: string | undefined;
}

/** The settings from the environment. Next.js inlines each `NEXT_PUBLIC_` variable where it is named literally. */
export function demoAccountSettingsFromEnv(): DemoAccountSettings {
  return {
    mode: process.env.NEXT_PUBLIC_DEMO_MODE,
    adminPassword: process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD,
    customerPassword: process.env.NEXT_PUBLIC_DEMO_CUSTOMER_PASSWORD,
  };
}

/** The accounts to offer: none unless demo mode is on, and none whose password is not configured. */
export function getDemoAccounts(
  settings: DemoAccountSettings = demoAccountSettingsFromEnv(),
): DemoAccountOption[] {
  if (settings.mode !== "true") {
    return [];
  }
  const accounts: DemoAccountOption[] = [];
  if (settings.adminPassword) {
    accounts.push({
      id: "admin",
      name: "Morgan Reyes",
      roleLabel: "Business admin",
      email: "admin@demo.fixflow.test",
      password: settings.adminPassword,
      description: "Runs CoolBreeze Home Services: requests, quotations, jobs and invoices.",
      abilities: [
        "Review requests, send quotations and schedule jobs",
        "Complete jobs, issue invoices and record payments",
        "See the dashboard and download lists as CSV",
      ],
      limits:
        "Cannot change its password, or the business name, logo and contact details: they are locked in the demo.",
    });
  }
  if (settings.customerPassword) {
    accounts.push({
      id: "customer",
      name: "Alex Morgan",
      roleLabel: "Customer",
      email: "alex.morgan@example.test",
      password: settings.customerPassword,
      description: "A homeowner who requests services and follows them in the customer portal.",
      abilities: [
        "Send a service request",
        "Accept or decline a quotation",
        "Follow jobs, invoices and payments",
      ],
      limits: "Cannot change its password.",
    });
  }
  return accounts;
}

export const DEMO_NOTICE =
  "Public demo — use fictional details; other visitors can see what you enter.";
