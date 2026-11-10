import { Role } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { NAVIGATION, navigationForRole } from "@/config/navigation";

import {
  findActiveHref,
  flattenGroups,
  isActivePath,
  type NavItem,
  validateNavigation,
} from "./navigation";

const item = (href: string, overrides: Partial<NavItem> = {}): NavItem => ({
  label: href,
  href,
  icon: "layout-dashboard",
  ...overrides,
});

describe("isActivePath", () => {
  it("matches the item's own page and the pages beneath it", () => {
    expect(isActivePath("/app/requests", "/app/requests")).toBe(true);
    expect(isActivePath("/app/requests/42", "/app/requests")).toBe(true);
    expect(isActivePath("/app/requests/", "/app/requests")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isActivePath("/app/requests-archive", "/app/requests")).toBe(false);
    expect(isActivePath("/app/quotations", "/app/requests")).toBe(false);
  });

  it("matches an index page exactly when asked to", () => {
    expect(isActivePath("/portal", "/portal", "exact")).toBe(true);
    expect(isActivePath("/portal/requests", "/portal", "exact")).toBe(false);
    expect(isActivePath("/portal/requests", "/portal", "prefix")).toBe(true);
  });

  it("treats the root path specially", () => {
    expect(isActivePath("/", "/", "exact")).toBe(true);
    expect(isActivePath("/services", "/", "exact")).toBe(false);
  });
});

describe("findActiveHref", () => {
  it("prefers the most specific match", () => {
    const items = [item("/app/settings"), item("/app/settings/services")];
    expect(findActiveHref("/app/settings/services", items)).toBe("/app/settings/services");
    expect(findActiveHref("/app/settings/business", items)).toBe("/app/settings");
  });

  it("returns undefined when nothing matches", () => {
    expect(findActiveHref("/elsewhere", [item("/app/requests")])).toBeUndefined();
  });
});

describe("validateNavigation", () => {
  it("accepts a well-formed list", () => {
    expect(validateNavigation("admin", [item("/app/dashboard"), item("/app/requests")])).toEqual(
      [],
    );
    expect(validateNavigation("portal", [item("/portal", { match: "exact" })])).toEqual([]);
    expect(validateNavigation("public", [item("/services"), item("/")])).toEqual([]);
  });

  it("rejects a customer link into the business application", () => {
    const problems = validateNavigation("portal", [item("/app/requests")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/outside \/portal/);
  });

  it("rejects a business link into the customer portal", () => {
    expect(validateNavigation("admin", [item("/portal/requests")])[0]).toMatch(/outside \/app/);
  });

  it("rejects public navigation that points into either application", () => {
    expect(validateNavigation("public", [item("/app/dashboard")])).toHaveLength(1);
    expect(validateNavigation("public", [item("/portal")])).toHaveLength(1);
  });

  it("rejects duplicates, relative or external-looking paths and unknown icons", () => {
    expect(validateNavigation("admin", [item("/app/a"), item("/app/a")])).toHaveLength(1);
    expect(validateNavigation("public", [item("services")])).toHaveLength(1);
    expect(validateNavigation("public", [item("//evil.example/x")])[0]).toMatch(
      /absolute app path/,
    );
    expect(validateNavigation("public", [item("/x", { icon: "skull" as never })])[0]).toMatch(
      /unknown icon/,
    );
  });
});

describe("central navigation config", () => {
  it("keeps every area inside its own prefix", () => {
    expect(validateNavigation("public", NAVIGATION.public)).toEqual([]);
    expect(validateNavigation("admin", flattenGroups(NAVIGATION.admin))).toEqual([]);
    expect(validateNavigation("portal", NAVIGATION.portal)).toEqual([]);
  });

  it("gives each role only its own navigation", () => {
    expect(navigationForRole(Role.BUSINESS_ADMIN)).toBe(NAVIGATION.admin);
    expect(navigationForRole(Role.CUSTOMER)).toBe(NAVIGATION.portal);
  });

  it("lists the customer's pages in the order they are used (T10, T11, T18, T22)", () => {
    expect(NAVIGATION.portal.map((item) => [item.label, item.href])).toEqual([
      ["Overview", "/portal"],
      ["Requests", "/portal/requests"],
      ["Jobs", "/portal/jobs"],
      ["Invoices", "/portal/invoices"],
      ["Profile", "/portal/profile"],
    ]);
  });

  it("lists the dashboard, the request queue, the jobs, the calendar, the invoices, the customers and the technicians, ahead of the settings (T12, T13, T16, T17, T19, T20)", () => {
    expect(flattenGroups(NAVIGATION.admin).map((item) => [item.label, item.href])).toEqual([
      ["Dashboard", "/app/dashboard"],
      ["Requests", "/app/requests"],
      ["Jobs", "/app/jobs"],
      ["Calendar", "/app/calendar"],
      ["Invoices", "/app/invoices"],
      ["Customers", "/app/customers"],
      ["Technicians", "/app/technicians"],
      ["Business", "/app/settings/business"],
      ["Services", "/app/settings/services"],
    ]);
  });

  it("lists the settings pages, for the admin only (T07)", () => {
    const settings = NAVIGATION.admin.find((group) => group.label === "Settings");
    expect(settings?.items.map((item) => [item.label, item.href])).toEqual([
      ["Business", "/app/settings/business"],
      ["Services", "/app/settings/services"],
    ]);

    // A customer is handed nothing that leads to the business's configuration.
    const customerPaths = (navigationForRole(Role.CUSTOMER) as typeof NAVIGATION.portal).map(
      (item) => item.href,
    );
    expect(customerPaths.some((href) => href.startsWith("/app"))).toBe(false);
    expect(customerPaths.some((href) => href.includes("settings"))).toBe(false);
  });
});
