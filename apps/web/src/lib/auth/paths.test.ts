import { Role } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import {
  areaForRole,
  areaOf,
  destinationAfterSignIn,
  loginUrl,
  protectionRedirect,
  roleHomePath,
} from "./paths";

describe("areaOf", () => {
  it.each([
    ["/app", "admin"],
    ["/app/dashboard", "admin"],
    ["/app/requests/42", "admin"],
    ["/portal", "portal"],
    ["/portal/requests", "portal"],
  ])("puts %s in the %s area", (path, area) => {
    expect(areaOf(path)).toBe(area);
  });

  it.each(["/", "/login", "/services", "/application", "/portals", "/apple", "/styleguide"])(
    "leaves %s public",
    (path) => {
      expect(areaOf(path)).toBeUndefined();
    },
  );
});

describe("role home paths", () => {
  it("sends an admin to the dashboard and a customer to the portal", () => {
    expect(roleHomePath(Role.BUSINESS_ADMIN)).toBe("/app/dashboard");
    expect(roleHomePath(Role.CUSTOMER)).toBe("/portal");
    expect(areaForRole(Role.BUSINESS_ADMIN)).toBe("admin");
    expect(areaForRole(Role.CUSTOMER)).toBe("portal");
  });
});

describe("loginUrl", () => {
  it("encodes the destination", () => {
    expect(loginUrl("/app/dashboard")).toBe("/login?returnTo=%2Fapp%2Fdashboard");
    expect(loginUrl("/app/requests?status=NEW&page=2")).toBe(
      "/login?returnTo=%2Fapp%2Frequests%3Fstatus%3DNEW%26page%3D2",
    );
  });

  it("drops an unsafe destination instead of passing it on", () => {
    expect(loginUrl("https://evil.test")).toBe("/login");
    expect(loginUrl("//evil.test")).toBe("/login");
    expect(loginUrl()).toBe("/login");
  });
});

describe("destinationAfterSignIn", () => {
  it("returns the requested page when it belongs to the person's area", () => {
    expect(destinationAfterSignIn("/app/requests?page=2", Role.BUSINESS_ADMIN)).toBe(
      "/app/requests?page=2",
    );
    expect(destinationAfterSignIn("/portal/requests", Role.CUSTOMER)).toBe("/portal/requests");
  });

  it("returns a public page too", () => {
    expect(destinationAfterSignIn("/services/home-deep-cleaning", Role.CUSTOMER)).toBe(
      "/services/home-deep-cleaning",
    );
  });

  it("falls back to the role's home with no destination", () => {
    expect(destinationAfterSignIn(null, Role.BUSINESS_ADMIN)).toBe("/app/dashboard");
    expect(destinationAfterSignIn(undefined, Role.CUSTOMER)).toBe("/portal");
  });

  it("sends a customer who followed an admin link to their portal, and an admin the other way", () => {
    expect(destinationAfterSignIn("/app/dashboard", Role.CUSTOMER)).toBe("/portal");
    expect(destinationAfterSignIn("/portal/requests", Role.BUSINESS_ADMIN)).toBe("/app/dashboard");
  });

  it.each(["https://evil.test", "//evil.test", "/\\evil", "javascript:alert(1)", "/\t/evil.test"])(
    "treats the open-redirect attempt %j as no destination",
    (attempt) => {
      expect(destinationAfterSignIn(attempt, Role.CUSTOMER)).toBe("/portal");
      expect(destinationAfterSignIn(attempt, Role.BUSINESS_ADMIN)).toBe("/app/dashboard");
    },
  );
});

describe("protectionRedirect", () => {
  it("sends a visitor without a session cookie from a protected page to sign-in, remembering the page", () => {
    expect(
      protectionRedirect({ pathname: "/app/dashboard", search: "", hasSessionCookie: false }),
    ).toBe("/login?returnTo=%2Fapp%2Fdashboard");
    expect(
      protectionRedirect({ pathname: "/portal", search: "?tab=invoices", hasSessionCookie: false }),
    ).toBe("/login?returnTo=%2Fportal%3Ftab%3Dinvoices");
  });

  it("lets a request with a session cookie through, even before the API has checked it", () => {
    expect(
      protectionRedirect({ pathname: "/app/dashboard", search: "", hasSessionCookie: true }),
    ).toBeUndefined();
  });

  it("sends /app, which has no page of its own, to the dashboard", () => {
    for (const hasSessionCookie of [true, false]) {
      expect(protectionRedirect({ pathname: "/app", search: "", hasSessionCookie })).toBe(
        "/app/dashboard",
      );
      expect(protectionRedirect({ pathname: "/app/", search: "", hasSessionCookie })).toBe(
        "/app/dashboard",
      );
    }
  });

  it("leaves public pages alone", () => {
    for (const pathname of ["/", "/login", "/register", "/services", "/reset-password"]) {
      expect(protectionRedirect({ pathname, search: "", hasSessionCookie: false })).toBeUndefined();
    }
  });
});
