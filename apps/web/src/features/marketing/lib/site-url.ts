export const LOCAL_SITE_URL = "http://localhost:3000";

export interface SiteUrlEnvironment {
  /** The public address of the website, with or without a path: `https://coolbreeze.example`. */
  SITE_URL?: string | undefined;
  /** Set by Vercel to the production domain, without a scheme: `fixflow.vercel.app`. */
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
}

function parseOrigin(candidate: string): URL | undefined {
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(withScheme);
    return url.hostname === "" ? undefined : new URL(url.origin);
  } catch {
    return undefined;
  }
}

/**
 * The address canonical links, the sitemap and social previews are built from. `SITE_URL` wins, then
 * Vercel's production domain, then localhost for development. Only the origin is kept, so a stray
 * path or a trailing slash cannot end up in every canonical URL; text that is not an address falls
 * through to the next source instead of breaking the build.
 */
export function resolveSiteUrl(environment: SiteUrlEnvironment): URL {
  for (const candidate of [environment.SITE_URL, environment.VERCEL_PROJECT_PRODUCTION_URL]) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      const origin = parseOrigin(trimmed);
      if (origin) return origin;
    }
  }
  return new URL(LOCAL_SITE_URL);
}

export function getSiteUrl(): URL {
  return resolveSiteUrl({
    SITE_URL: process.env.SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}
