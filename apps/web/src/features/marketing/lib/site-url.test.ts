import { describe, expect, it } from "vitest";

import { LOCAL_SITE_URL, resolveSiteUrl } from "./site-url";

describe("resolveSiteUrl", () => {
  it("uses SITE_URL first", () => {
    expect(
      resolveSiteUrl({
        SITE_URL: "https://coolbreeze.example",
        VERCEL_PROJECT_PRODUCTION_URL: "fixflow.vercel.app",
      }).href,
    ).toBe("https://coolbreeze.example/");
  });

  it("falls back to Vercel's production domain, which has no scheme", () => {
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "fixflow.vercel.app" }).href).toBe(
      "https://fixflow.vercel.app/",
    );
  });

  it("falls back to localhost for development", () => {
    expect(resolveSiteUrl({}).href).toBe(`${LOCAL_SITE_URL}/`);
    expect(resolveSiteUrl({ SITE_URL: "   " }).origin).toBe(LOCAL_SITE_URL);
  });

  it("keeps only the origin, so a path or trailing slash cannot end up in every canonical URL", () => {
    expect(resolveSiteUrl({ SITE_URL: "https://coolbreeze.example/en/home/?x=1#top" }).href).toBe(
      "https://coolbreeze.example/",
    );
    expect(resolveSiteUrl({ SITE_URL: "http://localhost:3001" }).origin).toBe(
      "http://localhost:3001",
    );
  });

  it("assumes https when the scheme is left out", () => {
    expect(resolveSiteUrl({ SITE_URL: "coolbreeze.example" }).origin).toBe(
      "https://coolbreeze.example",
    );
  });

  it("skips a value that is not an address instead of breaking the build", () => {
    expect(
      resolveSiteUrl({
        SITE_URL: "not a url at all",
        VERCEL_PROJECT_PRODUCTION_URL: "fixflow.vercel.app",
      }).origin,
    ).toBe("https://fixflow.vercel.app");
    expect(resolveSiteUrl({ SITE_URL: "https://" }).origin).toBe(LOCAL_SITE_URL);
  });
});
