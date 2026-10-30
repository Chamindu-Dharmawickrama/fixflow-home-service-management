import type { PublicServiceDto } from "@fixflow/shared";
import type { MetadataRoute } from "next";

/**
 * What search engines are told about the site: the sitemap and robots.txt (T08, D-89). Pure, so the
 * rules are unit-tested; `app/sitemap.ts` and `app/robots.ts` feed them the live data.
 */

/** Areas that need a sign-in or have no value in search results. */
export const ROBOTS_DISALLOWED_PATHS = [
  "/app",
  "/portal",
  "/request-service",
  "/api/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

function absolute(siteUrl: URL, path: string): string {
  return new URL(path, siteUrl).toString();
}

/** Home, the service list, one entry per active service, and the privacy notice. */
export function buildSitemap(
  siteUrl: URL,
  services: readonly Pick<PublicServiceDto, "slug">[],
): MetadataRoute.Sitemap {
  return [
    { url: absolute(siteUrl, "/"), changeFrequency: "weekly", priority: 1 },
    { url: absolute(siteUrl, "/services"), changeFrequency: "weekly", priority: 0.9 },
    ...services.map((service) => ({
      url: absolute(siteUrl, `/services/${service.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: absolute(siteUrl, "/privacy"), changeFrequency: "yearly", priority: 0.3 },
  ];
}

/**
 * robots.txt. Signed-in areas and the sign-in pages are never crawled. In the portfolio demo
 * (fictional business) the public pages carry `noindex` instead (crawlers must be allowed in to see
 * it), and the sitemap is not advertised, because listing pages that say "do not index" is a mixed
 * signal that search consoles flag.
 */
export function buildRobots(siteUrl: URL, options: { demoMode: boolean }): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOWED_PATHS] }],
    ...(options.demoMode ? {} : { sitemap: absolute(siteUrl, "/sitemap.xml") }),
  };
}
