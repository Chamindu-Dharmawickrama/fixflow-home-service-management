import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicPage } from "@/features/marketing/components/public-page";
import { ServiceDetail } from "@/features/marketing/components/service-detail";
import { getActiveServices, getSiteSettings } from "@/features/marketing/lib/public-data";
import { buildPageMetadata, FALLBACK_BUSINESS_NAME } from "@/features/marketing/lib/seo";
import { isDemoMode } from "@/lib/demo-mode";

type ServicePageProps = { params: Promise<{ slug: string }> };

/**
 * With Cache Components a dynamic route needs at least one prerendered path. The active services
 * are prerendered when the API can be reached at build time; if it cannot, a placeholder keeps the
 * build green (the page for it is a 404) and every real service renders on its first visit. The
 * build never depends on a running API (D-87).
 */
const PLACEHOLDER_SLUG = "service-placeholder";

export async function generateStaticParams() {
  const result = await getActiveServices();
  const slugs = result.status === "ok" ? result.data.map((service) => service.slug) : [];
  return (slugs.length > 0 ? slugs : [PLACEHOLDER_SLUG]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  const [settings, services] = await Promise.all([getSiteSettings(), getActiveServices()]);
  const businessName =
    settings.status === "ok" ? settings.data.businessName : FALLBACK_BUSINESS_NAME;
  const service =
    services.status === "ok"
      ? services.data.find((candidate) => candidate.slug === slug)
      : undefined;

  if (!service) {
    // Unknown or inactive (the page is a 404), or the API could not be reached: nothing to index either way.
    return buildPageMetadata({
      pageName: services.status === "ok" ? "Service not found" : "Service details",
      businessName,
      description: "This service page is not available.",
      path: `/services/${slug}`,
      noIndex: true,
    });
  }

  return buildPageMetadata({
    pageName: service.name,
    businessName,
    description: service.shortDescription,
    path: `/services/${service.slug}`,
    noIndex: isDemoMode(),
  });
}

/**
 * A blocking route on purpose. Next.js's development-time instant-navigation check asks for the
 * `params` read to sit behind a `<Suspense>`; this page reads them first so that an unknown slug is
 * answered `404` before anything streams, and what it waits for is a cached read (D-73, D-87).
 */
export const instant = false;

/**
 * The service list is read here, not behind a `<Suspense>`, so that "this slug is not an active
 * service" is decided before anything is sent and can be answered with a real 404 status. The read
 * is cached (`getActiveServices`), so it does not make the page wait on the API (D-87). When the API
 * cannot be reached the service may well exist, so the page shows a message with a retry instead.
 */
export default async function ServicePage({ params }: ServicePageProps) {
  const { slug } = await params;
  const result = await getActiveServices();
  if (result.status === "ok" && !result.data.some((service) => service.slug === slug)) {
    notFound();
  }

  return (
    <PublicPage>
      <ServiceDetail slug={slug} result={result} />
    </PublicPage>
  );
}
