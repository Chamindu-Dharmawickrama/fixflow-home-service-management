import { describe, expect, it } from "vitest";

import { buildRobots, buildSitemap, ROBOTS_DISALLOWED_PATHS } from "./discovery";

const SITE = new URL("https://coolbreeze.example");

describe("buildSitemap", () => {
  it("lists the home page, the service list, each active service and the privacy notice, in that order", () => {
    const urls = buildSitemap(SITE, [
      { slug: "ac-routine-maintenance" },
      { slug: "deep-cleaning" },
    ]).map((entry) => entry.url);
    expect(urls).toEqual([
      "https://coolbreeze.example/",
      "https://coolbreeze.example/services",
      "https://coolbreeze.example/services/ac-routine-maintenance",
      "https://coolbreeze.example/services/deep-cleaning",
      "https://coolbreeze.example/privacy",
    ]);
  });

  it("still lists the fixed pages when there are no services (or the API could not be reached)", () => {
    expect(buildSitemap(SITE, []).map((entry) => entry.url)).toEqual([
      "https://coolbreeze.example/",
      "https://coolbreeze.example/services",
      "https://coolbreeze.example/privacy",
    ]);
  });

  it("never lists a signed-in or sign-in page", () => {
    const urls = buildSitemap(SITE, [{ slug: "x" }]).map((entry) => new URL(entry.url).pathname);
    for (const path of urls) {
      expect(path).not.toMatch(/^\/(app|portal|request-service|api|login|register)/);
    }
  });

  it("gives every entry a change frequency and a priority between 0 and 1", () => {
    for (const entry of buildSitemap(SITE, [{ slug: "x" }])) {
      expect(entry.changeFrequency).toBeDefined();
      expect(entry.priority).toBeGreaterThan(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });

  it("builds addresses on the site's own origin, including a non-default port", () => {
    expect(buildSitemap(new URL("http://localhost:3001"), [{ slug: "a" }])[2]?.url).toBe(
      "http://localhost:3001/services/a",
    );
  });
});

describe("buildRobots", () => {
  it("allows the public site and disallows the signed-in areas and the sign-in pages", () => {
    const robots = buildRobots(SITE, { demoMode: false });
    expect(robots.rules).toEqual([
      { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOWED_PATHS] },
    ]);
    for (const path of ["/app", "/portal", "/request-service", "/api/", "/login", "/register"]) {
      expect(ROBOTS_DISALLOWED_PATHS).toContain(path);
    }
  });

  it("advertises the sitemap outside the demo", () => {
    expect(buildRobots(SITE, { demoMode: false }).sitemap).toBe(
      "https://coolbreeze.example/sitemap.xml",
    );
  });

  it("does not advertise the sitemap in the demo, whose pages say noindex", () => {
    expect(buildRobots(SITE, { demoMode: true }).sitemap).toBeUndefined();
  });

  it("does not block the public pages in the demo, so crawlers can read their noindex tag", () => {
    const rules = buildRobots(SITE, { demoMode: true }).rules;
    expect(JSON.stringify(rules)).not.toContain('"disallow":["/"]');
    expect(rules).toEqual([expect.objectContaining({ allow: "/" })]);
  });
});
