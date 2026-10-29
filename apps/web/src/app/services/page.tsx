import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBanner } from "@/features/marketing/components/page-banner";
import { PublicPage } from "@/features/marketing/components/public-page";
import { Section } from "@/features/marketing/components/section";
import {
  ServicesBrowser,
  ServicesBrowserSkeleton,
} from "@/features/marketing/components/services-browser";
import { SERVICES_PAGE } from "@/features/marketing/content/site-content";
import { getSiteSettings } from "@/features/marketing/lib/public-data";
import { buildPageMetadata, FALLBACK_BUSINESS_NAME } from "@/features/marketing/lib/seo";
import { isDemoMode } from "@/lib/demo-mode";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return buildPageMetadata({
    pageName: SERVICES_PAGE.title,
    businessName: settings.status === "ok" ? settings.data.businessName : FALLBACK_BUSINESS_NAME,
    description: SERVICES_PAGE.intro,
    path: "/services",
    noIndex: isDemoMode(),
  });
}

export default function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] | undefined }>;
}) {
  return (
    <PublicPage>
      <PageBanner
        title={SERVICES_PAGE.title}
        headingId="services-title"
        intro={SERVICES_PAGE.intro}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Services" }]}
      />
      <Section tone="page" headingId="services-list-heading" className="border-b-0">
        <h2 id="services-list-heading" className="sr-only">
          Service list
        </h2>
        <Suspense fallback={<ServicesBrowserSkeleton />}>
          <ServicesBrowser searchParams={searchParams} />
        </Suspense>
      </Section>
    </PublicPage>
  );
}
