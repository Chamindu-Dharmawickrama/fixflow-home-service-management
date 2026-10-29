import type { Metadata } from "next";

/** What titles read when the business name cannot be loaded: the product's own name (D-31). */
export const FALLBACK_BUSINESS_NAME = "FixFlow";

const DESCRIPTION_LIMIT = 160;

/** "AC Routine Maintenance · CoolBreeze Home Services" (D-31): the page first, then the business. */
export function pageTitle(pageName: string, businessName: string): string {
  return `${pageName} · ${businessName}`;
}

/**
 * Shortens text to a search-result-sized description: whitespace collapsed, cut at a word boundary
 * and ended with an ellipsis only when something was cut.
 */
export function truncateDescription(text: string, limit: number = DESCRIPTION_LIMIT): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${atWord.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

export interface PageMetadataInput {
  /** The page's own name: "Our services", "AC Routine Maintenance". */
  pageName: string;
  businessName: string;
  description: string;
  /** The page's path, `/services/ac-routine-maintenance`; resolved against `metadataBase` into the canonical URL. */
  path: `/${string}`;
  /** The demo deployment, a not-found page and similar are kept out of search results. */
  noIndex?: boolean | undefined;
}

/**
 * Title, description, canonical URL, Open Graph and Twitter tags for a public page. The title is
 * absolute so the root layout's "· FixFlow" template does not follow the business name (D-31).
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const title = pageTitle(input.pageName, input.businessName);
  const description = truncateDescription(input.description);

  return {
    title: { absolute: title },
    description,
    applicationName: input.businessName,
    alternates: { canonical: input.path },
    openGraph: {
      type: "website",
      siteName: input.businessName,
      title,
      description,
      url: input.path,
      locale: "en_US",
    },
    twitter: { card: "summary", title, description },
    ...(input.noIndex ? { robots: { index: false, follow: false } } : {}),
  };
}
