import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy({ development: false }));
  const development = directives(contentSecurityPolicy({ development: true }));

  it("allows Google Identity Services where Google's documentation says it needs to be", () => {
    expect(production.get("script-src")).toContain("https://accounts.google.com/gsi/client");
    expect(production.get("frame-src")).toEqual(["https://accounts.google.com/gsi/"]);
    expect(production.get("connect-src")).toContain("https://accounts.google.com/gsi/");
    expect(production.get("style-src")).toContain("https://accounts.google.com/gsi/style");
  });

  it("refuses framing, plugins, foreign <base> and foreign form targets", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.get("default-src")).toEqual(["'self'"]);
  });

  it("allows eval and the hot-reload socket in development only", () => {
    expect(production.get("script-src")).not.toContain("'unsafe-eval'");
    expect(development.get("script-src")).toContain("'unsafe-eval'");
    expect(production.get("connect-src")).not.toContain("ws:");
    expect(development.get("connect-src")).toContain("ws:");
    expect(production.has("upgrade-insecure-requests")).toBe(true);
    expect(development.has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows no other site to run scripts or be connected to", () => {
    for (const policy of [production, development]) {
      const scripts = (policy.get("script-src") ?? []).filter((source) =>
        source.startsWith("http"),
      );
      expect(scripts).toEqual(["https://accounts.google.com/gsi/client"]);
      const connections = (policy.get("connect-src") ?? []).filter((source) =>
        source.startsWith("http"),
      );
      expect(connections).toEqual(["https://accounts.google.com/gsi/"]);
    }
  });
});

describe("securityHeaders", () => {
  it("sends the referrer, sniffing, framing, permissions and opener policies", () => {
    const headers = new Map(securityHeaders({ development: false }).map((h) => [h.key, h.value]));
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    // `same-origin` would break Google's sign-in popup.
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d+/);
  });

  it("leaves HSTS out in development, where the site is plain http", () => {
    const keys = securityHeaders({ development: true }).map((header) => header.key);
    expect(keys).not.toContain("Strict-Transport-Security");
    expect(keys).toContain("Content-Security-Policy");
  });
});
